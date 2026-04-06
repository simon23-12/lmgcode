export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code } = req.body;
  if (!code) return res.status(400).json({ message: 'code required' });

  const clientId     = process.env.JDOODLE_CLIENT_ID;
  const clientSecret = process.env.JDOODLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(500).json({ message: 'JDoodle nicht konfiguriert.' });

  let data;
  try {
    const r = await fetch('https://api.jdoodle.com/v1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret, script: code, language: 'java', versionIndex: '4' }),
    });
    data = await r.json();
  } catch (e) {
    return res.status(502).json({ message: `JDoodle nicht erreichbar: ${e.message}` });
  }

  if (data.error) return res.status(200).json({ message: data.error });

  // JDoodle liefert stdout+stderr kombiniert in `output`, exitCode in `statusCode` (0 = OK)
  const exitCode = typeof data.statusCode === 'number' ? data.statusCode : 0;
  res.status(200).json({ output: data.output ?? '', exitCode });
}
