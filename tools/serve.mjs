// A small static server for trying Off Script on the laptop and for the browser tests. It serves the
// repository at /off-script/, the same path as GitHub Pages. Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] || 4173);
const BASE = '/off-script/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const SERVED = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', 'src', 'vendor', 'icons'];

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) {
    res.writeHead(302, { Location: BASE });
    return res.end();
  }
  const rel = normalize(path.slice(BASE.length) || 'index.html');
  if (rel.startsWith('..') || !SERVED.some((s) => rel === s || rel.startsWith(s + sep))) {
    res.writeHead(404);
    return res.end('Not found');
  }
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, () => console.log(`Off Script on http://localhost:${port}${BASE}`));
