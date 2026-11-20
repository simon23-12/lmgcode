// Sammler: echte Modellantworten holen und als Replay-Fälle ablegen
// ---------------------------------------------------------------------------
// Schickt jede Aufgabe aus sammler/aufgaben.mjs an jedes gewählte Modell —
// LIVE durch die App (echtes Streaming in Monaco) und das ECHTE Backend
// api/chat.js mit den Keys aus ../.env.local. Pro Modell genau ein Versuch,
// keine Fallback-Kette: Wir wollen wissen, was dieses Modell liefert.
//
// Danach wird die mitgeschnittene Antwort als Fall gespeichert und sofort
// noch einmal per Replay durchgespielt:
//   live grün + Replay grün  → faelle/gesammelt/   (ab jetzt Teil von npm test)
//   sonst                    → faelle/pruefen/     (Befund steht im Fall)
//
//   node sammler.mjs                        alle Aufgaben × alle Modelle
//   node sammler.mjs --modelle north,qwen   nur diese Modelle (Keys aus models.json)
//   node sammler.mjs --aufgaben reset,css   nur Aufgaben, deren id das enthält
//   node sammler.mjs --trocken              nur anzeigen, was geschickt würde
//   node sammler.mjs --trotzdem             auch während der Unterrichtszeit
//   node sammler.mjs --pause 6              Sekunden zwischen Anfragen (Standard 4)
//
// Kontingent: Jede Anfrage zählt. OpenRouter-Modelle teilen sich 1.000/Tag und
// 20/Minute mit dem Unterricht — deshalb sperrt sich der Sammler Mo–Fr
// 7:30–15:30 Uhr, und zwischen zwei Anfragen liegen ein paar Sekunden.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, TESTS, starteServer, starteBrowser, oeffneApp, fuehreAus, pruefe, alsAntwort, ausgabe } from './lib/harness.mjs';
import { AUFGABEN } from './sammler/aufgaben.mjs';

const args = process.argv.slice(2);
const wert = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const liste = name => (wert(name) || '').split(',').map(s => s.trim()).filter(Boolean);
const trocken = args.includes('--trocken');
const pauseSek = Number(wert('--pause') ?? 4);

// ── Modelle und Aufgaben wählen ─────────────────────────────────────────────
const cfg = JSON.parse(readFileSync(join(ROOT, 'models.json'), 'utf8'));
const alleModelle = [...cfg.models].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
const modellWahl = liste('--modelle');
const unbekannt = modellWahl.filter(k => !alleModelle.some(m => m.key === k));
if (unbekannt.length) {
  console.error(`Unbekannte Modelle: ${unbekannt.join(', ')}\nVorhanden: ${alleModelle.map(m => m.key).join(', ')}`);
  process.exit(1);
}
const modelle = modellWahl.length ? alleModelle.filter(m => modellWahl.includes(m.key)) : alleModelle;
const aufgabenWahl = liste('--aufgaben');
const aufgaben = AUFGABEN.filter(a => !aufgabenWahl.length || aufgabenWahl.some(x => a.id.includes(x)));
if (!aufgaben.length) { console.error('Keine passende Aufgabe.'); process.exit(1); }

const anzahl = aufgaben.length * modelle.length;
const viaOR = aufgaben.length * modelle.filter(m => m.provider === 'openrouter').length;
console.log(`${aufgaben.length} Aufgabe(n) × ${modelle.length} Modell(e) = ${anzahl} Anfragen` +
  (viaOR ? ` (davon ${viaOR} über OpenRouter — geteiltes Tageslimit 1.000)` : ''));
console.log(`Modelle:  ${modelle.map(m => m.key).join(', ')}`);
console.log(`Aufgaben: ${aufgaben.map(a => a.id).join(', ')}\n`);
if (trocken) process.exit(0);

// ── Unterrichtszeit schützen ────────────────────────────────────────────────
const jetzt = new Date();
const minuten = jetzt.getHours() * 60 + jetzt.getMinutes();
const schultag = jetzt.getDay() >= 1 && jetzt.getDay() <= 5;
if (schultag && minuten >= 7 * 60 + 30 && minuten < 15 * 60 + 30 && !args.includes('--trotzdem')) {
  console.error('Unterrichtszeit (Mo–Fr 7:30–15:30): Der Sammler würde das Kontingent der Schüler mitbenutzen.\n' +
    'Später laufen lassen oder bewusst mit --trotzdem.');
  process.exit(1);
}

// ── Echtes Backend laden (Keys aus .env.local) ──────────────────────────────
const envPfad = join(ROOT, '.env.local');
if (!existsSync(envPfad)) {
  console.error('.env.local fehlt — bitte im Projektordner: vercel env pull .env.local --yes');
  process.exit(1);
}
for (const zeile of readFileSync(envPfad, 'utf8').split('\n')) {
  const m = zeile.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}
const { default: chatHandler } = await import(pathToFileURL(join(ROOT, 'api', 'chat.js')).href);

// ── Lauf ────────────────────────────────────────────────────────────────────
const datum = jetzt.toISOString().slice(0, 10);
const ordner = { gruen: join(TESTS, 'faelle', 'gesammelt'), pruefen: join(TESTS, 'faelle', 'pruefen') };
Object.values(ordner).forEach(o => mkdirSync(o, { recursive: true }));

const server = await starteServer({ apiHandler: chatHandler });
const browser = await starteBrowser({ sichtbar: args.includes('--sichtbar') });
const live = await oeffneApp(browser, server, { fake: false });
const replay = await oeffneApp(browser, server, { fake: true });

