// Serves the script-tag fixture page, as any static host would, from an
// origin other than the sink's: a cross-origin script tag and note.
// `/?sink=<port>` points the page at a sink on another port, for a test
// that runs its own.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { PORTS } from './helpers.ts';

const template = readFileSync(join(import.meta.dirname, 'fixtures/script-tag/index.html'), 'utf8');

/** The sink's port from `?sink=`, or the shared one; null if it isn't a port. */
function sinkPort(query: URLSearchParams): number | null {
  const given = query.get('sink');
  if (given === null) return PORTS.scriptTagSink;
  const port = /^\d{1,5}$/.test(given) ? Number(given) : 0;
  return port > 0 && port < 65_536 ? port : null;
}

createServer((req, res) => {
  const url = URL.parse(req.url ?? '', 'http://localhost');
  const port = url?.pathname === '/' ? sinkPort(url.searchParams) : null;
  if (port === null) {
    res.writeHead(404).end();
    return;
  }
  const page = template.replace('{{sink}}', `http://127.0.0.1:${String(port)}`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
}).listen(PORTS.scriptTagPage, 'localhost');
