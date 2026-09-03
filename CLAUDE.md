# LMG Code

**Type:** HTML, JS, CSS  
**Purpose:** Browser-basierter Coding-Assistent für Informatikschüler (Klassen 5–13) am Leibniz-Montessori-Gymnasium Düsseldorf — ähnlich wie Claude Code / VS Code im Browser.  
**URL:** https://lmgcode.vercel.app  
**Vercel-Projekt:** simons-projects-56ea3d55/lmgcode

## Dateistruktur

```
LMG Code/
├── models.json           # EINZIGE QUELLE DER WAHRHEIT für alle KI-Modelle
├── index.html            # Komplette App — CSS + JS inline (single-file)
├── vercel.json           # maxDuration 300s + CSP-Header für Monaco-Worker
├── about.html            # About-Seite (Tech Stack, Kurzbefehle, Datenschutz)
├── api/
│   ├── chat.js           # Vercel Serverless → OpenRouter + Google AI Studio (ESM)
│   ├── run.js            # Code-Execution via Wandbox (C, C++, C#, TypeScript, Ruby)
│   ├── jdoodle.js        # Java/Go/Rust/Haskell-Execution via onlinecompiler.io
│   ├── teavm-proxy.js    # (veraltet, nicht mehr genutzt)
│   └── package.json      # { "@google/generative-ai": "^0.21.0" }
├── scripts/
│   ├── update-models.mjs # Modelle gegen Provider-Kataloge prüfen/reparieren (--apply)
│   ├── sync-models.mjs   # models.json → generierte Blöcke in allen Dateien
│   ├── sanity.mjs        # 1-Token-Live-Test aller Modelle (CLI)
│   └── lib/config.mjs    # models.json laden, Ketten ableiten, .env.local lesen
└── Logo LMG Code.jpg     # App-Logo (wird im Header angezeigt)
```

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS, keine Frameworks, kein Build-Step
- **Editor:** Monaco Editor 0.47.0 via jsDelivr CDN (AMD-Loader)
- **ZIP-Entpacken:** fflate 0.8.2 via CDN
- **Markdown-Rendering:** marked.js 12.0.0 via CDN (nur Bot-Antworten)
- **Icons:** Font Awesome 6.5.0 via CDN
- **Backend:** Vercel Serverless Functions (Node.js, ESM)
<!-- models:models -->
- **AI-Modelle:** Neun Modelle, User wählt im Dropdown — **Standard: Gemini 3.1 Flash Lite**:
  - **Gemini 3.1 Flash Lite** (Standard): `gemini-3.1-flash-lite` via Google AI Studio
  - **Gemini 3.6 Flash**: `gemini-3.6-flash` via Google AI Studio
  - **North Mini Code**: `cohere/north-mini-code:free` via OpenRouter
  - **MiniMax M3**: `minimax/minimax-m3:free` via OpenRouter
  - **Nemotron 3 Super**: `nvidia/nemotron-3-super-120b-a12b:free` via OpenRouter
  - **Gemma 4 31B**: `gemma-4-31b-it` via Google AI Studio
  - **Qwen3.8-27B**: `qwen/qwen3.8-27b` via Groq
  - **GPT-OSS 120B**: `openai/gpt-oss-120b` via Groq
  - **Free Models Router**: `openrouter/free` via OpenRouter
