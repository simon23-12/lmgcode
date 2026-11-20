// Aufgabenkatalog für den Sammler: typische Schüleranfragen an typische Projekte.
// Jede Aufgabe wird gegen jedes gewählte Modell geschickt; die Antwort wird mit
// `erwartet` geprüft (Format wie in den Replay-Fällen, siehe lib/harness.mjs).
//
// Erwartungen bewusst LOCKER formulieren (regex statt exakter Strings): Wir
// wollen erkennen, ob die Änderung angekommen ist — nicht, ob das Modell genau
// unsere Lösung schreibt. Sonst landet jede zweite gute Antwort in pruefen/.

const zaehlerHtml = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Zähler</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Mein Zähler</h1>
  <p id="anzeige">0</p>
  <button id="plus">+1</button>
  <script src="script.js"></script>
</body>
</html>`;

const zaehlerCss = `body {
  font-family: sans-serif;
  background: #f0f0f0;
  text-align: center;
}

h1 {
  color: navy;
}

button {
  font-size: 2rem;
  padding: 10px 20px;
}`;

const zaehlerJs = `let zaehler = 0;
const anzeige = document.getElementById('anzeige');
const plus = document.getElementById('plus');

plus.addEventListener('click', () => {
  zaehler++;
  anzeige.textContent = zaehler;
});`;

const zaehler = { 'index.html': zaehlerHtml, 'style.css': zaehlerCss, 'script.js': zaehlerJs };
const alleOffen = ['index.html', 'style.css', 'script.js'];

// Ein Python-Projekt (Klasse 9/10) — anderer Dateityp, kein HTML-Sonderweg
const pythonProjekt = {
  'rechner.py': `def addiere(a, b):
    return a + b


def main():
    x = int(input("Erste Zahl: "))
    y = int(input("Zweite Zahl: "))
    print("Summe:", addiere(x, y))


main()
`,
};

export const AUFGABEN = [
  {
    id: 'css-farbe',
    titel: 'Eine CSS-Eigenschaft ändern (aktive Datei)',
    dateien: zaehler, offen: alleOffen, aktiv: 'style.css',
    frage: 'Mach die Überschrift rot',
    erwartet: {
      dateien: { 'style.css': { regex: ['h1\\s*\\{[^}]*(red|#f00\\b|#ff0000|rgb\\(\\s*255\\s*,\\s*0\\s*,\\s*0)'] } },
      keineNeuenDateien: true,
    },
  },
  {
    id: 'reset-button',
    titel: 'Feature über HTML + CSS + JS',
    dateien: zaehler, offen: alleOffen, aktiv: 'index.html',
    frage: 'Füge einen roten Reset-Button hinzu, der den Zähler auf 0 setzt',
    erwartet: {
      dateien: {
        'index.html': { mindestens: { '<button': 2 } },
        'style.css': { regex: ['red|#f00\\b|#ff0000|crimson|tomato|rgb\\(\\s*2[0-5]\\d\\s*,\\s*\\d{1,2}\\s*,'] },
        'script.js': { regex: ['=\\s*0\\b'], mindestens: { 'addEventListener': 2 } },
      },
    },
  },
  {
    id: 'neue-seite',
    titel: 'Neue Seite anlegen und verlinken',
    dateien: zaehler, offen: alleOffen, aktiv: 'index.html',
    frage: 'Leg eine Seite kontakt.html mit meiner E-Mail-Adresse an und verlinke sie auf der Startseite',
    erwartet: {
      dateien: {
        'kontakt.html': { nichtLeer: true, regex: ['@'] },
        'index.html': { regex: ['href=["\']\\.?/?kontakt\\.html'] },
      },
    },
  },
  {
    id: 'js-logik',
    titel: 'Logik in der aktiven JS-Datei',
    dateien: zaehler, offen: alleOffen, aktiv: 'script.js',
    frage: 'Wenn der Zähler 10 erreicht, soll er wieder bei 0 anfangen',
    erwartet: {
      dateien: {
        'script.js': { regex: ['10'], enthaelt: ["getElementById('anzeige')"] },
        'index.html': { unveraendert: true },
      },
      keineNeuenDateien: true,
    },
  },
  {
    id: 'untertitel',
    titel: 'HTML-Element + CSS-Regel, HTML aktiv',
    dateien: zaehler, offen: alleOffen, aktiv: 'index.html',
    frage: 'Füge unter der Überschrift einen Untertitel ein und mach ihn grau',
    erwartet: {
      dateien: {
        'index.html': { regex: ['<h1>Mein Zähler</h1>\\s*\\n\\s*<(h2|h3|p)\\b'] },
      },
      // Grau darf in style.css ODER als style="" im HTML stehen
      irgendeineDatei: { regex: ['gr[ae]y|#[6-9a-c]{3}\\b|#[6-9a-c]{6}\\b'] },
      keineNeuenDateien: true,
    },
  },
  {
    id: 'python-funktion',
    titel: 'Python: neue Funktion ergänzen',
    dateien: pythonProjekt, offen: ['rechner.py'], aktiv: 'rechner.py',
    frage: 'Ergänze eine Funktion für die Multiplikation und gib das Produkt auch aus',
    erwartet: {
      dateien: { 'rechner.py': { regex: ['def \\w+\\(', '\\*'], enthaelt: ['def addiere(a, b):', 'main()'] } },
      keineNeuenDateien: true,
    },
  },
  {
    id: 'neubau-spiel',
    titel: 'Neubau aus leerem Projekt',
    dateien: {}, offen: [],
    frage: 'Bau mir ein Spiel: Ein Ball springt herum und man muss ihn anklicken, um Punkte zu bekommen',
    erwartet: {
      irgendeineDatei: { regex: ['<canvas|<div', 'click|mousedown|pointerdown'] },
    },
  },
];
