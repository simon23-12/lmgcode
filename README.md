```
░▒▓█▓▒░      ░▒▓██████████████▓▒░ ░▒▓██████▓▒░        ░▒▓██████▓▒░ ░▒▓██████▓▒░░▒▓███████▓▒░░▒▓████████▓▒░ 
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒▒▓███▓▒░      ░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓██████▓▒░   
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░      ░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        
░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░        ░▒▓██████▓▒░ ░▒▓██████▓▒░░▒▓███████▓▒░░▒▓████████▓▒░ 
```

**Type:** HTML, JS, CSS  
**Purpose:** Browser-basierter Coding-Assistent für Informatikschüler (Klassen 5–13) am Leibniz-Montessori-Gymnasium Düsseldorf — ähnlich wie Claude Code / VS Code im Browser.  
**URL:** https://lmgcode.vercel.app  
**Vercel-Projekt:** simons-projects-56ea3d55/lmgcode

## Dateistruktur

```
LMG Code/
├── index.html            # Komplette App — CSS + JS inline (single-file)
├── vercel.json           # maxDuration 300s + CSP-Header für Monaco-Worker
├── about.html            # About-Seite (Tech Stack, Kurzbefehle, Datenschutz)
├── api/
│   ├── chat.js           # Vercel Serverless → OpenRouter + Google AI Studio (ESM)
│   ├── run.js            # Code-Execution via Wandbox (C, C++, C#, TypeScript, Ruby)
│   ├── jdoodle.js        # Java-Execution via JDoodle API
│   └── package.json      # { "@google/generative-ai": "^0.21.0" }
└── Logo LMG Code.jpg     # App-Logo (wird im Header angezeigt)
```

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS, keine Frameworks, kein Build-Step
- **Editor:** Monaco Editor 0.47.0 via jsDelivr CDN (AMD-Loader)
- **ZIP-Entpacken:** fflate 0.8.2 via CDN
- **Markdown-Rendering:** marked.js 12.0.0 via CDN (nur Bot-Antworten)
- **Icons:** Font Awesome 6.5.0 via CDN
- **Backend:** Vercel Serverless Functions (Node.js, ESM)
- **AI-Modelle:** Sieben Modelle, User wählt im Dropdown — **Standard: Gemini 3.1 Flash Lite**:
  - **Gemini 3.1 Flash Lite** (Standard): `gemini-3.1-flash-lite-preview` via Google AI Studio
  - **Llama 3.3 70B**: `meta-llama/llama-3.3-70b-versatile` via Groq
  - **Kimi K2**: `moonshotai/kimi-k2-instruct-0905` via Groq
  - **Qwen**: `qwen/qwen3.6-plus:free` via OpenRouter
  - **Step 3.5 Flash**: `stepfun/step-3.5-flash:free` via OpenRouter
  - **Nemotron 3 Super**: `nvidia/nemotron-3-super-120b-a12b:free` via OpenRouter
  - **Gemma 4 31B**: `gemma-4-31b-it` via Google AI Studio (`@google/generative-ai` SDK)
