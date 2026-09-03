#!/usr/bin/env node
// Hält models.json gegen die Live-Kataloge von Google AI Studio, Groq und OpenRouter aktuell.
//
//   node scripts/update-models.mjs             prüfen + Bericht (ändert nichts)
//   node scripts/update-models.mjs --apply     tote Modelle automatisch ersetzen + sync
//   node scripts/update-models.mjs --json      maschinenlesbar
//   node scripts/update-models.mjs --no-test   nur Katalog-Abgleich, keine Live-Requests
//
// Kein npm — nur natives fetch (Node 18+).

import { execFileSync } from 'child_process';
import { ROOT, loadConfig, saveConfig, loadEnv } from './lib/config.mjs';

const ARGS     = process.argv.slice(2);
const APPLY    = ARGS.includes('--apply');
const AS_JSON  = ARGS.includes('--json');
const NO_TEST  = ARGS.includes('--no-test');
const MIN_CTX  = 128_000;   // Prompts mit mehreren Dateien brauchen viel Kontext
const TIMEOUT  = 20_000;

const cfg = loadConfig();
const KEYS = loadEnv();

const log = (...a) => { if (!AS_JSON) console.log(...a); };

// ── Provider-Kataloge ────────────────────────────────────────────────────────

async function catalogOpenRouter() {
  const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`OpenRouter-Katalog: HTTP ${r.status}`);
  const { data } = await r.json();
  return data.map(m => ({
    id:      m.id,
    label:   cleanLabel(m.name),
    ctx:     m.context_length ?? 0,
    free:    m.id.endsWith(':free') || Number(m.pricing?.prompt ?? 1) === 0,
    text:    (m.architecture?.input_modalities ?? ['text']).includes('text')
             && (m.architecture?.output_modalities ?? ['text']).includes('text'),
    created: m.created ?? 0,
    desc:    m.description ?? '',
  }));
}

async function catalogGroq() {
  const r = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${KEYS.groq}` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`Groq-Katalog: HTTP ${r.status}`);
  const { data } = await r.json();
  return data.map(m => ({
    id:      m.id,
    label:   cleanLabel(m.name ?? m.id),
    ctx:     m.context_window ?? m.context_length ?? 0,
    free:    true,                        // Groq-Freikontingent
    text:    (m.input_modalities ?? ['text']).includes('text')
             && (m.output_modalities ?? ['text']).includes('text')
             && (m.max_completion_tokens ?? 0) > 512,
    active:  m.active !== false,
    created: m.created ?? 0,
    desc:    '',
  })).filter(m => m.active);
}

async function catalogGoogle() {
  const out = [];
  let token = '';
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${KEYS.google}&pageSize=200`
              + (token ? `&pageToken=${token}` : '');
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!r.ok) throw new Error(`Google-Katalog: HTTP ${r.status}`);
    const data = await r.json();
    for (const m of data.models ?? []) {
      out.push({
        id:      m.name.replace(/^models\//, ''),
        label:   cleanLabel(m.displayName ?? m.name),
        ctx:     m.inputTokenLimit ?? 0,
        free:    true,                    // AI-Studio-Freikontingent
        text:    (m.supportedGenerationMethods ?? []).includes('generateContent'),
        created: 0,
        desc:    m.description ?? '',
      });
    }
    token = data.nextPageToken ?? '';
  } while (token);
  return out;
}

