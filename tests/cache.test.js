const test = require('node:test');
const assert = require('node:assert');

const { makeTtlCache } = require('../lib/cache.js');
const { apiCacheKey } = require('../lib/handlers.js');

test('makeTtlCache devuelve el valor hasta que vence el TTL', () => {
  let t = 1000;
  const cache = makeTtlCache(100, 10, () => t);
  cache.set('a', { x: 1 });
  assert.deepStrictEqual(cache.get('a'), { x: 1 });
  t += 100;
  assert.deepStrictEqual(cache.get('a'), { x: 1 });
  t += 1;
  assert.strictEqual(cache.get('a'), null);
  assert.strictEqual(cache.size, 0);
});

test('makeTtlCache respeta el tope de entradas descartando la mas antigua', () => {
  const cache = makeTtlCache(1000, 2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.strictEqual(cache.get('a'), null);
  assert.strictEqual(cache.get('b'), 2);
  assert.strictEqual(cache.get('c'), 3);
  cache.set('b', 22); // reescribir una clave existente no expulsa a nadie
  assert.strictEqual(cache.get('c'), 3);
  assert.strictEqual(cache.get('b'), 22);
});

test('apiCacheKey ignora el orden de parametros y la apikey', () => {
  const a = apiCacheKey('top-headlines', new URLSearchParams('category=general&lang=es&apikey=SECRETA&max=10'));
  const b = apiCacheKey('top-headlines', new URLSearchParams('max=10&apikey=OTRA&lang=es&category=general'));
  assert.strictEqual(a, b);
  assert.ok(!a.includes('SECRETA'));
  assert.notStrictEqual(a, apiCacheKey('search', new URLSearchParams('category=general&lang=es&max=10')));
  assert.notStrictEqual(a, apiCacheKey('top-headlines', new URLSearchParams('category=general&lang=es&max=10&country=co')));
});
