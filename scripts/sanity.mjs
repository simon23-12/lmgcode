#!/usr/bin/env node
// Sanity-check: testet alle LMG-Code-Modelle mit einem minimalen 1-Token-Request.
// Modell-Liste kommt aus models.json. Braucht .env.local im Projekt-Root.
// Keine npm-Abhängigkeiten — nur native fetch (Node.js 18+).

import { loadConfig, loadEnv } from './lib/config.mjs';

const KEYS = loadEnv();
const OPENROUTER_KEY = KEYS.openrouter;
const GOOGLE_KEY     = KEYS.google;
const GROQ_KEY       = KEYS.groq;

// Modelle kommen aus models.json — hier nichts von Hand pflegen.
const MODELS = loadConfig().models.map(m => ({ name: m.label, provider: m.provider, id: m.id }));

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
