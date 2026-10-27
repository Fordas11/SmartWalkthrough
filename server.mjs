// Zero-dependency static file server for the prototype.
// Usage: node server.mjs [port]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8000);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

http
  .createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = join(root, normalize(path));
      if (!file.startsWith(root)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
      if (!(await stat(file)).isFile()) throw Object.assign(new Error('nf'), { code: 'ENOENT' });
      res.writeHead(200, {
        'Content-Type': types[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(e.code === 'EACCES' ? 403 : 404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  })
  .listen(port, () => console.log(`Smart Walkthrough → http://localhost:${port}`));
