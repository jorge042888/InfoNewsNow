const test = require('node:test');
const assert = require('node:assert');

const { handleApi, handleReader, readerTarget, collectQueryParams, decodeBody, filterReadable } = require('../lib/handlers.js');
const topHeadlinesHandler = require('../api/v4/top-headlines.js');
const searchHandler = require('../api/v4/search.js');
const readerHandler = require('../api/reader.js');

function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    headersSent: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(payload) {
      this.body = payload ? payload.toString() : '';
    },
  };
}

test('las funciones de Vercel exportan handlers', () => {
  assert.strictEqual(typeof readerHandler, 'function');
  assert.strictEqual(typeof topHeadlinesHandler, 'function');
  assert.strictEqual(typeof searchHandler, 'function');
});

test('handleApi rechaza metodos que no sean GET', () => {
  const res = mockRes();
  handleApi({ method: 'POST', url: '/api/v4/top-headlines' }, res, 'top-headlines');
  assert.strictEqual(res.statusCode, 405);
  assert.strictEqual(JSON.parse(res.body).errors[0].message, 'Method not allowed');
});

test('handleApi rechaza endpoints fuera de la lista permitida', () => {
  const res = mockRes();
  handleApi({ method: 'GET', url: '/api/v4/otro' }, res, 'otro');
  assert.strictEqual(res.statusCode, 404);
});

test('collectQueryParams fusiona query de req.url y req.query (Vercel)', () => {
  const req = { url: '/api/v4/search?q=ia&lang=es', query: { q: 'override', country: 'mx' } };
  const params = collectQueryParams(req);
  assert.strictEqual(params.get('q'), 'override');
  assert.strictEqual(params.get('lang'), 'es');
  assert.strictEqual(params.get('country'), 'mx');
});

test('readerTarget usa req.query.url en Vercel o la query de req.url en local', () => {
  assert.strictEqual(
    readerTarget({ query: { url: 'https://a.com/x' }, url: '/api/reader?utm=1' }),
    'https://a.com/x'
  );
  assert.strictEqual(readerTarget({ url: '/api/reader?url=https%3A%2F%2Fb.com%2Fy' }), 'https://b.com/y');
  assert.strictEqual(readerTarget({ url: '/api/reader' }), '');
  assert.strictEqual(readerTarget({ query: { url: ['https://c.com/z'] }, url: '/api/reader' }), '');
});

test('handleReader responde 400 para URLs inseguras', async () => {
  const res = mockRes();
  await handleReader({ method: 'GET', url: '/api/reader?url=javascript:alert(1)', query: {} }, res);
  assert.strictEqual(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.reason, 'URL no válida');
});

test('handleReader responde 400 para protocolos no http(s)', async () => {
  const res = mockRes();
  await handleReader({ method: 'GET', url: '/api/reader', query: { url: 'ftp://ejemplo.com/a' } }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('handleReader responde 405 para metodos que no sean GET', async () => {
  const res = mockRes();
  await handleReader({ method: 'POST', url: '/api/reader', query: {} }, res);
  assert.strictEqual(res.statusCode, 405);
});

test('decodeBody respeta charset del header, del meta y cae a utf-8', () => {
  const latin = Buffer.from('<p>Información útil</p>', 'latin1');
  assert.match(decodeBody(latin, 'text/html; charset=ISO-8859-1'), /Información útil/);
  const withMeta = Buffer.from('<head><meta charset="windows-1252"></head><p>años</p>', 'latin1');
  assert.match(decodeBody(withMeta, 'text/html'), /años/);
  const utf = Buffer.from('<p>Información</p>', 'utf8');
  assert.match(decodeBody(utf, 'text/html'), /Información/);
  assert.match(decodeBody(utf, 'text/html; charset=charset-inexistente'), /Información/);
});

test('filterReadable descarta ok:false, rechazos y timeouts conservando el orden', async () => {
  const articles = [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }, { url: 'e' }];
  const readFn = (url) => {
    if (url === 'a') return Promise.resolve({ ok: true });
    if (url === 'b') return Promise.resolve({ ok: false });
    if (url === 'c') return Promise.reject(new Error('boom'));
    if (url === 'd') return new Promise(() => {});
    return Promise.resolve({ ok: true });
  };
  const out = await filterReadable(articles, readFn, 50);
  assert.deepStrictEqual(out.map(a => a.url), ['a', 'e']);
});