<!-- /models:models -->
- **Code-Execution:** Pyodide (Python + TigerJython `.tj`, WASM im Browser) · Wandbox API (C, C++, C#, TypeScript, Ruby, Swift) · onlinecompiler.io (Java/BlueJ, Go, Rust, Haskell)
- **Environment Variables:** `OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, `ONLINECOMPILER_API_KEY`

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

<!-- models:chains -->
| Gewähltes Modell | Kette |
|---|---|
| Gemini 3.1 Flash Lite (Standard) | Gemini 3.1 Flash Lite → North Mini Code → MiniMax M3 → Nemotron 3 Super → Gemma 4 31B |
| Gemini 3.6 Flash | Gemini 3.6 Flash → Gemini 3.1 Flash Lite → MiniMax M3 → North Mini Code → Gemma 4 31B |
| North Mini Code | North Mini Code → Gemini 3.1 Flash Lite → MiniMax M3 → Nemotron 3 Super → Gemma 4 31B |
| MiniMax M3 | MiniMax M3 → Gemini 3.1 Flash Lite → North Mini Code → Nemotron 3 Super → Gemma 4 31B |
| Nemotron 3 Super | Nemotron 3 Super → Gemini 3.1 Flash Lite → North Mini Code → MiniMax M3 → Gemma 4 31B |
| Gemma 4 31B | Gemma 4 31B → North Mini Code → Gemini 3.1 Flash Lite → MiniMax M3 → Nemotron 3 Super |
| Qwen3.8-27B | Qwen3.8-27B → Gemini 3.1 Flash Lite → North Mini Code → MiniMax M3 → Nemotron 3 Super |
| GPT-OSS 120B | GPT-OSS 120B → Gemini 3.1 Flash Lite → North Mini Code → MiniMax M3 → Nemotron 3 Super |
| Free Models Router | Free Models Router → Gemini 3.1 Flash Lite → North Mini Code → MiniMax M3 → Nemotron 3 Super |
<!-- /models:chains -->

Die Fallback-Kette gilt für **beide Modi** (streaming und non-streaming):
- Retryable-Fehler (429, 503, Timeout, Stream ohne `[DONE]` und ohne Content) → nächste Stufe
- Fatale Fehler (Auth, bad request) → sofort stoppen

**Regel beim Hinzufügen/Ändern von Modellen:** Nur `models.json` bearbeiten, danach `node scripts/sync-models.mjs`. Die Datei ist die einzige Quelle der Wahrheit; `MODEL_MAP`, `GOOGLE_MODELS`, `FALLBACK_CHAINS`, `SLASH_MODEL_NAMES`, das Dropdown, `api/sanity.js` und die Modell-Listen in `about.html`/`CLAUDE.md`/`README.md` werden daraus generiert (Bereiche zwischen `models:*`-Markern — nicht von Hand editieren).

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
- Welche Modelle über welchen Provider laufen, steht in `models.json` — nicht hier pflegen
- Google AI Studio: `gemma-4-31b-it` via `@google/generative-ai` SDK (rate-limited, kostenlos)
- Kriterien für Free-Modelle: kostenlos (`:free` bzw. Freikontingent), Kontext ≥ 128K, Text→Text. `scripts/update-models.mjs` filtert genau danach und schlägt passende Kandidaten vor.
- $1-Spending-Limit auf dem OpenRouter-Key als Sicherheitsnetz; alle `:free`-Modelle kosten $0

### Kontingente — der eigentliche Engpass

**OpenRouter `:free` (Stand 2026-09-03):** 20 Anfragen/Minute und **50 pro Tag** — pro **Account**, nicht pro Key. Zusätzliche Keys oder Accounts ändern daran nichts, OpenRouter steuert die Kapazität global.

Die Schwelle für **1.000 Anfragen/Tag** sind **10 $ kumuliert gekaufte Credits (all-time)** — kein Mindestguthaben. Der Schalter bleibt umgelegt, auch wenn das Guthaben später wieder auf 0 fällt. `:free`-Modelle kosten $0 pro Token (im Katalog steht bei allen `pricing.prompt: "0"`), das Guthaben wird davon also nicht aufgezehrt.

**Kontostand am 2026-09-03:** `total_credits: 5`, `total_usage: 0.77` — es sind erst **5 $ gekauft**, deshalb greift noch das 50er-Limit. Es fehlen also **5 $, nicht 10 $**; die Fehlermeldung sagt das auch wörtlich („Add 5 credits to unlock 1000 free model requests per day"). Abfragen mit: `curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/credits`

**Was der Kauf NICHT ändert:** die 20 Anfragen/Minute. Bei 30 Schülern, die gleichzeitig auf Senden drücken, ist das weiterhin der bindende Engpass — ein Grund mehr, warum der Standard auf Google liegt. Der Tageszähler läuft um Mitternacht UTC zurück. Ungenutztes Guthaben kann OpenRouter nach einem Jahr verfallen lassen; die freigeschaltete Stufe bleibt davon unberührt.

Quelle: https://openrouter.ai/docs/api-reference/limits

> 50 Anfragen/Tag sind bei einem Kurs mit 30 Schülern nach zehn Minuten weg. Symptom: HTTP 429 `Rate limit exceeded: free-models-per-day`. `/sanity` in der App zeigt solche Modelle als **Tageslimit erreicht** (orange ⚠), `node scripts/sanity.mjs` als ✗ mit der Fehlermeldung. Vor jeder Fehlersuche also erst prüfen, ob es nur das Tageslimit ist — die Modelle sind nicht kaputt.

Das Limit gilt **gemeinsam für alle** OpenRouter-Modelle in `models.json` (aktuell North Mini Code, MiniMax M3, Nemotron, Free Models Router). Deshalb steht als Standard bewusst ein Google-Modell — sonst läuft der komplette Unterrichtsalltag durch diesen einen Topf.

**Google AI Studio:** ebenfalls ein Free Tier mit Limits, aber **pro Modell** statt aus einem gemeinsamen Topf — Gemini Flash Lite und Gemma haben getrennte Kontingente. Google veröffentlicht die Zahlen nicht mehr in den Docs; die tatsächlichen Limits des Keys stehen unter https://aistudio.google.com/rate-limit

**Groq:** eigenes Freikontingent, unabhängig von beiden.

### Modellwahl — Messwerte (2026-09-03)

Gemessen mit dem echten App-Prompt und dem Schul-Key, mehrere Läufe je Modell:

| Modell | Neubau (Flappy Bird, leeres Projekt) | Kleiner Edit |
|---|---|---|
| gemini-3.1-flash-lite (Standard) | 3/3 erfolgreich, aber nur 29–30 Zeilen ohne Röhren/Punkte | **1,7s** |
| gemini-3.6-flash | 1/3 erfolgreich (sonst HTTP 503), dann 95–101 Zeilen vollständig | 7,6s |
| gemini-3.7-flash / gemini-3.8-flash | **0/3** — durchgehend HTTP 503 „high demand" | 4,2s |
| gemini-3.5-flash-lite | 0/1 — gar kein Code | 20,4s |
| MiniMax M3 | 220 Zeilen vollständig (18s) | 3,5s |
| Free Models Router | 99–218 Zeilen vollständig (27–51s) | 6,8–14,2s |

**Warum Flash Lite trotzdem Standard ist:** nicht weil es das stärkste ist, sondern weil es als einziges zuverlässig antwortet und beim häufigen Fall (kleine Edits) das schnellste ist. Die starken Flash-Modelle sind im Free Tier kapazitätsgedeckelt. Der 503 kommt als retryable durch, die Fallback-Kette greift also korrekt.

**Free Models Router** (`openrouter/free`) liefert bei Neubauten die besten Ergebnisse, ist aber ein **Zufalls-Router** — bei identischem Prompt 99 vs. 186 vs. 218 Zeilen. Für den Unterricht als Standard ungeeignet (nicht reproduzierbar, 4–8× langsamer bei kleinen Edits, hängt am geteilten Tageslimit, und es ist nicht nachvollziehbar welcher Anbieter die Eingaben bekommt). Als bewusst wählbare Option dagegen sinnvoll — darauf weist `neubauHinweis()` in `index.html` bei leerem Projekt einmalig hin.

### Code-Execution

| Sprache | Endpoint | Mechanismus |
|---|---|---|
| Python (`.py`) | — (Browser) | Pyodide 0.27.0 (WASM) |
| TigerJython (`.tj`) | — (Browser) | Pyodide + `repeat n:` Preprocessing |
| Java/BlueJ (`.java`) | `api/jdoodle.js` | onlinecompiler.io |
| C, C++, C#, TypeScript, Ruby, Swift | `api/run.js` | Wandbox API |
| Go, Rust, Haskell | `api/jdoodle.js` | onlinecompiler.io REST API (`POST https://api.onlinecompiler.io/api/run-code-sync/`) |
| HTML/CSS/JS | — (Browser) | Live-Vorschau im iframe |

**onlinecompiler.io:** Empfängt `{ compiler, code }`, Auth via `Authorization: <key>` (kein Bearer-Prefix). Free-Tier: 1 Mio Requests/Monat. Compiler-IDs: `openjdk-25` (Java), `go-1.26` (Go), `rust-1.93` (Rust), `haskell-9.12` (Haskell). Response-Felder: `output`, `stderr`, `exitCode`. Output truncated at 999 Zeichen.

**Swift:** Läuft über Wandbox (`swift-6.0.1`), aber der Wandbox-Container ist derzeit defekt (catatonit-Fehler). Swift ist eingebaut, funktioniert aber nicht zuverlässig — Xcode-Ökosystem fehlt ohnehin für sinnvolle Nutzung.

**Verworfene Alternativen:**
- **JDoodle**: Ersetzt durch onlinecompiler.io — JDoodle hatte nur ~22 Ausführungen/Tag effektiv.
- **Piston API** (emkc.org): Im Februar 2026 eingestellt — nicht mehr verfügbar.
- **Wandbox für Java**: Funktioniert nicht für Java.
- **Judge0** (self-hosted): Zu komplex, benötigt Docker-fähigen Server.

## Frugal Coding Rules

- Single-file Frontend — kein Build-Step, kein Bundler
- Kein Framework, kein npm im Root
- Kein Datenbankbedarf (State lebt im Browser)
- Nur geöffnete Tabs als Kontext (nicht alle Dateien)

## Wichtige Pitfalls (Vorschau)

Die Vorschau ist ein `<iframe srcdoc>` mit `sandbox="allow-scripts allow-forms allow-modals"`. Daraus folgen zwei Fallen, die im Schülerprojekt als „geht einfach nicht" auftauchen:

- **Die CSP der Elternseite gilt auch im iframe.** `srcdoc`-Dokumente erben sie. Externe Bibliotheken laufen deshalb nur von `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `unpkg.com` und `esm.sh` — alles andere (z.B. `threejs.org/build/...`) wird blockiert. Bilder und Medien sind über `img-src`/`media-src https:` freigegeben, weil sie inert sind; sonst scheitern Texturen und Sprites an einer unsichtbaren Wand. Neue CDNs müssen in `vercel.json` **und** im Prompt-Zweig „LEERES PROJEKT" in `index.html` ergänzt werden.
- **Kein `allow-same-origin` → undurchsichtiger Origin.** `localStorage` und `sessionStorage` werfen dort `SecurityError`; ein Spiel, das seinen Highscore speichert, stirbt kommentarlos. `buildPreviewHtml()` stellt der Vorschau deshalb `LOCALSTORAGE_SHIM` voran — ein Ersatz im Arbeitsspeicher mit gleicher API, der bis zum Neuladen der Vorschau hält. `allow-same-origin` darf **nicht** ergänzt werden: zusammen mit `allow-scripts` könnte der Vorschau-Code sonst auf die App selbst zugreifen.

Verifiziert (2026-09-03): Three.js r160 per ESM-Importmap von unpkg lädt, WebGL rendert, `localStorage` funktioniert über den Shim.

## Wichtige Pitfalls (Monaco)

- **CSP:** `unsafe-eval` + `blob:` + `worker-src blob:` in vercel.json zwingend — sonst kein Syntax-Highlighting
- **Worker:** `window.MonacoEnvironment.getWorkerUrl` muss auf CDN-Worker zeigen (via data-URL)
- **Resize:** `editor.layout()` manuell aufrufen — Monaco reagiert nicht auf CSS-Änderungen
- **Models:** Pro Datei genau ein `ITextModel` — beim Tab-Wechsel nur `editor.setModel()`, nie `dispose()` + neu erstellen (sonst geht Undo-History verloren)

## System-Prompt Philosophie

Der Assistent **schreibt Code wenn gewünscht** — er ist kein Lehrer der nur Hinweise gibt. Er erklärt kurz was der Code macht, hält Erklärungen aber knapp. Antwortet in der Sprache des Schülers (DE/EN).

## Lokale Entwicklung (vercel dev)

Simuliert die Vercel-Umgebung lokal — API-Funktionen laufen identisch zu Produktion, kein echter Deploy.

```bash
cd "/Users/sim/Documents/LMG Code"

# Einmalig (oder nach Änderungen an Env-Vars auf Vercel):
vercel env pull .env.local

# Dev-Server starten:
vercel dev
# → http://localhost:3000
Crtl+C: Dev Modus stoppen

- `api/node_modules` muss lokal installiert sein: `cd api && npm install`
- `.env.local` enthält alle API-Keys — nicht committen (steht in .gitignore)
- Seite neu laden reicht für HTML/JS-Änderungen — kein Restart nötig

## Deployment

```bash
cd "/Users/sim/Documents/LMG Code"
vercel --prod --yes
```

Windows:
- cd "C:\Users\simon\Desktop\Programmieren\lmgcode
- vercel login
- vercel --prod --yes

Vercel setzt den API-Key automatisch (bereits konfiguriert unter Settings → Environment Variables).
