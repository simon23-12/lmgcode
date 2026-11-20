// Replay-Harness für LMG Code
// ---------------------------------------------------------------------------
// Spielt gespeicherte Modellantworten durch die ECHTE Pipeline von index.html:
// sendMessage() → fetchStream() (Live-Streaming in Monaco) → applySRProjekt /
// Codeblöcke / Fragmente → Endstand der Dateien + Chat. Nur /api/chat wird
// durch einen Fake-SSE-Stream ersetzt — es wird kein Kontingent verbraucht.
//
//   node replay.mjs                 alle Fälle in faelle/
//   node replay.mjs reset           nur Fälle, deren Dateiname "reset" enthält
//   node replay.mjs --sichtbar      Browser-Fenster zeigen (langsamer)
//   node replay.mjs --ausgabe       bei Fehlschlag den Endstand aller Dateien zeigen
//
// Exit-Code 0 = alles grün, 1 = mindestens ein Fall rot.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HIER, '..');
const FAELLE = join(HIER, 'faelle');

const args = process.argv.slice(2);
const sichtbar = args.includes('--sichtbar');
const zeigeAusgabe = args.includes('--ausgabe');
const filter = args.filter(a => !a.startsWith('--'));

// ── Statischer Server für index.html (kein vercel dev nötig) ────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

