// A custom Next.js server, so the field-notes middleware can sit in front of
// Next's own handler. Next's `proxy.ts` runs where it can't write files, and
// App Router doesn't route folders starting with `_`, such as `__field-notes`.
import { createServer } from 'node:http';
import { fieldNotesMiddleware } from 'field-notes/middleware';
import next from 'next';

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== 'production';

const httpServer = createServer();
// Given the server, Next handles its dev websocket (HMR) on it too.
const app = next({ dev, hostname: 'localhost', port, httpServer });
const handle = app.getRequestHandler();
// Off when NODE_ENV is production: `next start` has no sink.
const notes = fieldNotesMiddleware();

await app.prepare();
httpServer.on('request', (req, res) => {
  notes(req, res, () => {
    void handle(req, res);
  });
});
httpServer.listen(port, 'localhost', () => {
  console.log(`> Ready on http://localhost:${String(port)}`);
});