function cleanLabel(name) {
  return String(name)
    .replace(/^[^:]+:\s*/, '')      // "Qwen: Qwen3 Coder" → "Qwen3 Coder"
    .replace(/^[\w.-]+\//, '')     // "Qwen/Qwen3.8-27B" → "Qwen3.8-27B"
    .replace(/\s*\(free\)\s*$/i, '')
    .trim();
}

// ── Eignung als Schul-Modell ─────────────────────────────────────────────────

const AUSSCHLUSS = /whisper|guard|embed|tts|moderation|rerank|vision-only|image|imagen|veo|audio|speech|translat|safety|aqa|learnlm-.*-experimental/i;

function istKandidat(m) {
  return m.text && m.free && m.ctx >= MIN_CTX
      && !AUSSCHLUSS.test(m.id)
      && !/deprecat|retire|discontinu|shut ?down/i.test(m.desc);
}

// Heuristik: Coding-Modelle bevorzugen, dann Kontextgröße, dann Aktualität.
function score(m) {
  let s = 0;
  const t = `${m.id} ${m.label}`.toLowerCase();
  if (/coder|code/.test(t))            s += 40;
  if (/instruct|chat|it\b/.test(t))    s += 10;
  if (/flash-lite/.test(t))            s += 15;
  else if (/flash/.test(t))            s += 10;
  if (/preview|alpha|beta|exp/.test(t)) s -= 12;
  s += Math.min(m.ctx / 100_000, 12);
  s += Math.min(m.created / 1e9, 2);
  return s;
}

// Wenn der Ersatz aus einer fremden Familie kommt, passt der alte Key nicht mehr
// ("qwen" zeigt auf ein Cohere-Modell). Dann einen neuen Key aus dem Label ableiten.
function neuerKey(altKey, k, belegteKeys) {
  const passt = k.id.toLowerCase().includes(altKey) || k.label.toLowerCase().includes(altKey);
  if (passt) return altKey;
  const wort = (k.label.split(/[\s/]/)[0] || k.id).toLowerCase();
  const basis = (wort.match(/^[a-z]+/)?.[0]) || altKey;   // "qwen3.8-27b" → "qwen"
  let key = basis, n = 2;
  while (belegteKeys.has(key) && key !== altKey) key = basis + n++;
  return key;
}

// Vergleicht Versionsnummern wie "3.1" < "3.6" < "3.8" < "10.0".
function versionKleiner(a, b) {
  const A = a.split('.').map(Number), B = b.split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0, y = B[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

// Sucht im Katalog neuere Versionen derselben Modellfamilie: jede Zahl in der ID
// wird testweise durch einen Platzhalter ersetzt, dann wird geschaut, welche
// Katalog-IDs auf dieses Muster passen und eine hoehere Nummer tragen.
// "gemini-3.1-flash-lite" findet so "gemini-3.5-flash-lite", nicht aber "gemini-3.6-flash".
function neuereVersionen(id, katalog) {
  const treffer = [];
  const zahlen = [...id.matchAll(/\d+(?:\.\d+)*/g)];
  for (const z of zahlen) {
    const vorher = id.slice(0, z.index), nachher = id.slice(z.index + z[0].length);
    const muster = new RegExp('^' + esc(vorher) + '(\\d+(?:\\.\\d+)*)' + esc(nachher) + '$');
    for (const k of katalog) {
      const m = k.id.match(muster);
      if (m && versionKleiner(z[0], m[1]) && istKandidat(k)) treffer.push(k);
    }
  }
  return [...new Map(treffer.map(k => [k.id, k])).values()];
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Beim Ersetzen: Modelle aus derselben Familie bevorzugen
// (qwen/qwen3-coder:free → lieber ein anderes Qwen-Coder-Modell als irgendetwas).
function familienBonus(altId, k) {
  const vendor = altId.split('/')[0];
  const tokens = altId.replace(/:free$/, '').split(/[/\-.]/).filter(t => t.length > 2);
  let s = k.id.startsWith(vendor + '/') ? 20 : 0;
  s += tokens.filter(t => k.id.toLowerCase().includes(t.toLowerCase())).length * 6;
  return s;
}

// ── Live-Test (1 Token) ──────────────────────────────────────────────────────

async function testModel(provider, id) {
  const t0 = Date.now();
  try {
    if (provider === 'google') {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent?key=${KEYS.google}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: '1' }] }], generationConfig: { maxOutputTokens: 1 } }),
          signal: AbortSignal.timeout(TIMEOUT) });
      const data = await r.json();
      if (!r.ok) return fehler(r.status, data?.error?.message, t0);
      return { status: 'online', ms: Date.now() - t0 };
    }
    const url = provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
    const key = provider === 'groq' ? KEYS.groq : KEYS.openrouter;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: id, messages: [{ role: 'user', content: '1' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await r.json();
    if (!r.ok) return fehler(r.status, data?.error?.message, t0);
    if (data?.error) return fehler(data.error.code ?? 400, data.error.message, t0);
    return { status: 'online', ms: Date.now() - t0 };
  } catch (e) {
    return { status: e.name === 'TimeoutError' ? 'timeout' : 'offline', error: e.message, ms: Date.now() - t0 };
  }
}

function fehler(status, msg, t0) {
  const s = Number(status);
  const kind = s === 429 ? 'rate-limited'
             : (s === 404 || s === 400) ? 'unbekannt'
             : s === 401 || s === 403 ? 'auth'
             : 'offline';
  return { status: kind, http: s, error: msg || `HTTP ${s}`, ms: Date.now() - t0 };
}

// ── Ablauf ───────────────────────────────────────────────────────────────────

log('\nModell-Update — Kataloge werden geladen …\n');

const [orRaw, groqRaw, googleRaw] = await Promise.all([
  catalogOpenRouter().catch(e => { log(`  ! OpenRouter: ${e.message}`); return null; }),
  catalogGroq().catch(e       => { log(`  ! Groq: ${e.message}`);       return null; }),
  catalogGoogle().catch(e     => { log(`  ! Google: ${e.message}`);     return null; }),
]);

const KATALOG = { openrouter: orRaw, groq: groqRaw, google: googleRaw };

