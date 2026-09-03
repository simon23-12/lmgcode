const COMPILER_MAP = {
  java:    'openjdk-25',
  go:      'go-1.26',
  rust:    'rust-1.93',
  haskell: 'haskell-9.12',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code, language = 'java' } = req.body;
  if (!code) return res.status(400).json({ message: 'code required' });

  const compiler = COMPILER_MAP[language];
  if (!compiler) return res.status(400).json({ message: `Sprache "${language}" nicht unterstützt.` });

  const apiKey = process.env.ONLINECOMPILER_API_KEY;
  if (!apiKey) return res.status(500).json({ message: 'onlinecompiler.io nicht konfiguriert.' });

  let data;
  try {
    const r = await fetch('https://api.onlinecompiler.io/api/run-code-sync/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
      body: JSON.stringify({ compiler, code }),
    });
    data = await r.json();
  } catch (e) {
    return res.status(502).json({ message: `onlinecompiler.io nicht erreichbar: ${e.message}` });
  }

  if (data.error) return res.status(200).json({ message: data.error });

  const exitCode = typeof data.exitCode === 'number' ? data.exitCode : 0;
  const output = (data.output ?? '') + (data.stderr ? '\n' + data.stderr : '');
  res.status(200).json({ output: output.trim(), exitCode });
}