- **Code-Execution:** Pyodide (Python, WASM im Browser) · Wandbox API (C, C++, C#, TypeScript, Ruby) · JDoodle API (Java)
- **Environment Variables:** `OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, `JDOODLE_CLIENT_ID`, `JDOODLE_CLIENT_SECRET`

## Layout

Drei-Spalten-Grid (`220px | 1fr | 340px`), vollständig im Viewport (`100dvh`):

```
┌─────────────┬──────────────────────────────┬──────────────────┐
│  Dateibaum  │       Monaco Editor          │   Chat-Panel     │
│   220px     │         flex: 1              │    340px         │
│  [Ordner]   │  [Tabs ──────────────────]   │  [Verlauf]       │
│  [ZIP]      │                              │  [Eingabe+Send]  │
└─────────────┴──────────────────────────────┴──────────────────┘
```

## Architektur

### Virtual File System (vfs)
Alle Dateien leben nur im Browser-Memory (kein localStorage, kein Backend):
```js
vfs[path] = { content, language, model }
// model = Monaco ITextModel — wird einmal erstellt, nie neu erstellt beim Tab-Wechsel
```

### Kontext-Strategie
Nur **geöffnete Tabs** werden als Kontext ans Modell geschickt — nicht alle Dateien im Baum. Ein Badge im Chat-Header zeigt wie viele Dateien im Kontext sind. Max. 60.000 Zeichen pro Datei (dann gekürzt).

### Prompt-Struktur
```
[System-Instruktion]
[Projektdateien — nur offene Tabs]
[Aktuell sichtbare Datei]
[Gesprächsverlauf — letzte 10 Nachrichten]
[Aktuelle Frage]
```

### Serverless Function (`api/chat.js`)
- Empfängt `{ prompt: string, model: 'qwen' | 'step' | 'nemotron' | 'gemma', stream?: boolean }` — Prompt komplett im Frontend assembliert
- Probiert **genau ein Modell** pro Request — kein interner Fallback-Loop
- **Streaming-Modus** (`stream: true`): antwortet mit `Content-Type: text/event-stream` (SSE), SSE-Response direkt an Client gepipet
- **Non-Streaming-Modus**: antwortet mit `{ text, promptTokens, completionTokens }` oder `{ error, retryable }`
- Input-Limit: 500.000 Zeichen
- 57s AbortController-Timeout für den initialen HTTP-Connect (Streaming-Funktionen: nur bis Headers empfangen)

### Fallback-Strategie (Frontend)
Fallback-Logik liegt im **Frontend** (`FALLBACK_CHAINS` in `index.html`), nicht im Backend. Jeder Retry ist ein neuer HTTP-Request → neue Vercel-Instanz → frische 300 Sekunden.

| Gewähltes Modell | Kette |
|---|---|
| Gemini Flash Lite (Standard) | Gemini Flash Lite → Gemma → Qwen → Step → Nemotron |
| Llama | Llama → Gemini Flash Lite → Qwen → Step → Nemotron → Gemma |
| Qwen | Qwen → Gemini Flash Lite → Step → Nemotron → Gemma |
| Step | Step → Nemotron → Qwen → Gemma |
| Nemotron | Nemotron → Step → Qwen → Gemma |
| Gemma | Gemma → Gemini Flash Lite → Qwen → Step → Nemotron |
| Kimi | Kimi → Step → Gemini Flash Lite → Qwen |

Die Fallback-Kette gilt für **beide Modi** (streaming und non-streaming):
- Retryable-Fehler (429, 503, Timeout, Stream ohne `[DONE]` und ohne Content) → nächste Stufe
- Fatale Fehler (Auth, bad request) → sofort stoppen

**Regel beim Hinzufügen neuer Modelle:** Kette in `FALLBACK_CHAINS` in `index.html` ergänzen + `MODEL_MAP` in `api/chat.js` ergänzen.

### Multi-Agent-Modus
Mehrere unabhängige Chat-Agenten können gleichzeitig aktiv sein. Jeder Agent hat seinen eigenen State:

```js
agents: Map<id, {
  id, chatHistory, learnMode, isTyping, sessionTokens, model,
  srStreamBase, srStreamApplied, messagesEl  // eigener DOM-Pane
}>
```

- **Plus-Button** im Chat-Header spawnt einen neuen Agenten
- **Agent-Tabs** erscheinen automatisch ab 2 Agenten (×-Button schließt einzelne Agenten, letzter kann nicht geschlossen werden)
- Beim Tab-Wechsel (`switchAgent`) wird Modell-Dropdown und Lernmodus-Toggle auf den jeweiligen Agenten umgeschaltet
- Jeder Agent führt seinen eigenen Fallback-Chain-Durchlauf durch — parallel möglich
- `sendMessage()` und `buildPrompt()` nehmen das `agent`-Objekt als Parameter — kein globaler State mehr für Chat
- `activePane()` liefert den DOM-Pane des aktiven Agenten für `sysMsg`/`sysMsgHtml`

### Streaming-Architektur (`fetchStream` in `index.html`)
Live-Modus ist **immer aktiv** (`liveMode = true`). Code erscheint token-by-token im Monaco-Editor.

- `fetchStream(prompt, modelKey, onStreamStart, onSRDetected, agent)` — versucht genau ein Modell
  - Schlägt fehl **vor** Stream-Start (429, Timeout auf Connect): gibt `{ error, retryable }` zurück, `onStreamStart` wird **nicht** aufgerufen → Typing-Indikator bleibt, nächstes Modell wird versucht
  - Stream startet erfolgreich: ruft `onStreamStart()` auf (Typing-Indikator weg), streamt Chunks
  - **Zweiphasiges Timeout-Modell:**
    - **Phase 1 — Connect:** 57s AbortController bis HTTP-Response-Headers (löst bei Streaming fast sofort auf, da Backend `res.flushHeaders()` sofort sendet)
    - **Phase 2 — First-Token:** 60s Timer startet nach `onStreamStart()`. Kommt kein Token → `controller.abort()` → `{ error, retryable: true }` → Fallback. Kommt erster Token → Timer gelöscht → Stream läuft bis zu Vercels 300s Hard-Limit
  - Monaco-Update via `requestAnimationFrame` (throttled) — `extractStreamingCode()` parst offene/geschlossene Codeblöcke
  - Stream endet mit `[DONE]` → Erfolg: `{ text }`
  - Stream endet abrupt ohne Content → `{ error, retryable: true }` → nächstes Modell
  - Stream endet abrupt mit partiellem Content → gibt partial Text zurück (wird als Erfolg behandelt)
- Chat-Panel zeigt während des Streamings **nichts** — erst nach Abschluss erscheint Quip oder vollständige Antwort

### OpenRouter-Integration
- Kein SDK — nativer `fetch` gegen `https://openrouter.ai/api/v1/chat/completions` (OpenAI-kompatibel)
- Non-Streaming: `tryOpenRouter(prompt, orModel)` gibt Text zurück oder wirft
- Streaming: `streamOpenRouter(prompt, orModel, res)` pipet SSE-Body direkt via `res.write()`
- OpenRouter-Modelle: `qwen/qwen3.6-plus:free`, `stepfun/step-3.5-flash:free`, `nvidia/nemotron-3-super-120b-a12b:free`
- Google AI Studio: `gemma-4-31b-it` via `@google/generative-ai` SDK (rate-limited, kostenlos)
- Kriterien für Free-Modelle: Programming-Ranking auf openrouter.ai/collections/free-models + Kontext ≥ 128K (wegen großer Prompts)
- $1-Spending-Limit auf dem OpenRouter-Key als Sicherheitsnetz; alle `:free`-Modelle kosten $0

### Code-Execution

| Sprache | Endpoint | Mechanismus |
|---|---|---|
| Python | — (Browser) | Pyodide 0.27.0 (WASM) |
| C, C++, C#, TypeScript, Ruby | `api/run.js` | Wandbox API |
| Java | `api/jdoodle.js` | JDoodle REST API |
| HTML/CSS/JS | — (Browser) | Live-Vorschau im iframe |

## Frugal Coding Rules

- Single-file Frontend — kein Build-Step, kein Bundler
- Kein Framework, kein npm im Root
- Kein Datenbankbedarf (State lebt im Browser)
- Nur geöffnete Tabs als Kontext (nicht alle Dateien)

## Wichtige Pitfalls (Monaco)

- **CSP:** `unsafe-eval` + `blob:` + `worker-src blob:` in vercel.json zwingend — sonst kein Syntax-Highlighting
- **Worker:** `window.MonacoEnvironment.getWorkerUrl` muss auf CDN-Worker zeigen (via data-URL)
- **Resize:** `editor.layout()` manuell aufrufen — Monaco reagiert nicht auf CSS-Änderungen
- **Models:** Pro Datei genau ein `ITextModel` — beim Tab-Wechsel nur `editor.setModel()`, nie `dispose()` + neu erstellen (sonst geht Undo-History verloren)

## System-Prompt Philosophie

Der Assistent **schreibt Code wenn gewünscht** — er ist kein Lehrer der nur Hinweise gibt. Er erklärt kurz was der Code macht, hält Erklärungen aber knapp. Antwortet in der Sprache des Schülers (DE/EN).


