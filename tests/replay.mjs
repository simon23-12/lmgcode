// Replay-Harness für LMG Code
// ---------------------------------------------------------------------------
// Spielt gespeicherte Modellantworten durch die ECHTE Pipeline von index.html:
// sendMessage() → fetchStream() (Live-Streaming in Monaco) → applySRProjekt /
// Codeblöcke / Fragmente → Endstand der Dateien + Chat. Nur /api/chat wird
// durch einen Fake-SSE-Stream ersetzt — es wird kein Kontingent verbraucht.
//
//   node replay.mjs                 faelle/*.json + faelle/gesammelt/*.json
//   node replay.mjs reset           nur Fälle, deren Pfad "reset" enthält
//   node replay.mjs --pruefen       zusätzlich faelle/pruefen/ (vom Sammler, ungeklärt)
//   node replay.mjs --sichtbar      Browser-Fenster zeigen (langsamer)
//   node replay.mjs --ausgabe       bei Fehlschlag Chat und Endstand aller Dateien zeigen
//
// Exit-Code 0 = alles grün, 1 = mindestens ein Fall rot.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TESTS, starteServer, starteBrowser, oeffneApp, fuehreAus, pruefe, ausgabe } from './lib/harness.mjs';

const args = process.argv.slice(2);
const sichtbar = args.includes('--sichtbar');
const zeigeAusgabe = args.includes('--ausgabe');
const mitPruefen = args.includes('--pruefen');
const filter = args.filter(a => !a.startsWith('--'));

async function jsonIn(rel) {
  try { return (await readdir(join(TESTS, rel))).filter(f => f.endsWith('.json')).sort().map(f => rel + '/' + f); }
  catch { return []; }
}
const pfade = [
  ...await jsonIn('faelle'),
  ...await jsonIn('faelle/gesammelt'),
  ...(mitPruefen ? await jsonIn('faelle/pruefen') : []),
].filter(p => !filter.length || filter.some(x => p.includes(x)));
if (!pfade.length) { console.error('Keine Fälle gefunden.'); process.exit(1); }

const server = await starteServer();
const browser = await starteBrowser({ sichtbar });
const page = await oeffneApp(browser, server, { fake: true });

let rot = 0;
for (const pfad of pfade) {
  const fall = JSON.parse(await readFile(join(TESTS, pfad), 'utf8'));
  let fehler, erg;
  try {
    erg = await fuehreAus(page, fall);
    fehler = pruefe(fall, erg, page.konsolenFehler);
  } catch (err) {
    fehler = [{ art: 'app', text: 'Ausnahme: ' + err.message.split('\n')[0] }];
  }
  const label = `${pfad.replace(/^faelle\//, '').replace(/\.json$/, '')}${fall.titel ? ' — ' + fall.titel : ''}`;
  if (!fehler.length) {
    console.log(`  \x1b[32m✓\x1b[0m ${label} \x1b[2m(${erg.ms} ms)\x1b[0m`);
    continue;
  }
  rot++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  for (const f of fehler) console.log(`      ${f.art === 'app' ? '[App] ' : ''}${f.text}`);
  if (erg && zeigeAusgabe) console.log(ausgabe(erg));
}

await browser.close();
server.close();
console.log(`\n${pfade.length - rot}/${pfade.length} grün`);
process.exit(rot ? 1 : 0);
