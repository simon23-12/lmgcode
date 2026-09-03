#!/usr/bin/env node
// Schreibt alle abgeleiteten Modell-Stellen aus models.json in die Projektdateien.
// Ersetzt nur die Bereiche zwischen den Markern — alles andere bleibt unangetastet.
//
//   node scripts/sync-models.mjs            schreibt
//   node scripts/sync-models.mjs --check    prüft nur (Exit 1 bei Drift, für CI)

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT, loadConfig, derive } from './lib/config.mjs';

const CHECK_ONLY = process.argv.includes('--check');

const PROVIDER_NAME = {
  google:     'Google AI Studio',
  groq:       'Groq',
  openrouter: 'OpenRouter',
};

const ZAHLWORT = ['null','ein','zwei','drei','vier','fünf','sechs','sieben','acht','neun','zehn','elf','zwölf'];
const zahl = n => (ZAHLWORT[n] ?? String(n));
const gross = s => s.charAt(0).toUpperCase() + s.slice(1);

const q  = s => `'${String(s).replace(/'/g, "\\'")}'`;
const pad = (list) => Math.max(...list.map(s => s.length));

// Erstes Wort des Labels, auf Hotkey-Hinweis-Länge gestutzt.
function kurzname(label) {
  const wort = label.split(/[\s/]/)[0];
  return wort.length > 10 ? wort.slice(0, 10) : wort;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Generatoren ──────────────────────────────────────────────────────────────

function genChatMaps(d) {
  const w1 = pad(d.google.map(m => m.key)) + 1;
  const w2 = pad(d.models.map(m => m.key)) + 1;
  const googleTargets = d.google.map(m => m.key);
  const groqTargets   = d.groq.map(m => m.id);
  return [
    `const GOOGLE_MODELS = {`,
    ...d.google.map(m => `  ${(m.key + ':').padEnd(w1)} ${JSON.stringify(m.id)},`),
    `};`,
    ``,
    `// Sentinel bei Google-Modellen: der Key selbst (echte ID steht in GOOGLE_MODELS).`,
    `const MODEL_MAP = {`,
    ...d.models.map(m => `  ${(m.key + ':').padEnd(w2)} ${q(m.provider === 'google' ? m.key : m.id)},`),
    `};`,
    ``,
    `const GOOGLE_TARGETS = new Set([${googleTargets.map(q).join(', ')}]);`,
    `const GROQ_TARGETS   = new Set([${groqTargets.map(q).join(', ')}]);`,
    ``,
    `function isGoogleModel(target) { return GOOGLE_TARGETS.has(target); }`,
    `function isGroqModel(target)   { return GROQ_TARGETS.has(target); }`,
    ``,
    `const DEFAULT_MODEL = ${q(d.default)};`,
  ];
}

function genSanityModels(d) {
  const wn = pad(d.models.map(m => q(m.label))) + 1;
  const wp = pad(d.models.map(m => q(m.provider))) + 1;
  return [
    `const MODELS = [`,
    ...d.models.map(m =>
      `  { name: ${(q(m.label) + ',').padEnd(wn + 1)} provider: ${(q(m.provider) + ',').padEnd(wp + 1)} id: ${q(m.id)} },`),
    `];`,
  ];
}

function genDropdown(d) {
  return d.models.map(m =>
    `<option value="${m.key}"${m.key === d.default ? ' selected' : ''}>${esc(m.label)}</option>`);
}

function genFrontendMaps(d) {
  const wk = pad(d.models.map(m => m.key)) + 1;
  const hotkeys = Object.entries(d.hotkeys).sort(([a], [b]) => a.localeCompare(b));
  const hint = hotkeys
    .map(([k, key]) => `${k}&nbsp;${esc(kurzname(d.models.find(m => m.key === key).label))}`)
    .join('&nbsp;&nbsp;');
  return [
    `const DEFAULT_MODEL = ${q(d.default)};`,
    ``,
    `const SLASH_MODEL_NAMES = {`,
    ...d.models.map(m => `  ${(m.key + ':').padEnd(wk)} ${q(m.label)},`),
    `};`,
    ``,
    `const MODEL_HOTKEYS = { ${hotkeys.map(([k, key]) => `${q(k)}: ${q(key)}`).join(', ')} };`,
    `const MODEL_HOTKEY_HINT = ${q(hint)};`,
    ``,
    `const FALLBACK_CHAINS = {`,
    ...d.models.map(m => `  ${(m.key + ':').padEnd(wk)} [${d.chains[m.key].map(q).join(', ')}],`),
    `};`,
    ``,
    `// Think → Code: diese Modelle bekommen bei komplexen Prompts erst eine Planungsanfrage.`,
    `const PLAN_MODELS = new Set([${d.planModels.map(q).join(', ')}]);`,
  ];
}

function genAboutList(d) {
  const std = d.models.find(m => m.key === d.default);
  return [
    `<li><span style="color:#858585;">AI-Modelle:</span> ${gross(zahl(d.models.length))} Modelle, User wählt im Dropdown — Standard: ${esc(std.label)}`,
    `  <ul style="list-style:none;margin-top:4px;margin-left:16px;display:flex;flex-direction:column;gap:2px;">`,
    ...d.models.map(m =>
      `    <li><span style="color:#4fc1ff;font-family:monospace;">${esc(m.id)}</span> — ${esc(m.label)}${m.key === d.default ? ' (Standard)' : ''} via ${PROVIDER_NAME[m.provider]}</li>`),
    `  </ul>`,
    `</li>`,
  ];
}

function genDocModels(d) {
  const std = d.models.find(m => m.key === d.default);
  return [
    `- **AI-Modelle:** ${gross(zahl(d.models.length))} Modelle, User wählt im Dropdown — **Standard: ${std.label}**:`,
    ...d.models.map(m =>
      `  - **${m.label}**${m.key === d.default ? ' (Standard)' : ''}: \`${m.id}\` via ${PROVIDER_NAME[m.provider]}`),
  ];
}

function genDocChains(d) {
  const label = k => d.models.find(m => m.key === k).label;
  return [
    `| Gewähltes Modell | Kette |`,
    `|---|---|`,
    ...d.models.map(m =>
      `| ${m.label}${m.key === d.default ? ' (Standard)' : ''} | ${d.chains[m.key].map(label).join(' → ')} |`),
  ];
}

// ── Marker-Ersetzung ─────────────────────────────────────────────────────────

const STYLES = {
  js:   { open: id => `// <models:${id}>`,        close: id => `// </models:${id}>`,     note: '// AUTO-GENERIERT aus models.json — nicht von Hand ändern (node scripts/sync-models.mjs)' },
  html: { open: id => `<!-- models:${id} -->`,    close: id => `<!-- /models:${id} -->`, note: null },
  md:   { open: id => `<!-- models:${id} -->`,    close: id => `<!-- /models:${id} -->`, note: null },
};

function replaceBlock(text, file, id, style, lines) {
  const s = STYLES[style];
  const open = s.open(id), close = s.close(id);
  const iOpen = text.indexOf(open);
  const iClose = text.indexOf(close, iOpen);
  if (iOpen === -1 || iClose === -1) {
    throw new Error(`Marker "${id}" fehlt in ${file} — erwartet:\n  ${open}\n  ...\n  ${close}`);
  }
  const lineStart = text.lastIndexOf('\n', iOpen) + 1;
  const indent = text.slice(lineStart, iOpen);
  const body = [...(s.note ? [s.note] : []), ...lines]
    .map(l => (l ? indent + l : ''))
    .join('\n');
  return text.slice(0, iOpen + open.length) + '\n' + body + '\n' + indent + text.slice(iClose);
}

const JOBS = [
  { file: 'api/chat.js',   id: 'maps',     style: 'js',   gen: genChatMaps },
  { file: 'api/sanity.js', id: 'models',   style: 'js',   gen: genSanityModels },
  { file: 'index.html',    id: 'dropdown', style: 'html', gen: genDropdown },
  { file: 'index.html',    id: 'maps',     style: 'js',   gen: genFrontendMaps },
  { file: 'about.html',    id: 'models',   style: 'html', gen: genAboutList },
  { file: 'CLAUDE.md',     id: 'models',   style: 'md',   gen: genDocModels },
  { file: 'CLAUDE.md',     id: 'chains',   style: 'md',   gen: genDocChains },
  { file: 'README.md',     id: 'models',   style: 'md',   gen: genDocModels },
  { file: 'README.md',     id: 'chains',   style: 'md',   gen: genDocChains },
];

const d = derive(loadConfig());

const byFile = new Map();
for (const job of JOBS) {
  const path = resolve(ROOT, job.file);
  if (!byFile.has(job.file)) byFile.set(job.file, { path, text: readFileSync(path, 'utf-8'), orig: null });
  const entry = byFile.get(job.file);
  if (entry.orig === null) entry.orig = entry.text;
  entry.text = replaceBlock(entry.text, job.file, job.id, job.style, job.gen(d));
}

let drift = 0;
for (const [file, e] of byFile) {
  if (e.text === e.orig) {
    console.log(`  =  ${file}`);
    continue;
  }
  drift++;
  if (CHECK_ONLY) {
    console.log(`  ≠  ${file} — weicht von models.json ab`);
  } else {
    writeFileSync(e.path, e.text);
    console.log(`  ✓  ${file} aktualisiert`);
  }
}

console.log(`\n${d.models.length} Modelle · Standard: ${d.default}`);
if (CHECK_ONLY && drift) {
  console.log(`\n${drift} Datei(en) nicht synchron — bitte "node scripts/sync-models.mjs" ausführen.`);
  process.exit(1);
}
