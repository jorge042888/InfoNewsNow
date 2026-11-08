/**
 * lib/quality.js — Filtro editorial: descarta notas superfluas (farándula,
 * chismes, loterías, horóscopos, publicidad de autos…) para que el portal
 * muestre solo noticias que merecen la pena.
 *
 * Se aplica en el servidor sobre las respuestas de GNews, antes de verificar
 * que la nota sea legible (lib/handlers.js → handleApi).
 *
 * Las listas son fáciles de ajustar: BLOCKED_SOURCES (dominios) y
 * BLOCKED_TOPICS (patrones sobre título + descripción, ya sin tildes).
 */

// Fuentes tabloides o comerciales (se compara con el hostname sin "www.").
const BLOCKED_SOURCES = new Set([
  'pulzo.com',
  'shock.co',
  'publimetro.co',
  'kienyke.com',
  'autotest.com.ar',
  'lamoto.com.ar',
]);

// Temas superfluos. Se evalúan sobre texto en minúsculas y sin tildes.
const BLOCKED_TOPICS = [
  /\bloteri/,                                 // resultados de loterías
  /\bsorteo\b|\bbaloto\b|\bnumeros ganadores\b|\bsuper astro\b/,
  /\bhoroscopo\b|\bzodiaco\b|\bsignos? del\b/,
  /\bfarandula\b|\bchisme/,
  /\bfamos[oa]s?\b|\bcelebridad/,
  /\binfluencers?\b|\btiktokers?\b|\byoutubers?\b/,
  /\breality\b|\btelenovela\b|\bmiss universo\b|\breina de (la )?belleza\b/,
  /\bno vas a creer\b|\bno creeras\b|\bte vas a sorprender\b|\blo que nadie\b/,
  /\bviral\b|\bse hizo viral\b/,
  /\bactriz\b|\bpresentadora\b|\bcantante\b|\bmujeres a la plancha\b/, // farándula de TV y música
  /\bautofest\b|\bpatrocinad|\bpublirreportaje\b|\bcontenido comercial\b/, // contenido patrocinado
  /\bcuanto cuesta pintar\b|\bmejores ofertas\b|\bdescuentos? de\b/,
];

/** Minúsculas y sin tildes/diéresis para comparar patrones. */
function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function hostOf(article) {
  const raw = (article && article.source && article.source.url) || (article && article.url) || '';
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** true si la nota pasa el filtro editorial. */
function isWorthwhile(article) {
  if (!article) return false;
  const host = hostOf(article);
  if (host && [...BLOCKED_SOURCES].some((d) => host === d || host.endsWith(`.${d}`))) return false;
  const text = normalize(`${article.title || ''} ${article.description || ''}`);
  return !BLOCKED_TOPICS.some((re) => re.test(text));
}

/** Devuelve solo las notas que merecen la pena, conservando el orden. */
function filterQuality(articles) {
  return (articles || []).filter(isWorthwhile);
}

module.exports = { isWorthwhile, filterQuality, BLOCKED_SOURCES, BLOCKED_TOPICS };
