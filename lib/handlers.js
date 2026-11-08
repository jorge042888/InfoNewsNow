/**
 * lib/handlers.js — Lógica de API compartida por server.js (local) y api/ (Vercel).
 *
 *  - handleApi:    proxy de GNews (top-headlines / search). Inyecta GNEWS_API_KEY
 *                  y devuelve solo las notas que merecen la pena (lib/quality.js)
 *                  y que el lector puede mostrar.
 *  - handleReader: GET /api/reader?url= → contenido extraído de la página fuente.
 *  - readArticle:  descarga + extracción con caché en memoria (usada por ambos).
 *  - decodeBody:   decodifica el HTML con su charset real.
 */
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { isSafeUrl, extractContent } = require('../reader.js');
const { filterQuality } = require('./quality.js');

const GNEWS_BASE = 'https://gnews.io/api/v4';
const ALLOWED_ENDPOINTS = new Set(['top-headlines', 'search']);
// Timeout de cada request saliente (GNews y páginas fuente).
const REQUEST_TIMEOUT_MS = 10000;
const READER_MAX_BYTES = 2 * 1024 * 1024;
const READER_CACHE_TTL_MS = 15 * 60 * 1000;
// Entradas máximas de la caché del lector (~10 notas × varias categorías/búsquedas).
const READER_CACHE_MAX = 100;
// Tiempo máximo para verificar las notas de una respuesta; las que no terminan se descartan.
const FILTER_DEADLINE_MS = 8000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Decodifica el cuerpo de una página con su charset real. Orden:
 *   1. charset del header Content-Type
 *   2. <meta charset> / <meta http-equiv="Content-Type" ...charset=> en los primeros 2 KB
 *   3. utf-8
 * Un label desconocido para TextDecoder cae a utf-8 (nunca lanza).
 */
function decodeBody(buffer, contentType = '') {
  let label = (/charset\s*=\s*["']?([\w.:-]+)/i.exec(String(contentType)) || [])[1];
  if (!label) {
    const head = buffer.subarray(0, 2048).toString('latin1');
    label = (/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head) || [])[1];
  }
  try {
    return new TextDecoder(label || 'utf-8').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/** GET a GNews. Resuelve { status, contentType, body } sin interpretar el cuerpo. */
function fetchGnews(targetUrl) {
  return new Promise((resolve, reject) => {
    const upstream = https.request(targetUrl, { method: 'GET', timeout: REQUEST_TIMEOUT_MS }, (upRes) => {
      const chunks = [];
      upRes.on('data', (chunk) => chunks.push(chunk));
      upRes.on('end', () =>
        resolve({
          status: upRes.statusCode || 502,
          contentType: upRes.headers['content-type'] || 'application/json; charset=utf-8',
          body: Buffer.concat(chunks),
        })
      );
      upRes.on('error', reject);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Timeout')));
    upstream.on('error', reject);
    upstream.end();
  });
}

function collectQueryParams(req) {
  const params = new URLSearchParams();
  const fromUrl = new URL(req.url || '/', 'http://localhost');
  for (const [key, value] of fromUrl.searchParams) params.set(key, value);
  if (req.query && typeof req.query === 'object') {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') params.set(key, value);
    }
  }
  return params;
}

/**
 * Deja solo las notas que el lector interno puede mostrar. Verifica todas
 * en paralelo con readFn(url) (resultado `{ ok }`); fallos, rechazos y
 * timeouts se descartan. Conserva el orden original.
 */
async function filterReadable(articles, readFn, deadlineMs = FILTER_DEADLINE_MS) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), deadlineMs);
  });
  try {
    const checks = articles.map((article) =>
      Promise.race([
        Promise.resolve()
          .then(() => readFn(article && article.url))
          .catch(() => ({ ok: false })),
        deadline,
      ])
    );
    const results = await Promise.all(checks);
    return articles.filter((_, i) => results[i] && results[i].ok);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Proxy de GNews. Valida método/endpoint, exige GNEWS_API_KEY y, si GNews
 * responde 200 con artículos, descarta las superfluas (filterQuality), verifica
 * que el resto sea legible con filterReadable(readArticle) y
 * añade totalArticles (nº tras filtrar). Errores de GNews (403 cuota,
 * 429 rate limit…) se reenvían sin tocar. Un fallo de red devuelve 502.
 */
async function handleApi(req, res, endpoint) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { errors: [{ message: 'Method not allowed' }] });
  }
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return sendJson(res, 404, { errors: [{ message: 'Endpoint no permitido' }] });
  }

  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, { errors: [{ message: 'GNEWS_API_KEY no configurada en el servidor' }] });
  }

  const target = new URL(`${GNEWS_BASE}/${endpoint}`);
  for (const [key, value] of collectQueryParams(req)) {
    if (key !== 'apikey') target.searchParams.set(key, value);
  }
  target.searchParams.set('apikey', apiKey);

  let upstream;
  try {
    upstream = await fetchGnews(target);
  } catch (err) {
    console.error('[proxy]', err.message);
    return sendJson(res, 502, { errors: [{ message: 'Error al contactar GNews' }] });
  }

  // Errores de GNews (cuota 403, rate limit 429...) se reenvían tal cual.
  let data = null;
  if (upstream.status === 200) {
    try {
      data = JSON.parse(upstream.body.toString('utf8'));
    } catch {
      data = null;
    }
  }
  if (!data || !Array.isArray(data.articles)) {
    res.writeHead(upstream.status, {
      'Content-Type': upstream.contentType,
      'Content-Length': upstream.body.length,
    });
    return res.end(upstream.body);
  }

  const worthwhile = filterQuality(data.articles);
  const readable = await filterReadable(worthwhile, readArticle);
  return sendJson(res, 200, { ...data, totalArticles: readable.length, articles: readable });
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

/**
 * Descarga una página fuente: UA de navegador, gzip/deflate/br, redirects
 * revalidados con isSafeUrl, solo text/html, tope de READER_MAX_BYTES y
 * decodificación con el charset real (decodeBody).
 */
function fetchHtml(targetUrl) {
  return new Promise((resolve, reject) => {
    const lib = targetUrl.protocol === 'http:' ? http : https;
    const req = lib.get(
      targetUrl,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
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
          resolve(decodeBody(Buffer.concat(chunks), ctype));
        });
        stream.on('error', fail);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

function readerTarget(req) {
  const fromQuery = req.query && req.query.url;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  return new URL(req.url || '/', 'http://localhost').searchParams.get('url') || '';
}

/**
 * Descarga y extrae una nota (con caché en memoria). Devuelve siempre el
 * payload del lector: `{ ok: true, content, ... }` o `{ ok: false, reason }`.
 */
async function readArticle(target) {
  if (!isSafeUrl(target)) return { ok: false, reason: 'URL no válida', source: target };

  const cached = readerCacheGet(target);
  if (cached) return cached;

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
    return payload;
  } catch (err) {
    console.error('[reader]', err.message);
    return { ok: false, reason: 'No se pudo cargar la página fuente', source: target };
  }
}

/** GET /api/reader?url= — 400 si la URL no es segura, 200 con el payload de readArticle. */
async function handleReader(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { errors: [{ message: 'Method not allowed' }] });
  }
  const target = readerTarget(req);
  if (!isSafeUrl(target)) {
    return sendJson(res, 400, { ok: false, reason: 'URL no válida' });
  }
  return sendJson(res, 200, await readArticle(target));
}

module.exports = {
  sendJson,
  handleApi,
  handleReader,
  readerTarget,
  collectQueryParams,
  decodeBody,
  filterReadable,
  readArticle,
};
