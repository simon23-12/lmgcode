// Sanity-Check-Endpoint: testet alle Modelle mit einem 1-Token-Request.
// GET /api/sanity — kein Body nötig, antwortet mit { results: [...] }

import { GoogleGenerativeAI } from "@google/generative-ai";

const TIMEOUT_MS = 15_000;
const PROMPT     = '1';

// <models:models>
// AUTO-GENERIERT aus models.json — nicht von Hand ändern (node scripts/sync-models.mjs)
const MODELS = [
  { name: 'Gemini 3.1 Flash Lite',  provider: 'google',      id: 'gemini-3.1-flash-lite' },
  { name: 'North Mini Code',        provider: 'openrouter',  id: 'cohere/north-mini-code:free' },
  { name: 'MiniMax M3',             provider: 'openrouter',  id: 'minimax/minimax-m3:free' },
  { name: 'Nemotron 3 Super',       provider: 'openrouter',  id: 'nvidia/nemotron-3-super-120b-a12b:free' },
  { name: 'Gemma 4 31B',            provider: 'google',      id: 'gemma-4-31b-it' },
  { name: 'Qwen3.8-27B',            provider: 'groq',        id: 'qwen/qwen3.8-27b' },
  { name: 'GPT-OSS 120B',           provider: 'groq',        id: 'openai/gpt-oss-120b' },
  { name: 'Free Models Router',     provider: 'openrouter',  id: 'openrouter/free' },
];
// </models:models>

async function checkOpenAICompat(url, key, modelId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: PROMPT }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || `HTTP ${r.status}`;
      return { status: r.status === 429 ? 'rate-limited' : 'offline', error: msg };
    }
    return { status: 'online' };
  } catch (e) {
    clearTimeout(timer);
    return { status: e.name === 'AbortError' ? 'timeout' : 'offline', error: e.message };
  }
}

async function checkGoogle(modelId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: { maxOutputTokens: 1 },
    });
    const result = await Promise.race([
      model.generateContent(PROMPT),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('Timeout'), { name: 'AbortError' })), TIMEOUT_MS)),
    ]);
    clearTimeout(timer);
    return { status: 'online' };
  } catch (e) {
    clearTimeout(timer);
    const msg = e.message?.toLowerCase() || '';
    if (e.name === 'AbortError' || msg.includes('timeout')) return { status: 'timeout' };
    if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) return { status: 'rate-limited', error: e.message };
    return { status: 'offline', error: e.message };
  }
}

async function checkModel(m) {
  const t0 = Date.now();
  let result;
  if (m.provider === 'google') {
    result = await checkGoogle(m.id);
  } else if (m.provider === 'groq') {
    result = await checkOpenAICompat('https://api.groq.com/openai/v1/chat/completions', process.env.GROQ_API_KEY, m.id);
  } else {
    result = await checkOpenAICompat('https://openrouter.ai/api/v1/chat/completions', process.env.OPENROUTER_API_KEY, m.id);
  }
  return { name: m.name, ms: Date.now() - t0, ...result };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const results = await Promise.all(MODELS.map(checkModel));
  return res.status(200).json({ results });
}
