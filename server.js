import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleApi } from './lib/api.js';
const port = Number(process.env.PORT || 4317);
const files = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js', '/config.js': 'config.js', '/favicon.svg': 'favicon.svg', '/llms.txt': 'llms.txt' };
const mime = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', txt: 'text/plain' };
const server = http.createServer(async (req, res) => {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) { res.writeHead(403); res.end(); return; }
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (!files[path]) { res.writeHead(404); res.end('No encontrado'); return; }
  try { const file = files[path]; res.writeHead(200, { 'Content-Type': `${mime[file.split('.').pop()]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(await readFile(new URL(`./docs/${file}`, import.meta.url))); }
  catch { res.writeHead(500); res.end('No se pudo abrir la interfaz.'); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Puerto ${port} ocupado. Usa PORT=4318 npm start.` : error.message); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(`Adversarial Acceleration → http://127.0.0.1:${port}`));
process.on('SIGTERM', () => server.close());
