// Proxies TeaVM playground files from teavm.org with CORS + caching headers.
// Required because teavm.org has no Access-Control-Allow-Origin header.

const FILES = {
  'runtime.js':       { url: 'https://teavm.org/playground/3/compiler.wasm-runtime.js', type: 'text/javascript; charset=utf-8' },
  'compiler.wasm':    { url: 'https://teavm.org/playground/3/compiler.wasm',             type: 'application/wasm' },
  'compile-classlib': { url: 'https://teavm.org/playground/3/compile-classlib-teavm.bin', type: 'application/octet-stream' },
  'runtime-classlib': { url: 'https://teavm.org/playground/3/runtime-classlib-teavm.bin', type: 'application/octet-stream' },
};

export default async function handler(req, res) {
  const { file } = req.query;
  const entry = file && FILES[file];
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }

  let upstream;
  try {
    upstream = await fetch(entry.url);
  } catch (e) {
    res.status(502).json({ error: 'Upstream unreachable' }); return;
  }
  if (!upstream.ok) { res.status(502).json({ error: `Upstream ${upstream.status}` }); return; }

  res.setHeader('Content-Type', entry.type);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
