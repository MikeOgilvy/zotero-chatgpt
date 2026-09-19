// A local, loopback-only server for the surface capability probe. It exists so a page hosted in the
// Zotero sidebar surface can be asked three questions that no remote site can answer truthfully:
// did a POST round-trip complete, did a slow subresource arrive, and what did the page's own document
// visibility look like. It serves the fixture directory and never leaves 127.0.0.1.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

/** @param {{ root: string, port?: number, slowMs?: number }} options */
export function startFixtureServer({ root, port = 0, slowMs = 3000 }) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    // A POST that answers immediately: the question is whether it completes at all in this surface,
    // not what it carries.
    if (url.pathname === '/echo') {
      let body = '';
      for await (const chunk of request) body += chunk;
      response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      response.end(JSON.stringify({ ok: true, method: request.method, bytes: body.length }));
      return;
    }
    // A one-pixel PNG delivered after a delay: a subresource that must survive whatever the surface
    // does while it is in flight.
    if (url.pathname === '/slow.png') {
      await new Promise(resolve => setTimeout(resolve, slowMs));
      const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(pixel.length) });
      response.end(pixel);
      return;
    }
    const relative = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    try {
      const contents = await readFile(join(root, relative));
      response.writeHead(200, { 'content-type': TYPES[extname(relative)] || 'application/octet-stream' });
      response.end(contents);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`,
        close: () => new Promise(done => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('fixture-server.mjs')) {
  const root = process.argv[2];
  const started = await startFixtureServer({ root });
  console.log(started.origin);
}
