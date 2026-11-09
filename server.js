const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { sendJson, handleApi, handleReader } = require('./lib/handlers.js');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

// Frontend estático en public/ (igual que en Vercel); solo se sirven los archivos listados.
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_FILES = new Set(['index.html', 'styles.css', 'app.js', 'utils.js']);
// Logos de medios: public/img/fuentes/<nombre>.(svg|png|webp|jpg)
const LOGO_RE = /^img\/fuentes\/[a-z0-9-]+\.(svg|png|webp|jpg)$/;

function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  if (!STATIC_FILES.has(relative) && !LOGO_RE.test(relative)) {
    return sendJson(res, 404, { errors: [{ message: 'Not found' }] });
  }

  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { errors: [{ message: 'Forbidden' }] });
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return sendJson(res, 404, { errors: [{ message: 'Not found' }] });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (pathname.startsWith('/api/v4/')) return handleApi(req, res, pathname.replace(/^\/api\/v4\//, ''));
  if (pathname === '/api/reader') return handleReader(req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { errors: [{ message: 'Method not allowed' }] });

  serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log(`InfoNewsNow → http://localhost:${PORT}`);
});
