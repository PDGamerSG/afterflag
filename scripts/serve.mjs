import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.env.AFTERFLAG_SITE ?? 'site');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/report.json', ['report.json', 'application/json; charset=utf-8']],
  ['/blocked/', ['blocked/index.html', 'text/html; charset=utf-8']],
  ['/blocked/report.json', ['blocked/report.json', 'application/json; charset=utf-8']],
  ['/webhook/', ['webhook/index.html', 'text/html; charset=utf-8']],
  ['/webhook/report.json', ['webhook/report.json', 'application/json; charset=utf-8']]
]);
const server = createServer(async (request, response) => {
  const resource = files.get(request.url.split('?')[0]);
  if (!resource || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const [file, type] = resource;
    const body = await readFile(resolve(root, file));
    response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end('Run npm run site to generate this report.');
  }
});
const port = Number(process.env.PORT ?? 4173);
server.listen(port, '127.0.0.1', () => console.log('Afterflag evidence http://127.0.0.1:' + port));
