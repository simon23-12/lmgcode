// Gemeinsamer Kern von replay.mjs und sammler.mjs
// ---------------------------------------------------------------------------
// - starteServer(): liefert index.html aus; /api/chat entweder gesperrt
//   (Replay) oder an den ECHTEN Handler aus api/chat.js durchgereicht und
//   dabei mitgeschnitten (Sammler).
// - oeffneApp(): Chrome headless, wartet bis Monaco bereit ist.
// - fuehreAus(): einen Fall durch sendMessage() schicken, Endstand auslesen.
// - pruefe(): Erwartungen + Invarianten → Liste von Fehlern.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = join(TESTS, '..');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

// apiHandler: undefined → jeder /api/*-Aufruf schlägt fehl (Replay).
//             Funktion  → (req, res) im Vercel-Stil, mit req.body und res.status().json().
// Mitschnitt: server.mitschnitt = [{ model, stream, status, roh }] — pro /api/chat-Request.
export function starteServer({ apiHandler } = {}) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url.startsWith('/api/')) {
      if (!apiHandler || url !== '/api/chat') {
        res.writeHead(599, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Harness: echter API-Aufruf ' + url, retryable: false }));
      }
      return leiteWeiter(server, apiHandler, req, res);
    }
    const datei = join(ROOT, url === '/' ? 'index.html' : url);
    if (!datei.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(datei);
      res.writeHead(200, { 'Content-Type': MIME[extname(datei)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  server.mitschnitt = [];
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

async function leiteWeiter(server, handler, req, res) {
  let roh = '';
  for await (const teil of req) roh += teil;
  try { req.body = JSON.parse(roh || '{}'); } catch { req.body = {}; }
  const eintrag = { model: req.body.model, stream: !!req.body.stream, status: 200, roh: '' };
  server.mitschnitt.push(eintrag);

  // Vercel-Helfer nachbilden und alles mitschreiben, was zum Browser geht.
  res.status = code => { res.statusCode = code; eintrag.status = code; return res; };
  res.json = obj => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  const write = res.write.bind(res), end = res.end.bind(res);
  res.write = (chunk, ...rest) => { eintrag.roh += String(chunk); return write(chunk, ...rest); };
  res.end = (chunk, ...rest) => {
    if (chunk != null && typeof chunk !== 'function') eintrag.roh += String(chunk);
    return end(chunk, ...rest);
  };
  try {
    await handler(req, res);
  } catch (err) {
    eintrag.status = 500;
    eintrag.roh += JSON.stringify({ error: 'Handler-Ausnahme: ' + err.message });
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    end(JSON.stringify({ error: err.message }));
  }
}

// Mitschnitt eines Requests → Antwort-Eintrag im Fall-Format (siehe CLAUDE.md)
export function alsAntwort(e) {
  if (e.status !== 200) {
    let d = {};
    try { d = JSON.parse(e.roh); } catch {}
    return { status: e.status, error: d.error || e.roh.slice(0, 200), ...(d.retryable !== undefined && { retryable: d.retryable }) };
  }
  if (!e.stream) {
    try { const d = JSON.parse(e.roh); return d.error ? { status: 500, error: d.error, retryable: d.retryable } : { text: d.text }; }
    catch { return { status: 500, error: 'unlesbare Antwort' }; }
  }
  // SSE genauso lesen wie fetchStream(): nur choices[0].delta.content zählt
  let text = '', done = false, fehler = null;
  for (const zeile of e.roh.split('\n')) {
    if (!zeile.startsWith('data: ')) continue;
    const p = zeile.slice(6).trim();
    if (p === '[DONE]') { done = true; break; }
    try {
      const j = JSON.parse(p);
      if (j.error) { fehler = typeof j.error === 'string' ? j.error : (j.error.message || JSON.stringify(j.error)); break; }
      text += j.choices?.[0]?.delta?.content ?? '';
    } catch {}
  }
  if (fehler) return { text, sseFehler: fehler };
  return done ? { text } : { text, ohneDone: true };
}

// ── Fake-/api/chat im Browser (nur Replay) ──────────────────────────────────
// Jede Antwort in fall.antworten bedient genau einen Request (= ein Glied der
// Fallback-Kette). Formen:
//   { "text": "...", "chunk": 40, "pause": 2, "ohneDone": false, "abbruchNach": 1200 }
//   { "status": 503, "error": "high demand", "retryable": true }
//   { "text": "...", "sseFehler": "Failed to parse stream" }   (Fehler-Event im Stream)
function fakeFetchInit() {
  const echtesFetch = window.fetch.bind(window);
  window.__replay = { antworten: [], requests: [] };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/api/chat')) return echtesFetch(input, init);
    let body = {};
    try { body = JSON.parse(init?.body || '{}'); } catch {}
    window.__replay.requests.push({ model: body.model, stream: !!body.stream });
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
          // Kurze Pausen, damit requestAnimationFrame zwischendurch feuert — und
          // am Ende ein Frame aussteht, wenn [DONE] kommt (siehe stoppeLiveUpdate).
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

// fake: true → /api/chat im Browser ersetzt (Replay), false → echtes fetch (Sammler)
export async function oeffneApp(browser, server, { fake = true } = {}) {
  const page = await browser.newPage();
  page.konsolenFehler = [];
  page.on('pageerror', err => page.konsolenFehler.push(err.message));
  if (fake) await page.addInitScript(fakeFetchInit);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => typeof editor !== 'undefined' && editor && typeof sendMessage === 'function',
    null, { timeout: 30000 });
  return page;
}

export async function starteBrowser({ sichtbar = false } = {}) {
  // Installiertes Chrome bevorzugen — spart den Browser-Download von Playwright.
  return chromium.launch({ headless: !sichtbar, channel: 'chrome' })
    .catch(() => chromium.launch({ headless: !sichtbar }));
}

// ── Einen Fall im Browser ausführen ─────────────────────────────────────────
// nurDiesesModell (Option oder Feld im Fall) → Kette auf das eine Modell beschränken (Sammler: wir wollen
// wissen, was GENAU dieses Modell liefert, nicht was der Fallback rettet).
export async function fuehreAus(page, fall, { nurDiesesModell = false } = {}) {
  page.konsolenFehler.length = 0;
  return page.evaluate(async ({ fall, nurDiesesModell }) => {
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
    const modell = fall.modell || DEFAULT_MODEL;
    document.getElementById('model-select').value = modell;

    const ketteVorher = FALLBACK_CHAINS[modell];
    if (nurDiesesModell || fall.nurDiesesModell) FALLBACK_CHAINS[modell] = [modell];
    if (window.__replay) {
      window.__replay.antworten = structuredClone(fall.antworten || []);
      window.__replay.requests = [];
    }
    const prompt = buildPrompt(fall.frage, agent, null);

    document.getElementById('chat-input').value = fall.frage;
    const t0 = performance.now();
    try {
      await sendMessage();
    } finally {
      FALLBACK_CHAINS[modell] = ketteVorher;
    }
    // sendMessage awaitet bis zum finally; Monaco-Updates laufen per rAF nach
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    if (fall.danachUndo) document.getElementById('undo-btn').click();

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
      dateien, vfsInkonsistent, nachrichten, prompt,
      aktiv: activeTab, offen: openTabs.slice(),
      requests: window.__replay ? window.__replay.requests.map(r => r.model) : null,
      undo: agent.undoSnapshot ? agent.undoSnapshot.map(s => s.path) : [],
      verlauf: agent.chatHistory.map(m => `${m.role}: ${m.text}`).join('\n'),
      ms: Math.round(performance.now() - t0),
    };
  }, { fall, nurDiesesModell });
}

// ── Erwartungen prüfen ──────────────────────────────────────────────────────
// erwartet: {
//   dateien: { "style.css": { enthaelt:[], enthaeltNicht:[], regex:[], vorkommen:{}, mindestens:{},
//                             unveraendert:true, gleich:"", fehlt:true, nichtLeer:true } },
//   irgendeineDatei: { regex: [] },   // mind. eine Datei passt (Neubau: Dateiname offen)
//   keinCodeImChat: true,   // Standard: an
//   chatEnthaelt: [], chatEnthaeltNicht: [],
//   promptEnthaelt: [], promptEnthaeltNicht: [],   // der an das Modell geschickte Prompt
//   verlaufEnthaelt: [],    // agent.chatHistory nach der Antwort (danachUndo: true → erst Rückgängig klicken)
//   requests: ["geminiflashlite", "north"],   // exakte Modellfolge (nur Replay)
//   aktiv: "index.html",
//   keineNeuenDateien: true
// }
// Jeder Fehler ist { art: 'app' | 'modell', text }: 'app' = Invariante verletzt
// (gilt unabhängig davon, was das Modell wollte), 'modell' = Erwartung an den
// Inhalt nicht erfüllt — kann am Modell ODER an der App liegen.
export function pruefe(fall, erg, konsolenFehler = []) {
  const fehler = [];
  const app = text => fehler.push({ art: 'app', text });
  const inhalt = text => fehler.push({ art: 'modell', text });
  const e = fall.erwartet || {};
  const norm = s => s.replace(/\r\n/g, '\n');
  const rx = s => new RegExp(s, 'i');

  for (const [pfad, reg] of Object.entries(e.dateien || {})) {
    const ist = erg.dateien[pfad];
    if (reg.fehlt) { if (ist !== undefined) inhalt(`${pfad}: sollte nicht existieren`); continue; }
    if (ist === undefined) { inhalt(`${pfad}: fehlt`); continue; }
    if (reg.unveraendert && norm(ist) !== norm(fall.dateien[pfad] ?? '')) inhalt(`${pfad}: wurde verändert, sollte unverändert bleiben`);
    if (reg.gleich !== undefined && norm(ist).trim() !== norm(reg.gleich).trim()) inhalt(`${pfad}: Inhalt weicht vom erwarteten Endstand ab`);
    if (reg.nichtLeer && !ist.trim()) inhalt(`${pfad}: ist leer`);
    for (const s of reg.enthaelt || []) if (!ist.includes(s)) inhalt(`${pfad}: enthält nicht ${JSON.stringify(s)}`);
    for (const s of reg.enthaeltNicht || []) if (ist.includes(s)) inhalt(`${pfad}: enthält unerwartet ${JSON.stringify(s)}`);
    for (const s of reg.regex || []) if (!rx(s).test(ist)) inhalt(`${pfad}: passt nicht auf /${s}/`);
    for (const [s, n] of Object.entries(reg.vorkommen || {})) {
      const k = ist.split(s).length - 1;
      if (k !== n) inhalt(`${pfad}: ${JSON.stringify(s)} kommt ${k}× vor, erwartet ${n}×`);
    }
    for (const [s, n] of Object.entries(reg.mindestens || {})) {
      const k = ist.split(s).length - 1;
      if (k < n) inhalt(`${pfad}: ${JSON.stringify(s)} kommt ${k}× vor, erwartet mindestens ${n}×`);
    }
  }
  if (e.irgendeineDatei) {
    const passt = Object.values(erg.dateien).some(c => (e.irgendeineDatei.regex || []).every(s => rx(s).test(c)));
    if (!passt) inhalt(`keine Datei passt auf ${(e.irgendeineDatei.regex || []).map(s => '/' + s + '/').join(' + ')}`);
  }
  if (e.keineNeuenDateien) {
    const neu = Object.keys(erg.dateien).filter(p => !(p in (fall.dateien || {})));
    if (neu.length) inhalt(`unerwartete neue Datei(en): ${neu.join(', ')}`);
  }
  const chat = erg.nachrichten.map(n => n.text).join('\n');
  for (const s of e.chatEnthaelt || []) if (!chat.includes(s)) inhalt(`Chat enthält nicht ${JSON.stringify(s)}`);
  for (const s of e.chatEnthaeltNicht || []) if (chat.includes(s)) inhalt(`Chat enthält unerwartet ${JSON.stringify(s)}`);
  for (const s of e.promptEnthaelt || []) if (!(erg.prompt || '').includes(s)) inhalt(`Prompt enthält nicht ${JSON.stringify(s)}`);
  for (const s of e.promptEnthaeltNicht || []) if ((erg.prompt || '').includes(s)) inhalt(`Prompt enthält unerwartet ${JSON.stringify(s)}`);
  for (const s of e.verlaufEnthaelt || []) if (!(erg.verlauf || '').includes(s)) inhalt(`Verlauf fürs Modell enthält nicht ${JSON.stringify(s)}`);
  if (e.requests && erg.requests && JSON.stringify(e.requests) !== JSON.stringify(erg.requests))
    inhalt(`Modellfolge ${JSON.stringify(erg.requests)}, erwartet ${JSON.stringify(e.requests)}`);
  if (e.aktiv && erg.aktiv !== e.aktiv) inhalt(`aktiver Tab ${erg.aktiv}, erwartet ${e.aktiv}`);

  // Invarianten — gelten immer, egal was das Modell geantwortet hat
  if (e.keinCodeImChat !== false && erg.nachrichten.some(n => n.art === 'bot' && n.hatCode)) app('Code landet im Chat');
  for (const [p, vorher] of Object.entries(fall.dateien || {})) {
    const nachher = erg.dateien[p];
    if (nachher === undefined) { app(`${p}: Datei verschwunden`); continue; }
    if (vorher.trim() && !nachher.trim()) app(`${p}: Datei wurde geleert`);
    if (/<!doctype/i.test(vorher) && !/<!doctype/i.test(nachher)) app(`${p}: <!DOCTYPE> verloren — Seite auf Ausschnitt reduziert?`);
    if (/<head[\s>]/i.test(vorher) && !/<head[\s>]/i.test(nachher)) app(`${p}: <head> verloren`);
  }
  if (erg.vfsInkonsistent.length) app(`vfs.content ≠ Monaco-Modell: ${erg.vfsInkonsistent.join(', ')}`);
  if (erg.nachrichten.some(n => /Harness:/.test(n.text))) app('App hat mehr Requests gestellt als Antworten hinterlegt sind');
  for (const k of konsolenFehler) app('JS-Fehler: ' + k);
  return fehler;
}

export function ausgabe(erg) {
  const zeilen = ['      Modellfolge: ' + (erg.requests || []).join(' → ')];
  for (const n of erg.nachrichten) zeilen.push(`      [${n.art}${n.hatCode ? ' +CODE' : ''}] ${n.text.slice(0, 160).replace(/\n/g, '⏎')}`);
  for (const [p, c] of Object.entries(erg.dateien)) zeilen.push(`      ── ${p} ──\n` + c.split('\n').map(z => '      │ ' + z).join('\n'));
  return zeilen.join('\n');
}