for (const [p, list] of Object.entries(KATALOG)) {
  if (list) log(`  ${p.padEnd(11)} ${String(list.length).padStart(4)} Modelle im Katalog`);
}

// 1) Bestand prüfen
const befund = [];
for (const m of cfg.models) {
  const kat = KATALOG[m.provider];
  const eintrag = kat?.find(k => k.id === m.id) ?? null;
  const test = NO_TEST ? { status: 'übersprungen' } : await testModel(m.provider, m.id);
  const tot = (kat && !eintrag) || ['unbekannt', 'offline'].includes(test.status);
  befund.push({ ...m, imKatalog: !!eintrag, katalog: eintrag, test, tot });
}

// 2) Kandidaten je Provider
const belegt = new Set(cfg.models.map(m => m.id));
const kandidaten = {};
for (const [p, list] of Object.entries(KATALOG)) {
  kandidaten[p] = !list ? [] : list
    .filter(istKandidat)
    .filter(m => !belegt.has(m.id))
    .sort((a, b) => score(b) - score(a));
}

// 3) Stabile Nachfolger für -preview / -exp-IDs
const nachfolger = [];
for (const m of befund) {
  if (!/-(preview|exp|alpha|beta)([-.0-9]*)$/.test(m.id) || !KATALOG[m.provider]) continue;
  const stem = m.id.replace(/-(preview|exp|alpha|beta)([-.0-9]*)$/, '');
  const stabil = KATALOG[m.provider].find(k => k.id === stem && istKandidat(k));
  if (stabil) nachfolger.push({ key: m.key, von: m.id, nach: stabil.id, label: stabil.label });
}

// 4) Neuere Versionen derselben Familie (nur melden, nie automatisch tauschen —
//    neuer heisst nachweislich nicht immer besser)
const upgrades = [];
for (const m of befund) {
  const kat = KATALOG[m.provider];
  if (!kat) continue;
  const neuer = neuereVersionen(m.id, kat).filter(k => k.id !== m.id);
  if (neuer.length) upgrades.push({ key: m.key, label: m.label, von: m.id, kandidaten: neuer });
}

// ── Bericht ──────────────────────────────────────────────────────────────────

const SYM = { online: '✓', 'rate-limited': '✓', timeout: '⏱', offline: '✗', unbekannt: '✗', auth: '!', 'übersprungen': '·' };

log(`\nBestand (${cfg.models.length} Modelle in models.json)\n`);
for (const m of befund) {
  const hinweise = [];
  if (KATALOG[m.provider] && !m.imKatalog) hinweise.push('nicht mehr im Katalog');
  if (m.test.status === 'rate-limited')    hinweise.push('gedrosselt');
  if (m.test.status === 'timeout')         hinweise.push('Timeout');
  if (['offline', 'unbekannt', 'auth'].includes(m.test.status)) hinweise.push(kurz(m.test.error));
  if (m.katalog && m.katalog.ctx && m.katalog.ctx < MIN_CTX) hinweise.push(`nur ${Math.round(m.katalog.ctx / 1000)}K Kontext`);
  log(`  ${SYM[m.test.status] ?? '?'}  ${m.label.padEnd(24)} ${m.provider.padEnd(11)} ${m.id}`);
  if (hinweise.length) log(`     ${' '.repeat(24)} ${' '.repeat(11)} → ${hinweise.join(' · ')}`);
}

if (upgrades.length) {
  log('\nNeuere Version derselben Familie im Katalog');
  for (const u of upgrades) {
    log(`  ${u.label} (${u.von})`);
    for (const k of u.kandidaten.slice(0, 4)) log(`     → ${k.id.padEnd(40)} ${String(Math.round(k.ctx / 1000) + 'K').padStart(6)}  ${k.label}`);
  }
  log('  Wird NICHT automatisch getauscht — vor dem Umstellen selbst gegentesten.');
}

if (nachfolger.length) {
  log('\nStabile Nachfolger verfügbar');
  for (const n of nachfolger) log(`  ${n.von}  →  ${n.nach}  (${n.label})`);
}

log(`\nFreie Kandidaten (≥ ${MIN_CTX / 1000}K Kontext, noch nicht eingebunden)`);
for (const [p, list] of Object.entries(kandidaten)) {
  if (!KATALOG[p]) { log(`  ${p}: Katalog nicht erreichbar`); continue; }
  log(`  ${p}:`);
  if (!list.length) log('     (keine)');
  for (const k of list.slice(0, 6)) {
    log(`     ${k.id.padEnd(46)} ${String(Math.round(k.ctx / 1000) + 'K').padStart(6)}  ${k.label}`);
  }
}

const tote = befund.filter(m => m.tot);

// ── --apply ──────────────────────────────────────────────────────────────────

