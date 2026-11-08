/**
 * reader.js — Extractor de artículos (server-side).
 *
 * Toma el HTML crudo de una fuente noticiosa y produce el cuerpo del
 * artículo en HTML "limpio" y seguro para inyectar en el modal lector.
 *
 * Flujo general (ver extractContent al final del archivo):
 *   1. extractMetadata → título, imagen, fecha, autor (JSON-LD → OG → <title>)
 *   2. findContentRoot  → localiza el bloque <article>/<main>/div con más texto
 *   3. stripNoise       → elimina scripts, estilos, nav, footer, forms...
 *   4. stripJunkNodes   → elimina nodos con id/class de publicidad/redes
 *   5. sanitizeFragment → whitelist de tags y attrs (anti-XSS), resuelve URLs
 *   6. drop… / cut…     → poda de títulos repetidos, ads, secciones de cierre
 *
 * Seguridad: isSafeUrl aplica protección anti-SSRF (bloquea IPs privadas,
 * loopback y hosts internos) antes de hacer cualquier fetch.
 */
const { URL } = require('node:url');

// ── Regímenes de limpieza (regex) ──────────────────────────────────────
// Detecta atributos id/class de bloques basura: anuncios, widgets de
// recirculación (Taboola/OutBrain), menús, footers, bylines, etc.
const JUNK_ID_CLASS_RE = /(^|[\s"'-])((ad|ads|advert|banner|billboard|promo|taboola|outbrain|related|relacionad|share|social|comment|disqus|newsletter|subscribe|suscri|cookie|consent|gdpr|popup|modal|overlay|sidebar|widget|breadcrumb|pagination|menu|nav|footer|header|toolbar|skip|etiqueta|tags|topic|temas|carousel|slider|embed|video|galeria|gallery|liveblog|[\w-]*author[\w-]*|byline|app[-_]?promo|weather|trending|popular|mas[-_]noticias?|mas[-_]historias?|mas[-_]notas?|more[-_]?(?:stories|news|posts|info)|reading|sigue|tambien|recirc|cross|paywall|cta|download|market|stock|redes[-_]?sociales|gps[-_]?pill|desvio|pivot|card|publicidad)[\w-]*)/i;

// Frases típicas de cierre de artículo: "más noticias", "suscríbete",
// "compartir en", etiquetas, avisos de publicidad. Se usa para podar
// párrafos y encabezados finales que no son contenido real.
const TRAILING_JUNK_RE = /(otros temas|otras noticias|m[áa]s noticias|m[áa]s en |tambi[ée]n en |tambi[ée]n te puede|te puede interesar|puede interesarte|suscr[íi]bete|newsletter|s[íi]guenos|descarga (la )?app|m[áa]s historias|sigue leyendo|lea tambi[ée]n|notas relacionadas|nota relacionada|compartir en|etiquetas|a[ñn][áa]denos a tus fuentes|fuentes preferidas|s[íi]guenos en redes|no te pierdas ninguna|\[?publicidad\]?)/i;

// Textos propios de programas de afiliados / descargos de responsabilidad
// (ej. "enlaces de esta publicación", "sujetos a cambios sin previo aviso").
const AFFILIATE_RE = /(programa de afiliado|ninguno de los art[íi]culos mencionados|sujetos a cambios sin previo aviso|enlaces de esta publicaci[óo]n|publicamos ofertas y descuentos|decisi[óo]n [úu]nica del equipo de editores|\u00danete a nuestro canal|ya est[áa] en whatsapp|desde tu dispositivo m[óo]vil)/i;

// Texto que es únicamente una fecha ISO (se elimina del cuerpo visible).
const ISO_TEXT_RE = /^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\s*$/;

// Imágenes a descartar: tracking pixels, placeholders, avatares 1x1...
const IMG_SKIP_RE = /^(data:|\/\/)|spacer|blank\.gif|placeholder|pixel|1x1|gravatar.*[?&]s=1/i;
// Avatares/íconos/logos identificados por class (no son fotos del artículo).
const IMG_CLASS_SKIP_RE = /avatar|profile|author[-_]?photo|byline[-_]?photo|icon|emoji|logo/i;

// Mínimo de caracteres visibles para considerar que hay artículo real.
const MIN_CONTENT_CHARS = 400;

// Categorías de tags usadas por los pasos de limpieza (referencias).
const INLINE_TAGS = new Set(['strong', 'em', 'b', 'i', 'a', 'br', 'span', 'u', 's', 'small', 'sup', 'sub', 'time', 'code', 'cite', 'abbr']);
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'figure', 'figcaption', 'div', 'section', 'article', 'table', 'tr', 'td', 'th', 'hr', 'pre']);
// Tags sin cierre (void): no se apilan en el stack de anidamiento.
const VOID_TAGS = new Set(['br', 'hr', 'img']);

