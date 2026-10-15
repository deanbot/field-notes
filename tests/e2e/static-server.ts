// Serves the script-tag fixture page, as any static host would, from an
// origin other than the sink's: a cross-origin script tag and note.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { PORTS } from './helpers.ts';

const page = readFileSync(
  join(import.meta.dirname, 'fixtures/script-tag/index.html'),
  'utf8',
).replace('{{sink}}', `http://127.0.0.1:${String(PORTS.scriptTagSink)}`);

createServer((req, res) => {
  if (req.url !== '/') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
}).listen(PORTS.scriptTagPage, 'localhost');
