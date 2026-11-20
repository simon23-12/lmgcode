// Backend-Test: Welche Provider-Fehler stoppen die Fallback-Kette?
// ---------------------------------------------------------------------------
// Ruft den echten Handler aus api/chat.js auf, ersetzt aber globalThis.fetch:
// Jeder Provider antwortet mit einem vorgegebenen HTTP-Status. Geprüft wird,
// ob die Antwort an den Browser retryable ist (→ nächstes Modell) oder fatal
// (→ Kette bricht ab). Kein Netz, kein Kontingent.
//
// Regel (httpFehlerIstFatal / googleFehlerIstFatal): fatal nur 400/401/403 —
// was beim nächsten Modell genauso käme. 404 (Modell weg), 429, 5xx → weiter.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/harness.mjs';

process.env.OPENROUTER_API_KEY = 'test';
process.env.GROQ_API_KEY = 'test';
process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test';

let antwortStatus = 200;
globalThis.fetch = async () => new Response(
  JSON.stringify({ error: { code: antwortStatus, message: `Simulierter Fehler ${antwortStatus}`, status: 'SIMULIERT' } }),
  { status: antwortStatus, headers: { 'Content-Type': 'application/json' } });

const { default: handler } = await import(pathToFileURL(join(ROOT, 'api', process.env.CHAT_DATEI || 'chat.js')).href);

// Je ein Modell pro Provider aus models.json
const cfg = JSON.parse(readFileSync(join(ROOT, 'models.json'), 'utf8'));
const proProvider = ['google', 'groq', 'openrouter']
  .map(p => cfg.models.find(m => m.provider === p)).filter(Boolean);

function rufe(model, stream) {
  return new Promise(resolve => {
    let roh = '', status = 200;
    const res = {
      headersSent: false,
      setHeader() {}, flushHeaders() { this.headersSent = true; },
      write(c) { roh += c; },
      end(c) { if (c) roh += c; resolve({ status, roh }); },
      status(c) { status = c; return this; },
      json(o) { roh = JSON.stringify(o); resolve({ status, roh }); return this; },
    };
    handler({ method: 'POST', body: { prompt: 'Hallo', model, stream } }, res);
  });
}

function retryableAus({ roh }, stream) {
  if (!stream) return JSON.parse(roh).retryable;
  for (const z of roh.split('\n')) {
    if (!z.startsWith('data: ') || z.includes('[DONE]')) continue;
    const j = JSON.parse(z.slice(6));
    if (j.error) return j.retryable;
  }
  return '(kein Fehler-Event)';
}

const ERWARTUNG = { 400: false, 401: false, 403: false, 404: true, 429: true, 500: true, 502: true, 503: true, 504: true };
let rot = 0, gesamt = 0;
for (const m of proProvider) {
  for (const stream of [true, false]) {
    const zeile = [];
    for (const [code, soll] of Object.entries(ERWARTUNG)) {
      antwortStatus = Number(code);
      const ist = retryableAus(await rufe(m.key, stream), stream);
      gesamt++;
      if (ist === soll) zeile.push(`\x1b[32m${code}\x1b[0m`);
      else { rot++; zeile.push(`\x1b[31m${code}:${ist ? 'weiter' : 'STOPP'}\x1b[0m`); }
    }
    console.log(`  ${m.provider.padEnd(10)} ${stream ? 'stream ' : 'einmal '} ${zeile.join(' ')}`);
  }
}
console.log(`\nBackend: ${gesamt - rot}/${gesamt} Fehlerklassen richtig (fatal nur 400/401/403)`);
process.exit(rot ? 1 : 0);
