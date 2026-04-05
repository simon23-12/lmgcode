import { GoogleGenerativeAI } from "@google/generative-ai";

const GOOGLE_MODELS = {
  gemma:           "gemma-4-31b-it",
  geminiflashlite: "gemini-3.1-flash-lite-preview",
};

const MODEL_MAP = {
  qwen:             'qwen/qwen3.6-plus:free',
  step:             'stepfun/step-3.5-flash:free',
  nemotron:         'nvidia/nemotron-3-super-120b-a12b:free',
  gemma:            'gemma',
  geminiflashlite:  'geminiflashlite',
};

function isGoogleModel(target) {
  return target === 'gemma' || target === 'geminiflashlite';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, model = 'geminiflashlite', stream = false } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Kein Prompt angegeben.' });
  }
  if (prompt.length > 500000) {
    return res.status(400).json({ error: 'Projekt zu groß – bitte weniger Dateien öffnen.' });
  }

  const target = MODEL_MAP[model] ?? MODEL_MAP.qwen;

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    try {
      if (isGoogleModel(target)) {
        await streamGoogleAI(prompt, GOOGLE_MODELS[target], res);
      } else {
        await streamOpenRouter(prompt, target, res);
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message, retryable: !err.fatal })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  try {
    const result = isGoogleModel(target)
      ? await tryGoogleAI(prompt, GOOGLE_MODELS[target])
      : await tryOpenRouter(prompt, target);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Fehler beim Generieren.',
      retryable: !err.fatal,
    });
  }
}

async function streamOpenRouter(prompt, orModel, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 57000);

  let r;
  try {
    r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: orModel,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`${orModel} Timeout.`);
    throw err;
  }
  clearTimeout(timer);

  if (!r.ok) {
    const data = await r.json();
    const msg = data?.error?.message || 'Fehler beim Generieren.';
    const retryable = r.status === 429 || r.status === 503;
    const err = new Error(msg);
    if (!retryable) err.fatal = true;
    throw err;
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(decoder.decode(value, { stream: true }));
  }
}

async function streamGoogleAI(prompt, googleModel, res) {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  const gModel = genAI.getGenerativeModel({ model: googleModel });
  try {
    const result = await gModel.generateContentStream(prompt);
    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter(p => !p.thought).map(p => p.text ?? '').join('');
      if (text) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      }
    }
    const meta = (await result.response).usageMetadata ?? {};
    if (meta.promptTokenCount || meta.candidatesTokenCount) {
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: meta.promptTokenCount ?? 0, completion_tokens: meta.candidatesTokenCount ?? 0 } })}\n\n`);
    }
  } catch (err) {
    const msg = err.message?.toLowerCase() || '';
    const retryable =
      err.status === 429 || err.status === 503 ||
      msg.includes('429') || msg.includes('503') || msg.includes('rate limit') || msg.includes('overload');
    const e = new Error(err.message || 'Google AI Fehler.');
    if (!retryable) e.fatal = true;
    throw e;
  }
}

async function tryOpenRouter(prompt, orModel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 57000);

  let r, data;
  try {
    r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: orModel,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    data = await r.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`${orModel} Timeout.`);
    throw err;
  }

  if (!r.ok) {
    const msg = data?.error?.message || 'Fehler beim Generieren.';
    const retryable = r.status === 429 || r.status === 503;
    if (!retryable) {
      const fatal = new Error(msg);
      fatal.fatal = true;
      throw fatal;
    }
    throw new Error(msg);
  }

  const usage = data.usage ?? {};
  return {
    text: data.choices[0].message.content,
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
  };
}

async function tryGoogleAI(prompt, googleModel) {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  try {
    const gModel = genAI.getGenerativeModel({ model: googleModel });
    const result = await gModel.generateContent(prompt);
    const meta = result.response.usageMetadata ?? {};
    const parts = result.response.candidates?.[0]?.content?.parts ?? [];
    const text = parts.length ? parts.filter(p => !p.thought).map(p => p.text ?? '').join('') : result.response.text();
    return {
      text,
      promptTokens: meta.promptTokenCount ?? null,
      completionTokens: meta.candidatesTokenCount ?? null,
    };
  } catch (err) {
    const msg = err.message?.toLowerCase() || '';
    const retryable =
      err.status === 429 || err.status === 503 ||
      msg.includes('429') || msg.includes('503') || msg.includes('rate limit') || msg.includes('overload');
    if (!retryable) {
      const fatal = new Error(err.message || 'Google AI Fehler.');
      fatal.fatal = true;
      throw fatal;
    }
    throw new Error(err.message || 'Google AI nicht erreichbar.');
  }
}
