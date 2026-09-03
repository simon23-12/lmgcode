# Modelle pflegen

Alle Modelle stehen in **`models.json`** — das ist die einzige Quelle der Wahrheit.
Nichts in `index.html`, `api/chat.js`, `api/sanity.js` oder `about.html` von Hand
anfassen: die Bereiche zwischen den `models:*`-Markern werden generiert.

## Der Normalfall: automatisch aktualisieren

```bash
node scripts/update-models.mjs           # prüfen — ändert nichts
node scripts/update-models.mjs --apply   # tote Modelle ersetzen + alles synchronisieren
vercel --prod --yes
```

`update-models.mjs` lädt die Live-Kataloge von **Google AI Studio**, **Groq** und
**OpenRouter**, vergleicht sie mit `models.json` und testet jedes eingebundene
Modell mit einem 1-Token-Request. Der Bericht zeigt:

- welche Modelle verschwunden oder tot sind
- ob ein Preview-Modell inzwischen eine stabile Version hat
  (`gemini-3.1-flash-lite-preview` → `gemini-3.1-flash-lite`)
- neue freie Kandidaten je Provider (kostenlos, ≥ 128K Kontext, Text→Text)

Mit `--apply` ersetzt das Skript tote Modelle selbstständig. Dabei gilt:

1. Ersatz möglichst aus derselben Familie (`minimax-m2.5:free` → `minimax-m3:free`)
2. sonst der bestbewertete freie Kandidat (Coding-Modelle und großer Kontext zählen)
3. **jeder Kandidat wird vorher live getestet** — nur was antwortet, wird eingetragen
4. passt der interne Key nicht mehr zum neuen Modell, wird er umbenannt
   (`llama` → `qwen`), inklusive aller Fallback-Ketten
5. anschließend läuft `sync-models.mjs` automatisch

Weitere Schalter: `--json` (maschinenlesbar), `--no-test` (nur Katalog-Abgleich, keine Requests).

## Ein Modell von Hand ändern

`models.json` bearbeiten, dann:

```bash
node scripts/sync-models.mjs
```

Ein Eintrag sieht so aus:

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `key` | ja | interner Bezeichner (`model`-Parameter der API, Dropdown-Wert) |
| `label` | ja | Anzeigename im Dropdown, Chat und Sanity-Check |
| `provider` | ja | `google` · `groq` · `openrouter` |
| `id` | ja | echte Modell-ID beim Provider |
| `rank` | ja | Reihenfolge im Dropdown **und** Priorität in den Fallback-Ketten (1 = beste) |
| `hotkey` | nein | Ziffer für `/model` (1–6) |
| `plan` | nein | `true` = Think→Code-Splitting (langsam denkende Modelle) |
| `fallback` | nein | `false` = darf nicht als Fallback für andere dienen |
| `chain` | nein | feste Fallback-Kette statt der automatisch abgeleiteten |

Die Fallback-Ketten werden aus `rank` berechnet: erst das Modell selbst, dann die
übrigen nach Rang — der erste Fallback kommt aber möglichst von einem **anderen
Provider**, damit ein Provider-Ausfall nicht die ganze Kette killt. Länge über
`maxChainLength`.

## Was wo generiert wird

| Datei | Marker | Inhalt |
|---|---|---|
| `api/chat.js` | `models:maps` | `GOOGLE_MODELS`, `MODEL_MAP`, `GOOGLE_TARGETS`, `GROQ_TARGETS`, `isGoogleModel`, `isGroqModel` |
| `api/sanity.js` | `models:models` | Liste für den `/api/sanity`-Endpoint |
| `index.html` | `models:dropdown` | die `<option>`-Einträge |
| `index.html` | `models:maps` | `SLASH_MODEL_NAMES`, `MODEL_HOTKEYS`, `MODEL_HOTKEY_HINT`, `FALLBACK_CHAINS`, `PLAN_MODELS` |
| `about.html` | `models:models` | Modell-Liste im Tech-Stack |
| `CLAUDE.md` / `README.md` | `models:models`, `models:chains` | Modell-Liste + Fallback-Tabelle |

`node scripts/sync-models.mjs --check` prüft nur und endet mit Exit-Code 1, wenn
eine Datei nicht mehr zu `models.json` passt.

## Neuen Provider anbinden

Nur dann ist echte Handarbeit nötig — in `scripts/lib/config.mjs` (erlaubte
Provider), `scripts/update-models.mjs` (Katalog + Live-Test) und in `api/chat.js`
eine `tryX`/`streamX`-Funktion analog zu Groq.