/**
 * Protección anti-SSRF: valida que una URL sea pública y segura antes
 * de hacer fetch desde el servidor. Rechaza:
 *  - protocolos distintos de http:/https:
 *  - credenciales embebidas (user:pass@)
 *  - hosts locales (localhost, *.local, ::1)
 *  - rangos de IP privados/reservados IPv4:
 *      0.0.0.0/8, 10/8, 127/8, 172.16/12, 192.168/16,
 *      169.254/16 (link-local), 100.64/10 (CGNAT), >=224 (multicast/reservado)
 * Sin esto, un atacante podría apuntar /api/reader a servicios internos
 * (169.254.169.254 metadata de cloud, etc.) y exponerlos.
 */
function isSafeUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false; // URL malformada
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === '[::1]') return false;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

/**
 * Resuelve un href relativo contra una URL base y normaliza el resultado.
 * Devuelve '' si es inválido o si el protocolo no es http(s).
 * Se elimina el fragmento (#...) para que las URLs sean canónicas.
 */
function resolveUrl(href, baseUrl) {
  if (!href) return '';
  try {
    const u = new URL(href.trim(), baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

/**
 * Lee una etiqueta <meta> por sus atribitos property/name y content.
 * Prueba las dos formas de orden de atributos (property antes/después
 * de content). `keys` se prueba en orden de prioridad (og:title, etc.).
 */
function getMeta(html, ...keys) {
  for (const key of keys) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) return decodeEntities(m[1]).trim();
    }
  }
  return '';
}

// Entidades nombradas frecuentes en textos en español.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Uuml: 'Ü',
  ntilde: 'ñ', Ntilde: 'Ñ', iquest: '¿', iexcl: '¡', laquo: '«', raquo: '»',
  hellip: '…', ndash: '–', mdash: '—', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  ordm: 'º', ordf: 'ª', euro: '€', copy: '©', reg: '®',
};

/**
 * Decodifica entidades HTML (nombradas comunes y numéricas) para
 * obtener el texto real en metadatos. Una sola pasada: evita decodificar
 * dos veces (&amp;lt; debe quedar como "&lt;").
 */
function decodeEntities(str) {
  return String(str).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/gi, (full, dec, hex, name) => {
    if (name) return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : full;
    const code = dec != null ? Number(dec) : parseInt(hex, 16);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return full;
    return String.fromCodePoint(code);
  });
}

/**
 * Convierte cualquier formato de fecha soportado por Date a ISO 8601.
 * Devuelve '' si el valor no es parseable (para que el llamador pueda
 * probar la siguiente fuente de metadatos en cascada).
 */
function normalizeDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Extrae el primer nodo de tipo artículo del JSON-LD embebido en la página.
 * Soporta: objeto simple, array, o @graph (formato schema.org).
 * Devuelve null si no hay JSON-LD válido con un tipo Article/NewsArticle.
 */
function extractJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = [];
      const push = (n) => { if (n && typeof n === 'object') nodes.push(n); };
      if (Array.isArray(data)) data.forEach(push);
      else {
        push(data);
        if (Array.isArray(data['@graph'])) data['@graph'].forEach(push);
      }
      for (const node of nodes) {
        const type = String(node['@type'] || '');
        if (/Article|NewsArticle|BlogPosting|ReportageNewsArticle|LiveBlogPosting/i.test(type)) return node;
      }
    } catch {
      /* JSON-LD inválido: ignorar */
    }
  }
  return null;
}

/**
 * Normaliza el campo author de JSON-LD: puede ser string, objeto {name}
 * o array de cualquiera de los dos. Devuelve el primer nombre encontrado.
 */
function ldAuthorName(author) {
  if (!author) return '';
  if (typeof author === 'string') return decodeEntities(author).trim();
  if (Array.isArray(author)) {
    for (const a of author) {
      const name = ldAuthorName(a);
      if (name) return name;
    }
    return '';
  }
  if (typeof author === 'object' && author.name) return decodeEntities(String(author.name)).trim();
  return '';
}

