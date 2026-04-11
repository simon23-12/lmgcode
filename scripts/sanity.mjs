#!/usr/bin/env node
// Sanity-check: testet alle LMG-Code-Modelle mit einem minimalen 1-Token-Request.
// Läuft parallel — braucht .env.local im Projekt-Root (vercel env pull .env.local).
// Keine npm-Abhängigkeiten — nur native fetch (Node.js 18+).

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// .env.local parsen
const envPath = resolve(ROOT, '.env.local');
if (!existsSync(envPath)) {
  console.error('Fehler: .env.local nicht gefunden.\nBitte zuerst ausführen: vercel env pull .env.local');
  process.exit(1);
}
const env = {};
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const OPENROUTER_KEY = env.OPENROUTER_API_KEY;
const GOOGLE_KEY     = env.GOOGLE_GENERATIVE_AI_API_KEY;
const GROQ_KEY       = env.GROQ_API_KEY;

const MODELS = [
  { name: 'Gemini 3.1 Flash Lite', provider: 'google',      id: 'gemini-3.1-flash-lite-preview' },
  { name: 'Gemma 4 31B',           provider: 'google',      id: 'gemma-4-31b-it' },
  { name: 'Llama 3.3 70B',         provider: 'groq',        id: 'llama-3.3-70b-versatile' },
  { name: 'Kimi K2',               provider: 'groq',        id: 'moonshotai/kimi-k2-instruct-0905' },
  { name: 'Qwen3 Coder 480B',      provider: 'openrouter',  id: 'qwen/qwen3-coder:free' },
  { name: 'MiniMax M2.5',           provider: 'openrouter',  id: 'minimax/minimax-m2.5:free' },
  { name: 'Nemotron 3 Super',      provider: 'openrouter',  id: 'nvidia/nemotron-3-super-120b-a12b:free' },
];

const TIMEOUT_MS = 20_000;
const PROMPT     = '1';  // kürzest möglicher Input

async function checkOpenAICompat(url, key, model) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_tokens: 1,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || JSON.stringify(data?.error) || 'unknown error';
    throw new Error(`HTTP ${r.status} — ${msg}`);
  }
  return data.choices?.[0]?.message?.content ?? '(empty)';
}

async function checkGoogle(modelId) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GOOGLE_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }] }],
      generationConfig: { maxOutputTokens: 1 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || JSON.stringify(data?.error) || 'unknown error';
    throw new Error(`HTTP ${r.status} — ${msg}`);
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '(empty)';
}

async function check({ name, provider, id }) {
  const t0 = Date.now();
  try {
    let text;
    if (provider === 'google') {
      text = await checkGoogle(id);
    } else if (provider === 'groq') {
      text = await checkOpenAICompat('https://api.groq.com/openai/v1/chat/completions', GROQ_KEY, id);
    } else {
      text = await checkOpenAICompat('https://openrouter.ai/api/v1/chat/completions', OPENROUTER_KEY, id);
    }
    return { name, ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: e.message };
  }
}

console.log(`\nSanity Check — ${MODELS.length} Modelle (parallel, max ${TIMEOUT_MS / 1000}s)\n`);

const results = await Promise.all(MODELS.map(check));

let passed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  ✓  ${r.name.padEnd(24)} ${r.ms}ms`);
    passed++;
  } else {
    console.log(`  ✗  ${r.name.padEnd(24)} ${r.error}`);
  }
}

const failed = results.filter(r => !r.ok);
console.log(`\n${passed}/${MODELS.length} OK${failed.length ? `  —  ausgefallen: ${failed.map(r => r.name).join(', ')}` : ''}\n`);
if (failed.length) process.exit(1);