function starteServer() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url.startsWith('/api/')) {
      // Darf nie erreicht werden — fetch('/api/chat') ist im Browser ersetzt.
      res.writeHead(599, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Harness: echter API-Aufruf ' + url, retryable: false }));
    }
    const datei = join(ROOT, url === '/' ? 'index.html' : url);
    if (!datei.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(datei);
      res.writeHead(200, { 'Content-Type': MIME[extname(datei)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// ── Fake-/api/chat im Browser ───────────────────────────────────────────────
// Jede Antwort in fall.antworten bedient genau einen Request (= ein Glied der
// Fallback-Kette). Formen:
//   { "text": "...", "chunk": 40, "ohneDone": false, "abbruchNach": 1200 }
//   { "status": 503, "error": "high demand", "retryable": true }
//   { "sseFehler": "Failed to parse stream" }   (Fehler-Event im Stream)
function fakeFetchInit() {
  const echtesFetch = window.fetch.bind(window);
  window.__replay = { antworten: [], requests: [] };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/api/chat')) return echtesFetch(input, init);
    let body = {};
    try { body = JSON.parse(init?.body || '{}'); } catch {}
    window.__replay.requests.push({ model: body.model, stream: !!body.stream, prompt: body.prompt });
    const a = window.__replay.antworten.shift();
    if (!a) {
      return new Response(JSON.stringify({ error: 'Harness: keine Antwort mehr hinterlegt', retryable: false }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (a.status) {
      return new Response(JSON.stringify({ error: a.error || 'Fehler', retryable: a.retryable }),
        { status: a.status, headers: { 'Content-Type': 'application/json' } });
    }
    if (!body.stream) {
      return new Response(JSON.stringify({ text: a.text, promptTokens: 10, completionTokens: 10 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const enc = new TextEncoder();
    let text = a.text || '';
    if (a.abbruchNach != null) text = text.slice(0, a.abbruchNach);
    const groesse = a.chunk || 40;
    const stream = new ReadableStream({
      async start(ctrl) {
        for (let i = 0; i < text.length; i += groesse) {
          const delta = text.slice(i, i + groesse);
          ctrl.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: delta } }] }) + '\n\n'));
          // Kurze Pausen, damit requestAnimationFrame zwischendurch feuert —
          // das Live-Streaming in Monaco ist selbst eine Fehlerquelle.
          await new Promise(r => setTimeout(r, a.pause ?? 2));
        }
        if (a.sseFehler) {
          ctrl.enqueue(enc.encode('data: ' + JSON.stringify({ error: a.sseFehler, retryable: true }) + '\n\n'));
        } else if (!a.ohneDone && a.abbruchNach == null) {
          ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
        }
        ctrl.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}

// ── Einen Fall im Browser ausführen ─────────────────────────────────────────
async function fuehreAus(page, fall) {
  return page.evaluate(async (fall) => {
    // App-Zustand frisch aufsetzen (ohne Neuladen — Monaco bleibt warm)
    clearVFS();
    for (const [pfad, inhalt] of Object.entries(fall.dateien || {})) addFile(pfad, inhalt);
    const offen = fall.offen || Object.keys(fall.dateien || {});
    for (const p of offen) openTab(p);
    if (fall.aktiv) switchTab(fall.aktiv);
    renderTree();

    const agent = agents.get(activeAgentId);
    agent.chatHistory = (fall.verlauf || []).slice();
    agent.learnMode = !!fall.lernmodus;
    agent.thinkMode = false;
    agent.neubauHinweisGezeigt = true;   // Hinweis-Bubble ist kein Prüfgegenstand
    agent.messagesEl.innerHTML = '';
    document.getElementById('model-select').value = fall.modell || DEFAULT_MODEL;

    window.__replay.antworten = structuredClone(fall.antworten);
    window.__replay.requests = [];

    document.getElementById('chat-input').value = fall.frage;
    const t0 = performance.now();
    await sendMessage();
    // sendMessage awaitet bis zum finally; Monaco-Updates laufen per rAF nach
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

    const dateien = {};
    for (const [p, f] of Object.entries(vfs)) dateien[p] = f.model ? f.model.getValue() : f.content;
    const vfsInkonsistent = Object.entries(vfs)
      .filter(([, f]) => f.model && f.model.getValue() !== f.content).map(([p]) => p);
    const nachrichten = [...agent.messagesEl.querySelectorAll('.chat-msg')].map(d => ({
      art: d.classList.contains('bot') ? 'bot' : d.classList.contains('system') ? 'system' : 'user',
      text: d.textContent,
      hatCode: !!d.querySelector('pre'),
    }));
    return {
      dateien, vfsInkonsistent, nachrichten,
      aktiv: activeTab, offen: openTabs.slice(),
      requests: window.__replay.requests.map(r => r.model),
      restAntworten: window.__replay.antworten.length,
      undo: agent.undoSnapshot ? agent.undoSnapshot.map(s => s.path) : [],
      ms: Math.round(performance.now() - t0),
    };
  }, fall);
}

// ── Erwartungen prüfen ──────────────────────────────────────────────────────
// erwartet: {
//   dateien: { "style.css": { enthaelt:[], enthaeltNicht:[], gleich:"", unveraendert:true, fehlt:true, nichtLeer:true } },
//   keinCodeImChat: true,   // keine <pre> in Bot-Nachrichten
//   chatEnthaelt: ["..."],  // Text irgendwo im Chat (Teilstring)
//   chatEnthaeltNicht: [],
//   requests: ["geminiflashlite", "north"],   // exakte Modellfolge
//   aktiv: "index.html",
//   keineNeuenDateien: true
// }
function pruefe(fall, erg) {
  const fehler = [];
  const e = fall.erwartet || {};
  const norm = s => s.replace(/\r\n/g, '\n');

  for (const [pfad, reg] of Object.entries(e.dateien || {})) {
    const ist = erg.dateien[pfad];
    if (reg.fehlt) { if (ist !== undefined) fehler.push(`${pfad}: sollte nicht existieren`); continue; }
    if (ist === undefined) { fehler.push(`${pfad}: fehlt`); continue; }
    if (reg.unveraendert && norm(ist) !== norm(fall.dateien[pfad] ?? '')) fehler.push(`${pfad}: wurde verändert, sollte unverändert bleiben`);
    if (reg.gleich !== undefined && norm(ist).trim() !== norm(reg.gleich).trim()) fehler.push(`${pfad}: Inhalt weicht vom erwarteten Endstand ab`);
    if (reg.nichtLeer && !ist.trim()) fehler.push(`${pfad}: ist leer`);
    for (const s of reg.enthaelt || []) if (!ist.includes(s)) fehler.push(`${pfad}: enthält nicht ${JSON.stringify(s)}`);
    for (const s of reg.enthaeltNicht || []) if (ist.includes(s)) fehler.push(`${pfad}: enthält unerwartet ${JSON.stringify(s)}`);
    if (reg.vorkommen) for (const [s, n] of Object.entries(reg.vorkommen)) {
      const k = ist.split(s).length - 1;
      if (k !== n) fehler.push(`${pfad}: ${JSON.stringify(s)} kommt ${k}× vor, erwartet ${n}×`);
    }
  }
  if (e.keineNeuenDateien) {
    const neu = Object.keys(erg.dateien).filter(p => !(p in (fall.dateien || {})));
    if (neu.length) fehler.push(`unerwartete neue Datei(en): ${neu.join(', ')}`);
  }
  const bot = erg.nachrichten.filter(n => n.art === 'bot');
  if (e.keinCodeImChat !== false && bot.some(n => n.hatCode)) fehler.push('Code landet im Chat');
  const chat = erg.nachrichten.map(n => n.text).join('\n');
  for (const s of e.chatEnthaelt || []) if (!chat.includes(s)) fehler.push(`Chat enthält nicht ${JSON.stringify(s)}`);
  for (const s of e.chatEnthaeltNicht || []) if (chat.includes(s)) fehler.push(`Chat enthält unerwartet ${JSON.stringify(s)}`);
  if (e.requests && JSON.stringify(e.requests) !== JSON.stringify(erg.requests))
    fehler.push(`Modellfolge ${JSON.stringify(erg.requests)}, erwartet ${JSON.stringify(e.requests)}`);
  if (e.aktiv && erg.aktiv !== e.aktiv) fehler.push(`aktiver Tab ${erg.aktiv}, erwartet ${e.aktiv}`);
  // Invarianten, die immer gelten müssen
  if (erg.vfsInkonsistent.length) fehler.push(`vfs.content ≠ Monaco-Modell: ${erg.vfsInkonsistent.join(', ')}`);
  if (erg.nachrichten.some(n => /Harness:/.test(n.text))) fehler.push('App hat mehr Requests gestellt als Antworten hinterlegt sind');
  return fehler;
}

// ── Hauptprogramm ───────────────────────────────────────────────────────────
const dateinamen = (await readdir(FAELLE)).filter(f => f.endsWith('.json'))
  .filter(f => !filter.length || filter.some(x => f.includes(x))).sort();
if (!dateinamen.length) { console.error('Keine Fälle gefunden.'); process.exit(1); }

const server = await starteServer();
// Installiertes Chrome bevorzugen — spart den Browser-Download von Playwright.
const browser = await chromium.launch({ headless: !sichtbar, channel: 'chrome' })
  .catch(() => chromium.launch({ headless: !sichtbar }));
const page = await browser.newPage();
const konsolenFehler = [];
page.on('pageerror', err => konsolenFehler.push(err.message));
await page.addInitScript(fakeFetchInit);
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => typeof editor !== 'undefined' && editor && typeof sendMessage === 'function',
  null, { timeout: 30000 });

let rot = 0;
for (const name of dateinamen) {
  const fall = JSON.parse(await readFile(join(FAELLE, name), 'utf8'));
  konsolenFehler.length = 0;
  let fehler, erg;
  try {
    erg = await fuehreAus(page, fall);
    fehler = pruefe(fall, erg);
  } catch (err) {
    fehler = ['Ausnahme: ' + err.message.split('\n')[0]];
  }
  for (const k of konsolenFehler) fehler.push('JS-Fehler: ' + k);
  const label = `${name.replace(/\.json$/, '')}${fall.titel ? ' — ' + fall.titel : ''}`;
  if (!fehler.length) {
    console.log(`  \x1b[32m✓\x1b[0m ${label} \x1b[2m(${erg.ms} ms)\x1b[0m`);
    continue;
  }
  rot++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  for (const f of fehler) console.log(`      ${f}`);
  if (erg && zeigeAusgabe) {
    console.log('      Modellfolge: ' + erg.requests.join(' → '));
    for (const n of erg.nachrichten) console.log(`      [${n.art}] ${n.text.slice(0, 160).replace(/\n/g, '⏎')}`);
    for (const [p, c] of Object.entries(erg.dateien)) console.log(`      ── ${p} ──\n` + c.split('\n').map(z => '      │ ' + z).join('\n'));
  }
}

await browser.close();
server.close();
console.log(`\n${dateinamen.length - rot}/${dateinamen.length} grün`);
process.exit(rot ? 1 : 0);
