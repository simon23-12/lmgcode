const COMPILER_MAP = {
  python:     'cpython-3.13.8',
  c:          'gcc-head-c',
  'c++':      'gcc-head',
  csharp:     'mono-6.12.0.199',
  typescript: 'typescript-5.6.2',
  ruby:       'ruby-3.4.1',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { language, files } = req.body;
  if (!language || !files?.length) return res.status(400).json({ message: 'language and files required' });

  const compiler = COMPILER_MAP[language.toLowerCase()];
  if (!compiler) return res.status(400).json({ message: `Sprache "${language}" wird noch nicht unterstützt.` });

  const code = files[0].content;
  const body = { code, compiler };

  let text, data;
  try {
    const r = await fetch('https://wandbox.org/api/compile.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    text = await r.text();
    data = JSON.parse(text);
  } catch (e) {
    const msg = text ? `Wandbox: ${text.slice(0, 200)}` : `Nicht erreichbar: ${e.message}`;
    return res.status(502).json({ message: msg });
  }

  if (data.error) return res.status(200).json({ message: data.error });

  const compilerErr = [data.compiler_error, data.compiler_output].filter(Boolean).join('\n');
  res.status(200).json({
    run: {
      stdout: data.program_output || '',
      stderr: compilerErr ? compilerErr + '\n' + (data.program_error || '') : (data.program_error || ''),
      code:   parseInt(data.status ?? '0', 10),
    }
  });
}
