// Lädt models.json und leitet alles ab, was App und Backend brauchen.
// Keine npm-Abhängigkeiten — nur Node-Builtins.

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_PATH = resolve(ROOT, 'models.json');

export function loadConfig() {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  const seen = new Set();
  for (const m of cfg.models) {
    if (!m.key || !m.label || !m.provider || !m.id) {
      throw new Error(`models.json: unvollständiger Eintrag ${JSON.stringify(m)}`);
    }
    if (seen.has(m.key)) throw new Error(`models.json: doppelter key "${m.key}"`);
    seen.add(m.key);
    if (!['google', 'groq', 'openrouter'].includes(m.provider)) {
      throw new Error(`models.json: unbekannter provider "${m.provider}" bei "${m.key}"`);
    }
  }
  if (!seen.has(cfg.defaultModel)) {
    throw new Error(`models.json: defaultModel "${cfg.defaultModel}" existiert nicht`);
  }
  cfg.models.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return cfg;
}

export function saveConfig(cfg) {
  const { _hinweis, defaultModel, maxChainLength, models } = cfg;
  writeFileSync(CONFIG_PATH, JSON.stringify({ _hinweis, defaultModel, maxChainLength, models }, null, 2) + '\n');
}

// Fallback-Kette: erst das Modell selbst, dann die übrigen nach rank —
// aber der erste Fallback kommt möglichst von einem anderen Provider,
// damit ein Provider-Ausfall nicht die ganze Kette killt.
export function chainFor(cfg, model) {
  if (Array.isArray(model.chain)) return model.chain;
  const others = cfg.models.filter(m => m.key !== model.key && m.fallback !== false);
  const idx = others.findIndex(m => m.provider !== model.provider);
  if (idx > 0) others.unshift(others.splice(idx, 1)[0]);
  return [model.key, ...others.map(m => m.key)].slice(0, cfg.maxChainLength ?? 5);
}

export function derive(cfg) {
  const byProvider = p => cfg.models.filter(m => m.provider === p);
  return {
    models:      cfg.models,
    default:     cfg.defaultModel,
    google:      byProvider('google'),
    groq:        byProvider('groq'),
    openrouter:  byProvider('openrouter'),
    chains:      Object.fromEntries(cfg.models.map(m => [m.key, chainFor(cfg, m)])),
    hotkeys:     Object.fromEntries(cfg.models.filter(m => m.hotkey).map(m => [m.hotkey, m.key])),
    planModels:  cfg.models.filter(m => m.plan).map(m => m.key),
  };
}

// .env.local parsen (vercel env pull .env.local)
export function loadEnv() {
  const envPath = resolve(ROOT, '.env.local');
  if (!existsSync(envPath)) {
    console.error('Fehler: .env.local nicht gefunden.\nBitte zuerst ausführen: vercel env pull .env.local --yes');
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return {
    openrouter: env.OPENROUTER_API_KEY,
    google:     env.GOOGLE_GENERATIVE_AI_API_KEY,
    groq:       env.GROQ_API_KEY,
  };
}