const angewendet = [];
if (APPLY && (tote.length || nachfolger.length)) {
  log('\n--apply: Änderungen werden geprüft …\n');

  const ersetzungen = [
    ...tote.map(m => ({ key: m.key, provider: m.provider, alt: m.id, grund: 'tot' })),
    ...nachfolger.map(n => ({ key: n.key, provider: cfg.models.find(m => m.key === n.key).provider,
                              alt: n.von, neu: n.nach, label: n.label, grund: 'stabile Version' })),
  ];

  for (const e of ersetzungen) {
    const eintrag = cfg.models.find(m => m.key === e.key);
    if (angewendet.some(a => a.key === e.key)) continue;

    // Kandidatenliste: expliziter Nachfolger zuerst, sonst bestbewertete freie Alternative
    const liste = e.neu
      ? [{ id: e.neu, label: e.label }]
      : (kandidaten[e.provider] ?? [])
          .filter(k => !belegt.has(k.id))
          .sort((a, b) => (score(b) + familienBonus(e.alt, b)) - (score(a) + familienBonus(e.alt, a)));

    let gewaehlt = null;
    for (const k of liste.slice(0, 4)) {
      const t = await testModel(e.provider, k.id);
      log(`  Test ${k.id.padEnd(46)} ${t.status}${t.ms ? ` ${t.ms}ms` : ''}`);
      if (t.status === 'online' || t.status === 'rate-limited') { gewaehlt = k; break; }
    }
    if (!gewaehlt) {
      log(`  ✗  ${e.key}: kein funktionierender Ersatz gefunden — Eintrag bleibt unverändert`);
      continue;
    }
    eintrag.id = gewaehlt.id;
    if (e.grund === 'tot') {
      eintrag.label = gewaehlt.label;
      const keys = new Set(cfg.models.map(m => m.key));
      keys.delete(eintrag.key);
      const nk = neuerKey(eintrag.key, gewaehlt, keys);
      if (nk !== eintrag.key) {
        log(`     Key umbenannt: ${eintrag.key} → ${nk}`);
        if (cfg.defaultModel === eintrag.key) cfg.defaultModel = nk;
        for (const m of cfg.models) {
          if (Array.isArray(m.chain)) m.chain = m.chain.map(c => (c === eintrag.key ? nk : c));
        }
        eintrag.key = nk;
      }
    }
    belegt.add(gewaehlt.id);
    angewendet.push({ key: eintrag.key, von: e.alt, nach: gewaehlt.id, grund: e.grund });
    log(`  ✓  ${eintrag.key}: ${e.alt}  →  ${gewaehlt.id}  (${e.grund})`);
  }

  if (angewendet.length) {
    saveConfig(cfg);
    log('\nmodels.json geschrieben — synchronisiere Projektdateien:\n');
    execFileSync(process.execPath, ['scripts/sync-models.mjs'], { cwd: ROOT, stdio: 'inherit' });
    log('\nNächster Schritt:  vercel --prod --yes');
  } else {
    log('\nKeine Änderung geschrieben.');
  }
}

// ── Abschluss ────────────────────────────────────────────────────────────────

if (AS_JSON) {
  console.log(JSON.stringify({
    geprueft: befund.map(({ key, label, provider, id, imKatalog, test, tot }) =>
      ({ key, label, provider, id, imKatalog, status: test.status, ms: test.ms ?? null, tot })),
    nachfolger,
    upgrades: upgrades.map(u => ({ key: u.key, von: u.von, kandidaten: u.kandidaten.map(k => k.id) })),
    kandidaten: Object.fromEntries(Object.entries(kandidaten).map(([p, l]) =>
      [p, l.slice(0, 10).map(({ id, label, ctx }) => ({ id, label, ctx }))])),
    angewendet,
  }, null, 2));
} else {
  const ok = befund.filter(m => ['online', 'rate-limited'].includes(m.test.status)).length;
  log(`\n` + (NO_TEST
        ? `${befund.length - tote.length}/${befund.length} Modelle im Katalog (kein Live-Test)`
        : `${ok}/${befund.length} Modelle erreichbar`) +
      (tote.length ? ` · ${tote.length} defekt: ${tote.map(m => m.label).join(', ')}` : '') +
      (nachfolger.length ? ` · ${nachfolger.length} Nachfolger verfügbar` : '') +
      (upgrades.length ? ` · ${upgrades.length} neuere Version(en) im Katalog` : ''));
  if (!APPLY && (tote.length || nachfolger.length)) {
    log('\nAutomatisch reparieren:  node scripts/update-models.mjs --apply\n');
  } else {
    log('');
  }
}

function kurz(s) {
  return String(s ?? '').replace(/\s+/g, ' ').slice(0, 90);
}

process.exit(tote.length && !angewendet.length ? 1 : 0);
