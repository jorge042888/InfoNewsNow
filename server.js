const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const { isSafeUrl, extractContent } = require('./reader.js');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GNEWS_API_KEY || '4db32ab0a906a065b648342044542ee5';
const GNEWS_BASE = 'https://gnews.io/api/v4';
const ALLOWED_ENDPOINTS = new Set(['top-headlines', 'search']);
const REQUEST_TIMEOUT_MS = 10000;
const READER_MAX_BYTES = 2 * 1024 * 1024;
const READER_CACHE_TTL_MS = 15 * 60 * 1000;
const READER_CACHE_MAX = 50;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

const readerCache = new Map();

function readerCacheGet(key) {
  const hit = readerCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > READER_CACHE_TTL_MS) {
    readerCache.delete(key);
    return null;
  }
  return hit.value;
}

function readerCacheSet(key, value) {
  if (readerCache.size >= READER_CACHE_MAX) {
    const oldest = readerCache.keys().next().value;
    readerCache.delete(oldest);
  }
  readerCache.set(key, { ts: Date.now(), value });
}

function fetchHtml(targetUrl) {
  return new Promise((resolve, reject) => {
    const lib = targetUrl.protocol === 'http:' ? http : https;
    const req = lib.get(
      targetUrl,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          try {
            const next = new URL(res.headers.location, targetUrl);
            if (!isSafeUrl(next.toString())) return reject(new Error('Redirect no permitida'));
            resolve(fetchHtml(next));
          } catch {
            reject(new Error('Redirect inválida'));
          }
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const ctype = String(res.headers['content-type'] || '');
        if (ctype && !/text\/html|application\/xhtml/i.test(ctype)) {
          res.resume();
          return reject(new Error('Respuesta no es HTML'));
        }

        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        let stream = res;
        if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());

        const chunks = [];
        let total = 0;
        let settled = false;
        const fail = (err) => {
          if (settled) return;
          settled = true;
          req.destroy();
          reject(err);
        };
        stream.on('data', (chunk) => {
          total += chunk.length;
          if (total > READER_MAX_BYTES) {
            fail(new Error('HTML demasiado grande'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
        stream.on('error', fail);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

async function handleReader(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { errors: [{ message: 'Method not allowed' }] });
  }
  const { searchParams } = new URL(req.url, 'http://localhost');
  const target = searchParams.get('url') || '';
  if (!isSafeUrl(target)) {
    return sendJson(res, 400, { ok: false, reason: 'URL no válida' });
  }

  const cached = readerCacheGet(target);
  if (cached) return sendJson(res, 200, cached);

  try {
    const html = await fetchHtml(new URL(target));
    const result = extractContent(html, target);
    const payload = result.ok
      ? {
          ok: true,
          content: result.content,
          title: result.meta.title,
          image: result.meta.image,
          date: result.meta.date,
          modified: result.meta.modified,
          author: result.meta.author,
          source: target,
        }
      : { ok: false, reason: result.reason || 'No se pudo extraer el contenido', source: target };
    readerCacheSet(target, payload);
    return sendJson(res, 200, payload);
  } catch (err) {
    console.error('[reader]', err.message);
    return sendJson(res, 200, { ok: false, reason: 'No se pudo cargar la página fuente', source: target });
  }
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
  if (pathname === '/api/reader') return handleReader(req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { errors: [{ message: 'Method not allowed' }] });

  serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log(`InfoNewsNow → http://localhost:${PORT}`);
});
