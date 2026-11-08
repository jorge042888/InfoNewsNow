const test = require('node:test');
const assert = require('node:assert');

const { isWorthwhile, filterQuality } = require('../lib/quality.js');

const art = (title, host = 'eltiempo.com', description = '') => ({
  title,
  description,
  url: `https://${host}/nota`,
  source: { url: `https://www.${host}` },
});

test('conserva noticias de interés público', () => {
  assert.ok(isWorthwhile(art('Escándalo en la Fiscalía: revelan presunta maniobra')));
  assert.ok(isWorthwhile(art('Dengue en el Atlántico: 3.285 casos y cinco muertes')));
  assert.ok(isWorthwhile(art('Nintendo Switch 2 podría agravar uno de sus problemas')));
});

test('descarta loterías, horóscopos y farándula (con o sin tildes)', () => {
  assert.ok(!isWorthwhile(art('Lotería de Boyacá: resultado del último sorteo')));
  assert.ok(!isWorthwhile(art('Horóscopo de hoy: qué dicen los astros')));
  assert.ok(!isWorthwhile(art('La farándula se conmociona por el divorcio')));
  assert.ok(!isWorthwhile(art('Nota cualquiera', 'eltiempo.com', 'El chisme del momento entre famosos')));
  assert.ok(!isWorthwhile(art('Influencer arma polémica en redes')));
  assert.ok(!isWorthwhile(art('Verónica Orozco no pudo presentarse en Mujeres a la Plancha')));
  assert.ok(!isWorthwhile(art('Suzuki, acabados premium en el Autofest 2026')));
});

test('descarta fuentes tabloides o comerciales, incluidos subdominios', () => {
  assert.ok(!isWorthwhile(art('Noticia seria', 'pulzo.com')));
  assert.ok(!isWorthwhile(art('Noticia seria', 'autotest.com.ar')));
  assert.ok(!isWorthwhile(art('Noticia seria', 'm.pulzo.com')));
  assert.ok(isWorthwhile(art('Noticia seria', 'notpulzo.com')));
});

test('filterQuality conserva el orden y tolera entradas vacías', () => {
  const list = [art('A seria'), art('Lotería del Cauca'), art('B seria')];
  assert.deepStrictEqual(filterQuality(list).map((a) => a.title), ['A seria', 'B seria']);
  assert.deepStrictEqual(filterQuality(null), []);
  assert.strictEqual(isWorthwhile(null), false);
});
