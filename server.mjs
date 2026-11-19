import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, normalize } from 'node:path';

// SERVE_DIR lets the same server host the built preview (dist/) so the mobile
// suite can be run against exactly the bytes that get deployed, not just the repo.
const root = process.env.SERVE_DIR
  ? resolve(import.meta.dirname, process.env.SERVE_DIR)
  : resolve(import.meta.dirname);
const port = Number(process.env.PORT || 8000);
// Bind loopback by default; this is a local game server, never a public one.
const host = process.env.HOST || '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = resolve(root, '.' + normalize(pathname));
    if (file !== root && !file.startsWith(root + '/') && !file.startsWith(root + '\\')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, host, () => {
  console.log(`Amazing Adventure is running at http://${host}:${port}`);
});
