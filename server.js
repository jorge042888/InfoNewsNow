const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GNEWS_API_KEY || '4db32ab0a906a065b648342044542ee5';
const GNEWS_BASE = 'https://gnews.io/api/v4';
const ALLOWED_ENDPOINTS = new Set(['top-headlines', 'search']);
const REQUEST_TIMEOUT_MS = 10000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function proxyApi(req, res, targetUrl) {
  const upstream = https.request(targetUrl, { method: 'GET', timeout: REQUEST_TIMEOUT_MS }, (upRes) => {
    const chunks = [];
    upRes.on('data', (chunk) => chunks.push(chunk));
    upRes.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(upRes.statusCode || 502, {
        'Content-Type': upRes.headers['content-type'] || 'application/json; charset=utf-8',
        'Content-Length': body.length,
      });
      res.end(body);
    });
  });

  upstream.on('timeout', () => upstream.destroy(new Error('Timeout')));
  upstream.on('error', (err) => {
    console.error('[proxy]', err.message);
    if (!res.headersSent) sendJson(res, 502, { errors: [{ message: 'Error al contactar GNews' }] });
  });

  upstream.end();
}

function handleApi(req, res, pathname) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { errors: [{ message: 'Method not allowed' }] });
  }

  const endpoint = pathname.replace(/^\/api\/v4\//, '');
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return sendJson(res, 404, { errors: [{ message: 'Endpoint no permitido' }] });
  }

  const target = new URL(`${GNEWS_BASE}/${endpoint}`);
  for (const [key, value] of new URL(req.url, 'http://localhost').searchParams) {
    if (key !== 'apikey') target.searchParams.set(key, value);
  }
  target.searchParams.set('apikey', API_KEY);

  proxyApi(req, res, target);
}

const STATIC_FILES = new Set(['index.html', 'styles.css', 'app.js', 'utils.js']);

function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  if (!STATIC_FILES.has(relative)) {
    return sendJson(res, 404, { errors: [{ message: 'Not found' }] });
  }

  const filePath = path.resolve(__dirname, relative);
  if (!filePath.startsWith(__dirname + path.sep)) {
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

  if (pathname.startsWith('/api/v4/')) return handleApi(req, res, pathname);
  if (req.method !== 'GET') return sendJson(res, 405, { errors: [{ message: 'Method not allowed' }] });

  serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log(`TechNews Hub → http://localhost:${PORT}`);
});
