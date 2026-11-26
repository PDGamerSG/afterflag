import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve(process.env.AFTERFLAG_SITE ?? 'site');
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = createServer(async (request, response) => {
  const relative = request.url === '/' ? 'index.html' : request.url.slice(1);
  const file = resolve(root, relative);
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end('not found');
  }
});
const port = Number(process.env.PORT ?? 4173);
server.listen(port, '127.0.0.1', () => console.log('Afterflag viewer http://127.0.0.1:' + port));