/**
 * Normaliza el campo image de JSON-LD: string, array, o objeto con
 * url/contentUrl/@id. Resuelve la URL relativa contra la base.
 */
function ldImage(image, baseUrl) {
  if (!image) return '';
  if (typeof image === 'string') return resolveUrl(image, baseUrl);
  if (Array.isArray(image)) {
    for (const img of image) {
      const url = ldImage(img, baseUrl);
      if (url) return url;
    }
    return '';
  }
  if (typeof image === 'object') {
    if (image.url) return resolveUrl(image.url, baseUrl);
    if (image.contentUrl) return resolveUrl(image.contentUrl, baseUrl);
    if (image["@id"]) return resolveUrl(image["@id"], baseUrl);
  }
  return '';
}

/**
 * Extrae metadatos del artículo con estrategia en cascada
 * (cada campo prueba las fuentes por orden de fiabilidad):
 *   título:      JSON-LD → og:title → <title>
 *   imagen:      JSON-LD → og:image → twitter:image
 *   descripción: JSON-LD → og:description → meta description
 *   fecha:       JSON-LD datePublished → meta article:published_time → <time datetime>
 *   autor:       JSON-LD author → meta author
 */
function extractMetadata(html, baseUrl) {
  const ld = extractJsonLd(html);
  const title =
    (ld && ld.headline && decodeEntities(String(ld.headline)).trim()) ||
    getMeta(html, 'og:title', 'twitter:title') ||
    decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const image =
    ldImage(ld && ld.image, baseUrl) ||
    resolveUrl(getMeta(html, 'og:image', 'twitter:image', 'twitter:image:src'), baseUrl);
  const description =
    (ld && ld.description && decodeEntities(String(ld.description)).trim()) ||
    getMeta(html, 'og:description', 'twitter:description', 'description');
  const date =
    normalizeDate((ld && ld.datePublished) || '') ||
    normalizeDate(getMeta(html, 'article:published_time', 'og:article:published_time', 'datePublished', 'date')) ||
    normalizeDate((html.match(/<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i) || [])[1]) ||
    normalizeDate((html.match(/<time[^>]+datetime=["']([^"']+)["']/i) || [])[1]);
  const modified =
    normalizeDate((ld && ld.dateModified) || '') ||
    normalizeDate(getMeta(html, 'article:modified_time', 'og:updated_time', 'dateModified', 'last-modified')) ||
    normalizeDate((html.match(/<meta[^>]+itemprop=["']dateModified["'][^>]+content=["']([^"']+)["']/i) || [])[1]);
  const author =
    ldAuthorName(ld && ld.author) ||
    getMeta(html, 'author', 'article:author', 'og:article:author');
  return {
    title: title || '',
    image,
    description: description || '',
    date: date || '',
    modified: modified || '',
    author: author || '',
  };
}

/** Elimina todos los matches de `re` del HTML (helper de limpieza). */
function removeByRegex(html, re) {
  return html.replace(re, '');
}

/**
 * Paso 1 del pipeline: elimina "ruido" estructural que nunca es
 * contenido del artículo — scripts, estilos, comentarios, nav/footer/
 * header/aside, formularios, iframes, SVG y elementos de formulario.
 * Esto reduce drásticamente el HTML antes de localizar el artículo.
 */
function stripNoise(html) {
  let out = html;
  out = removeByRegex(out, /<!--[\s\S]*?-->/g);
  out = removeByRegex(out, /<script\b[^>]*>[\s\S]*?<\/script>/gi);
  out = removeByRegex(out, /<style\b[^>]*>[\s\S]*?<\/style>/gi);
  out = removeByRegex(out, /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi);
  out = removeByRegex(out, /<template\b[^>]*>[\s\S]*?<\/template>/gi);
  out = removeByRegex(out, /<svg\b[^>]*>[\s\S]*?<\/svg>/gi);
  out = removeByRegex(out, /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi);
  out = removeByRegex(out, /<object\b[^>]*>[\s\S]*?<\/object>/gi);
  out = removeByRegex(out, /<embed\b[^>]*>/gi);
  out = removeByRegex(out, /<link\b[^>]*>/gi);
  out = removeByRegex(out, /<meta\b[^>]*>/gi);
  out = removeByRegex(out, /<input\b[^>]*>/gi);
  out = removeByRegex(out, /<select\b[^>]*>[\s\S]*?<\/select>/gi);
  out = removeByRegex(out, /<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi);
  out = removeByRegex(out, /<button\b[^>]*>[\s\S]*?<\/button>/gi);
  out = removeByRegex(out, /<nav\b[^>]*>[\s\S]*?<\/nav>/gi);
  out = removeByRegex(out, /<footer\b[^>]*>[\s\S]*?<\/footer>/gi);
  out = removeByRegex(out, /<header\b[^>]*>[\s\S]*?<\/header>/gi);
  out = removeByRegex(out, /<aside\b[^>]*>[\s\S]*?<\/aside>/gi);
  out = removeByRegex(out, /<form\b[^>]*>[\s\S]*?<\/form>/gi);
  return out;
}

/**
 * Paso 2: elimina nodos cuyo id/class coincida con JUNK_ID_CLASS_RE
 * (publicidad, widgets, menús...). Usa un parser de tags con stack
 * para respetar el anidamiento: al abrir un tag basura se marca como
 * "junk" y todo su contenido se descarta hasta encontrar su cierre.
 *
 * El primer tag visto (raíz, normalmente <html>/<body>) nunca se marca
 * como basura para no descartar la página entera por accidente.
 */
function stripJunkNodes(html) {
  const tagRe = /<(\/?)([a-z][\w-]*)((?:\s[^<>]*?)?)\/?>/gi;
  let out = '';
  const stack = [];
  let last = 0;
  let seenRoot = false;
  let m;
  tagRe.lastIndex = 0;
  while ((m = tagRe.exec(html)) !== null) {
    const text = html.slice(last, m.index);
    last = tagRe.lastIndex;
    const inJunk = stack.some(n => n.junk);
    if (!inJunk) out += text;

    const [full, slash, rawTag, rawAttrs] = m;
    const tag = rawTag.toLowerCase();
    if (slash) {
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { idx = i; break; }
      }
      if (idx === -1) continue;
      const closed = stack[idx];
      stack.length = idx;
      if (!inJunk && !closed.junk) out += full;
      continue;
    }
    const attrs = rawAttrs || '';
    const isRoot = !seenRoot;
    if (isRoot) seenRoot = true;
    if (inJunk || (!isRoot && JUNK_ID_CLASS_RE.test(attrs))) {
      if (!VOID_TAGS.has(tag) && tag !== 'img') stack.push({ tag, junk: true });
      continue;
    }
    out += full;
    if (!VOID_TAGS.has(tag) && tag !== 'img') stack.push({ tag, junk: false });
  }
  if (!stack.some(n => n.junk)) out += html.slice(last);
  return out;
}

/** Longitud del texto visible (sin tags HTML) — métrica de contenido. */
function textLength(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

/**
 * Proporción del texto que está dentro de enlaces (0 = sin links,
 * 1 = todo es links). Un valor alto indica listas de recirculación,
 * no prosa del artículo. Se usa para puntuar candidatos y podar bloques.
 */
function linkDensity(html) {
  const total = textLength(html);
  if (!total) return 0;
  const links = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [])
    .map(t => textLength(t))
    .reduce((a, b) => a + b, 0);
  return links / total;
}

/**
 * Localiza el bloque que contiene el cuerpo del artículo:
 *   1. <article> con ≥400 chars de texto (caso ideal)
 *   2. <main> como alternativa
 *   3. Fallback: puntuación de <div>/<section> cuyo class/id sugiera
 *      contenido ("article", "story", "content", "body"...) y tenga
 *      ≥2 párrafos. Se puntúa como: longitud × (1 − densidad de links),
 *      eligiendo el candidato con mayor score.
 * Devuelve '' si no se encuentra suficiente contenido.
 */
function findContentRoot(html) {
  const direct = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i);
  if (direct && textLength(direct[0]) >= MIN_CONTENT_CHARS) return direct[0];

  const main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/i);
  if (main && textLength(main[0]) >= MIN_CONTENT_CHARS) return main[0];

  const candidates = [];
  const openRe = /<(div|section)\b([^>]*)>/gi;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const attrs = m[2] || '';
    if (!/class|id/i.test(attrs)) continue;
    if (JUNK_ID_CLASS_RE.test(attrs)) continue;
    if (!/artic|story|content|body|entry|post|main|text/i.test(attrs)) continue;
    const start = m.index;
    let depth = 0;
    let end = -1;
    const scanRe = /<(\/?)(div|section)\b[^>]*>/gi;
    scanRe.lastIndex = start;
    let s;
    while ((s = scanRe.exec(html)) !== null) {
      if (s[1]) depth -= 1;
      else depth += 1;
      if (depth === 0) {
        end = scanRe.lastIndex;
        break;
      }
    }
    if (end === -1) continue;
    const chunk = html.slice(start, end);
    const ps = (chunk.match(/<p\b[^>]*>/gi) || []).length;
    if (ps < 2) continue;
    const score = textLength(chunk) * (1 - linkDensity(chunk));
    candidates.push({ chunk, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.chunk || '';
}

// ── Sanitizador (whitelist anti-XSS) ───────────────────────────────────
// Solo estos tags y atributos sobreviven al render en el modal lector.
// Cualquier otro tag/atributo (onclick, style, iframe...) se descarta.
const ALLOWED_ATTRS = {
  a: ['href'],
  img: ['src', 'alt', 'title'],
};

// Tags de bloque que se descartan (no están en la whitelist) pero que separan
// palabras: se sustituyen por un espacio para no pegar "Primera"+"Segunda".
const SEPARATOR_TAGS = new Set([
  'div', 'section', 'article', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
  'dl', 'dd', 'dt', 'header', 'footer', 'aside', 'main', 'nav', 'form', 'fieldset',
  'details', 'summary', 'address', 'pre', 'center',
]);

// Bloques permitidos que, al quedar dentro de un <a>, se omiten (se deja un espacio).
const LINK_SKIPPED_BLOCKS = new Set(['p', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'figure', 'figcaption']);

const ALLOWED_TAGS = new Set([
  'p', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'br', 'a', 'img', 'figure', 'figcaption', 'hr',
]);

/**
 * Elige la mejor fuente de una imagen: prioriza atributos de lazy-load
 * (data-src, data-original, data-lazy-src) sobre src, y descarta
 * tracking pixels/placeholders vía IMG_SKIP_RE.
 */
function pickImgSrc(attrs) {
  const candidates = [attrs['data-src'], attrs['data-original'], attrs['data-lazy-src'], attrs.src];
  for (const raw of candidates) {
    if (!raw) continue;
    const val = String(raw).trim();
    if (IMG_SKIP_RE.test(val)) continue;
    return val;
  }
  return '';
}

/**
 * Reescribe un fragmento de HTML aplicando la whitelist de tags/attrs:
 *  - Tags no permitidos se eliminan (pero su texto contenido se conserva)
 *  - <a>: solo href resuelto contra baseUrl, sin javascript:, con
 *    rel="noopener noreferrer" target="_blank"
 *  - <img>: se resuelve src (lazy-load), se filtran avatares/pixels,
 *    se añade loading="lazy" y alt siempre presente
 *  - Cierra tags huérfanos para mantener el HTML bien formado
 *  - Descarta contenido dentro de <script>/<style>
 */
function sanitizeFragment(fragment, baseUrl) {
  const tagRe = /<(\/?)([a-z][\w-]*)((?:\s+[^<>]*?)?)\/?>/gi;
  let out = '';
  let stack = [];
  let last = 0;
  let m;
  tagRe.lastIndex = 0;
  while ((m = tagRe.exec(fragment)) !== null) {
    if (!stack.some(s => s === 'script' || s === 'style')) {
      out += fragment.slice(last, m.index);
    }
    last = tagRe.lastIndex;
    const [full, slash, rawTag, rawAttrs] = m;
    const tag = rawTag.toLowerCase();
    if (SEPARATOR_TAGS.has(tag)) {
      out += ' ';
      continue;
    }
    if (slash) {
      if (stack.length && stack[stack.length - 1] === tag) {
        stack.pop();
        if (ALLOWED_TAGS.has(tag)) out += `</${tag}>`;
      } else {
        const idx = stack.lastIndexOf(tag);
        if (idx !== -1) {
          for (let i = stack.length - 1; i >= idx; i--) {
            if (ALLOWED_TAGS.has(stack[i])) out += `</${stack[i]}>`;
          }
          stack.length = idx;
        } else if (LINK_SKIPPED_BLOCKS.has(tag)) {
          out += ' ';
        } else if (!ALLOWED_TAGS.has(tag)) {
          out += INLINE_MARK;
        }
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // Tag inline descartado (span, small…): marcador para decidir al final si
      // separaba palabras ("estados.<span>Foto" → "estados. Foto") o no ("<span>L</span>a").
      out += INLINE_MARK;
      continue;
    }
    if (stack.includes('a') && LINK_SKIPPED_BLOCKS.has(tag)) {
      out += ' ';
      continue;
    }

    const attrs = {};
    const attrRe = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let a;
    while ((a = attrRe.exec(rawAttrs || '')) !== null) {
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    }

    if (tag === 'img') {
      const inLink = stack.includes('a');
      const skipClass = `${attrs.class || ''} ${attrs.id || ''}`;
      if (inLink || IMG_CLASS_SKIP_RE.test(skipClass)) continue;
      const rawSrc = pickImgSrc(attrs);
      const src = resolveUrl(rawSrc, baseUrl);
      if (!src) continue;
      if (attrs.width != null && attrs.height != null) {
        const w = Number(attrs.width);
        const h = Number(attrs.height);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w <= 4 && h <= 4) continue;
      }
      const alt = attrs.alt ? ` alt="${escapeAttr(decodeEntities(attrs.alt))}"` : ' alt=""';
      out += `<img src="${escapeAttr(src)}"${alt} loading="lazy">`;
      continue;
    }

    let attrStr = '';
    if (tag === 'a' && attrs.href) {
      let href = attrs.href;
      if (!/^\s*javascript:/i.test(href)) {
        href = resolveUrl(href, baseUrl);
        if (href) attrStr = ` href="${escapeAttr(href)}" rel="noopener noreferrer" target="_blank"`;
      }
    }

    out += `<${tag}${attrStr}>`;
    if (!VOID_TAGS.has(tag)) stack.push(tag);
  }
  if (!stack.some(s => s === 'script' || s === 'style')) {
    out += fragment.slice(last);
  }
  return resolveInlineMarks(out);
}

// Marcador (carácter de control, nunca presente en HTML real) de un tag inline descartado.
const INLINE_MARK = '\u0001';

/**
 * Resuelve los marcadores de tags inline descartados: si separaban una
 * palabra/frase de otra que empieza en mayúscula (o signo de apertura) tras
 * una letra, dígito o puntuación, se convierten en un espacio; el resto se
 * elimina sin dejar rastro (así "<span>L</span>a" y "Ho<span>la" no se parten).
 */
function resolveInlineMarks(html) {
  return html
    .replace(/([a-zñáéíóúü\d.!?:;,)”"»])\u0001+(?=[A-ZÁÉÍÓÚÑ¿¡“"«(])/g, '$1 ')
    .replace(/\u0001/g, '');
}

/** Escapa caracteres especiales para usar dentro de atributos HTML. */
function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Tokeniza HTML en una lista plana de tags y textos.
 * Se usa por wrapBareText para detectar texto suelto sin envolver.
 */
function parseTags(html) {
  const parts = html.split(/(<[^>]+>)/);
  const tokens = [];
  for (const part of parts) {
    if (!part) continue;
    if (part[0] === '<' && part[part.length - 1] === '>') tokens.push({ type: 'tag', raw: part });
    else tokens.push({ type: 'text', raw: part });
  }
  return tokens;
}

/**
 * Envuelve en <p> cualquier texto suelto que esté fuera de un bloque
 * (p, h2-h4, blockquote, li...). Así todo el contenido visible queda
 * estructurado en párrafos antes de pasarlo al modal.
 * Los textos de menos de 2 chars se descartan (restos de separación).
 */
function wrapBareText(html) {
  const tokens = parseTags(html);
  const out = [];
  const stack = [];
  let buf = '';
  const inTextBlock = () => stack.some(s => ['p', 'h2', 'h3', 'h4', 'blockquote', 'li', 'figcaption'].includes(s));
  const flush = () => {
    const collapsed = buf.replace(/\s+/g, ' ');
    buf = '';
    if (inTextBlock()) {
      // Dentro de un bloque se conserva el espacio colapsado en los bordes:
      // separa el texto de <a>/<strong>/<em> contiguos ("hola <b>mundo</b>").
      if (collapsed) out.push(collapsed);
      return;
    }
    const t = collapsed.trim();
    if (t.replace(/<[^>]+>/g, '').trim().length < 2) return;
    out.push(`<p>${escapeText(t)}</p>`);
  };
  for (const tok of tokens) {
    if (tok.type === 'text') {
      buf += tok.raw;
      continue;
    }
    const raw = tok.raw;
    const slash = raw[1] === '/';
    const tag = (/^<\/?([a-z][\w-]*)/i.exec(raw) || [])[1]?.toLowerCase() || '';
    // Texto suelto con tags inline (<b>, <a>, <em>…): se mantiene en el mismo
    // párrafo en lugar de fragmentarse en un <p> por cada trozo.
    if (!inTextBlock() && INLINE_TAGS.has(tag)) {
      buf += raw;
      continue;
    }
    flush();
    if (slash) {
      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) stack.length = idx;
    } else if (!VOID_TAGS.has(tag)) {
      stack.push(tag);
    }
    out.push(raw);
  }
  flush();
  return out.join('');
}

// Escapa solo los "&" sueltos: cualquier entidad válida (&oacute;, &nbsp;, &#39;…)
// se deja intacta para que el navegador la decodifique una sola vez.
function escapeText(str) {
  return str.replace(/&(?!(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);)/gi, '&amp;');
}

function dropJunkHeadings(html) {
  const re = /<(h1|h2|h3|h4|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  return html.replace(re, (full, tag, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length <= 90 && TRAILING_JUNK_RE.test(text)) return '';
    if (/^h[1-4]$/.test(tag) && text.length <= 6 && !/[.!?]$/.test(text)) {
      if (TRAILING_JUNK_RE.test(text)) return '';
    }
    return full;
  });
}

function cutTrailingSections(html) {
  const headingRe = /<(h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = headingRe.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length <= 90 && TRAILING_JUNK_RE.test(text)) {
      return html.slice(0, m.index).trim();
    }
  }
  return html;
}

function dropLinkHeavyBlocks(html) {
  html = html.replace(/<p[^>]*>[\s\S]*?<\/p>/gi, (block) => {
    if (textLength(block) < 160 && linkDensity(block) > 0.55) return '';
    return block;
  });
  html = html.replace(/<li[^>]*>[\s\S]*?<\/li>/gi, (block) => {
    if (textLength(block) < 120 && linkDensity(block) > 0.7) return '';
    return block;
  });
  return html;
}

function dropTitleDuplicate(html, title) {
  if (!title) return html;
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const target = norm(title);
  if (!target) return html;
  return html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, (block) => {
    const text = norm(block.replace(/<[^>]+>/g, ' '));
    return text === target || target.startsWith(text) || text.startsWith(target) ? '' : block;
  });
}

function dropAffiliateBlocks(html) {
  return html.replace(/<p[^>]*>[\s\S]*?<\/p>/gi, (block) => {
    const text = block.replace(/<[^>]+>/g, ' ');
    return AFFILIATE_RE.test(text) ? '' : block;
  });
}

function dropIsoDateText(html) {
  return html.replace(/>(\s*\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?\s*)</gi, '><');
}

function dropCreditCodes(html) {
  return html.replace(/<p[^>]*>[\s\S]*?<\/p>/gi, (block) => {
    const text = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return /^[\w./-]{2,20}$/.test(text) && text.includes('/') ? '' : block;
  });
}

function extractContent(html, baseUrl) {
  const meta = extractMetadata(html, baseUrl);
  let root = findContentRoot(stripNoise(html));
  if (!root || textLength(root) < MIN_CONTENT_CHARS) {
    return { ok: false, reason: 'Contenido insuficiente', meta };
  }
  root = stripNoise(root);
  root = stripJunkNodes(root);
  let content = sanitizeFragment(root, baseUrl);
  content = dropTitleDuplicate(content, meta.title);
  content = wrapBareText(content);
  content = dropJunkHeadings(content);
  content = cutTrailingSections(content);
  content = dropLinkHeavyBlocks(content);
  content = dropAffiliateBlocks(content);
  content = dropCreditCodes(content);
  content = dropIsoDateText(content);
  content = content.replace(/(<p>\s*<\/p>|<p>\s*<br\s*\/?>\s*<\/p>)/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  const visible = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (visible.length < MIN_CONTENT_CHARS) {
    return { ok: false, reason: 'Contenido insuficiente', meta };
  }
  return { ok: true, content, meta };
}

module.exports = {
  isSafeUrl,
  resolveUrl,
  extractMetadata,
  extractContent,
  MIN_CONTENT_CHARS,
};