const tabelle = new Map();   // aufgabe → { modell → Symbol }
const notizen = [];
let nr = 0;

for (const aufgabe of aufgaben) {
  tabelle.set(aufgabe.id, {});
  for (const m of modelle) {
    nr++;
    if (nr > 1) await new Promise(r => setTimeout(r, pauseSek * 1000));
    const kopf = `[${nr}/${anzahl}] ${aufgabe.id} × ${m.key}`;
    const fall = {
      titel: `${aufgabe.titel} — ${m.label}`,
      quelle: `echt, ${m.id} (${m.provider}) via sammler.mjs, ${datum}`,
      dateien: aufgabe.dateien, offen: aufgabe.offen, aktiv: aufgabe.aktiv,
      modell: m.key, nurDiesesModell: true,
      frage: aufgabe.frage,
      erwartet: aufgabe.erwartet,
    };

    server.mitschnitt = [];
    let ergLive;
    const t0 = Date.now();
    try {
      ergLive = await fuehreAus(live, fall, { nurDiesesModell: true });
    } catch (err) {
      console.log(`${kopf}  \x1b[31mAusnahme\x1b[0m ${err.message.split('\n')[0]}`);
      tabelle.get(aufgabe.id)[m.key] = '!';
      continue;
    }
    const sek = ((Date.now() - t0) / 1000).toFixed(1);
    const antworten = server.mitschnitt.map(alsAntwort);

    // Kein verwertbarer Inhalt (429, 503, leerer Stream): nichts zu speichern —
    // das Fehlerverhalten der Kette decken die handgeschriebenen Fälle ab.
    const hatInhalt = antworten.some(a => a.text && a.text.trim());
    if (!hatInhalt) {
      const grund = antworten.map(a => a.error || a.sseFehler || (a.ohneDone ? 'leerer Stream' : '?')).join(' / ') || 'kein Request';
      console.log(`${kopf}  \x1b[33m– nicht erreichbar\x1b[0m ${grund.slice(0, 400)}`);
      tabelle.get(aufgabe.id)[m.key] = '–';
      continue;
    }

    const gespeichert = { ...fall, antworten };
    const fehlerLive = pruefe(fall, ergLive, live.konsolenFehler);
    let fehlerReplay;
    try {
      fehlerReplay = pruefe(gespeichert, await fuehreAus(replay, gespeichert), replay.konsolenFehler);
    } catch (err) {
      fehlerReplay = [{ art: 'app', text: 'Replay-Ausnahme: ' + err.message.split('\n')[0] }];
    }

    const gruen = !fehlerLive.length && !fehlerReplay.length;
    const appFehler = [...fehlerLive, ...fehlerReplay].some(f => f.art === 'app');
    const nurLive = fehlerLive.length && !fehlerReplay.length;
    const symbol = gruen ? '✓' : appFehler ? 'A' : nurLive ? 'T' : 'M';
    tabelle.get(aufgabe.id)[m.key] = symbol;

    const datei = `${datum}-${aufgabe.id}-${m.key}.json`;
    if (!gruen) {
      gespeichert.befund = {
        live: fehlerLive.map(f => `[${f.art}] ${f.text}`),
        replay: fehlerReplay.map(f => `[${f.art}] ${f.text}`),
        chatLive: ergLive.nachrichten.filter(n => n.art !== 'user').map(n => (n.hatCode ? '[+CODE] ' : '') + n.text.slice(0, 300)),
      };
    }
    writeFileSync(join(gruen ? ordner.gruen : ordner.pruefen, datei), JSON.stringify(gespeichert, null, 2) + '\n');

    const farbe = gruen ? '\x1b[32m' : appFehler ? '\x1b[31m' : '\x1b[33m';
    const zeilen = (antworten.find(a => a.text)?.text || '').split('\n').length;
    console.log(`${kopf}  ${farbe}${gruen ? '✓' : '✗ ' + symbol}\x1b[0m  ${sek}s, ${zeilen} Zeilen${gruen ? '' : '  → pruefen/' + datei}`);
    if (!gruen) {
      for (const f of fehlerLive) console.log(`      live:   ${f.art === 'app' ? '[App] ' : ''}${f.text}`);
      for (const f of fehlerReplay) console.log(`      replay: ${f.art === 'app' ? '[App] ' : ''}${f.text}`);
      if (args.includes('--ausgabe')) console.log(ausgabe(ergLive));
    }
    if (nurLive) notizen.push(`${datei}: nur live rot, im Replay grün — Timing-Problem im Streaming?`);
  }
}

await browser.close();
server.close();

// ── Übersicht ───────────────────────────────────────────────────────────────
const breite = Math.max(...aufgaben.map(a => a.id.length)) + 2;
console.log('\n' + ' '.repeat(breite) + modelle.map(m => m.key.slice(0, 7).padEnd(8)).join(''));
for (const a of aufgaben) {
  console.log(a.id.padEnd(breite) + modelle.map(m => (tabelle.get(a.id)[m.key] ?? ' ').padEnd(8)).join(''));
}
console.log('\n✓ grün → gesammelt/   A App-Invariante verletzt   M Erwartung nicht erfüllt (Modell oder App?)\n' +
  'T nur live rot (Timing)   – nicht erreichbar   ! Ausnahme');
for (const n of notizen) console.log('• ' + n);
const offen = [...tabelle.values()].flatMap(z => Object.values(z)).filter(s => 'AMT'.includes(s) && s).length;
if (offen) console.log(`\n${offen} Fall/Fälle in faelle/pruefen/ — ansehen mit: node replay.mjs --pruefen --ausgabe <name>`);
