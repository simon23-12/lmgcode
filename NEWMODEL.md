# Neues Modell hinzufügen — Checkliste

## 1. Modell-Key wählen

Kurzer interner Bezeichner, z.B. `minimax`. Wird in `FALLBACK_CHAINS`, `SLASH_MODEL_NAMES`, dem Dropdown und der API als `model`-Parameter verwendet.

## 2. Provider ermitteln

| Provider | Wie erkannt? | Was tun? |
|---|---|---|
| **OpenRouter** | Model-ID enthält `/` oder `:free` | Nur `MODEL_MAP` ergänzen — keine Funktionsänderung nötig |
| **Groq** | Groq-Dokumentation / API | `MODEL_MAP` + `isGroqModel()` in `api/chat.js` ergänzen |
| **Google AI Studio** | `gemini-*` oder `gemma-*` | `GOOGLE_MODELS` + `MODEL_MAP` (Sentinel-String) + `isGoogleModel()` in `api/chat.js` ergänzen |

---

## Änderungen in `api/chat.js`

### Immer: `MODEL_MAP`
```js
const MODEL_MAP = {
  // ...
  minimax: 'minimax/minimax-m2.5:free',   // OpenRouter-Slug / Groq-ID
};
```

### Nur bei Groq: `isGroqModel()`
```js
function isGroqModel(target) {
  return target === 'llama-3.3-70b-versatile'
      || target === 'moonshotai/kimi-k2-instruct-0905'
      || target === 'NEUER_GROQ_MODEL_ID';  // ← ergänzen
}
```

### Nur bei Google AI Studio: `GOOGLE_MODELS` + `isGoogleModel()`
```js
const GOOGLE_MODELS = {
  gemma:           "gemma-4-31b-it",
  geminiflashlite: "gemini-3.1-flash-lite-preview",
  neukey:          "gemini-x-xyz",  // ← ergänzen
};
// MODEL_MAP: Sentinel = Key selbst (nicht die echte ID)
const MODEL_MAP = { neukey: 'neukey', ... };

function isGoogleModel(target) {
  return target === 'gemma' || target === 'geminiflashlite' || target === 'neukey'; // ← ergänzen
}
```

---

## Änderungen in `index.html`

### 1. Dropdown (`#model-select`)
```html
<select id="model-select">
  <!-- ... -->
  <option value="minimax">MiniMax M2.5</option>   <!-- ← ergänzen -->
</select>
```

### 2. `SLASH_MODEL_NAMES`
```js
const SLASH_MODEL_NAMES = {
  // ...
  minimax: 'MiniMax M2.5',   // ← ergänzen (Anzeigename für /model-Befehle)
};
```

### 3. `FALLBACK_CHAINS` — zwei Stellen

**a) Eigene Kette für das neue Modell:**
```js
const FALLBACK_CHAINS = {
  // ...
  minimax: ['minimax', 'geminiflashlite', 'step', 'nemotron', 'gemma'],  // ← neu
};
```

**b) Das neue Modell in bestehende Ketten einbauen** (überall wo es als Fallback sinnvoll ist):
```js
geminiflashlite: ['geminiflashlite', 'minimax', 'qwen', 'step', 'nemotron', 'llama'],  // ← minimax eingefügt
```

### 4. Tastenkürzel `KEYS` (optional — nur 6 Slots: 1–6)
```js
const KEYS = { '1':'qwen', '2':'step', '3':'nemotron', '4':'gemma', '5':'geminiflashlite', '6':'llama' };
// Ein bestehendes ersetzen wenn das neue Modell wichtiger ist
```

### 5. `planModels` (optional — Think→Code-Splitting)
Wenn das Modell langsam denkt und von einer vorgeschalteten Planungsanfrage profitiert:
```js
const planModels = new Set(['qwen', 'step', 'nemotron', 'minimax']);  // ← ergänzen
```

---

## Änderungen in `about.html`

```html
<li>
  <span style="color:#4fc1ff;font-family:monospace;">minimax/minimax-m2.5:free</span>
  — MiniMax M2.5 via OpenRouter
</li>
```

---

## Änderungen in `CLAUDE.md`

- Modell-Liste unter **AI-Modelle** ergänzen
- Fallback-Tabelle aktualisieren (neue Zeile + Einbau in bestehende Ketten)
- OpenRouter-Modelle-Zeile ergänzen (falls OpenRouter)

---

## Kriterien für neue Free-Modelle (OpenRouter)

- Programming-Ranking auf openrouter.ai/collections/free-models
- Kontext ≥ 128K (wegen großer Prompts mit mehreren Dateien)
- Modell-ID auf OpenRouter verifizieren — nicht aus PDF/Beschreibung übernehmen, sondern aus dem API-Beispiel der OpenRouter-Seite ablesen (Feld `model:`)
