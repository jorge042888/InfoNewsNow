const { URL } = require('node:url');

const JUNK_ID_CLASS_RE = /(^|[\s"'-])((ad|ads|advert|banner|billboard|promo|taboola|outbrain|related|relacionad|share|social|comment|disqus|newsletter|subscribe|suscri|cookie|consent|gdpr|popup|modal|overlay|sidebar|widget|breadcrumb|pagination|menu|nav|footer|header|toolbar|skip|etiqueta|tags|topic|temas|carousel|slider|embed|video|galeria|gallery|liveblog|[\w-]*author[\w-]*|byline|app[-_]?promo|weather|trending|popular|mas[-_]noticias?|mas[-_]historias?|mas[-_]notas?|more[-_]?(?:stories|news|posts|info)|reading|sigue|tambien|recirc|cross|paywall|cta|download|market|stock|redes[-_]?sociales|gps[-_]?pill|desvio|pivot|card|publicidad)[\w-]*)/i;

const TRAILING_JUNK_RE = /(otros temas|otras noticias|m[áa]s noticias|m[áa]s en |tambi[ée]n en |tambi[ée]n te puede|te puede interesar|puede interesarte|suscr[íi]bete|newsletter|s[íi]guenos|descarga (la )?app|m[áa]s historias|sigue leyendo|lea tambi[ée]n|notas relacionadas|nota relacionada|compartir en|etiquetas|a[ñn][áa]denos a tus fuentes|fuentes preferidas|s[íi]guenos en redes|no te pierdas ninguna|\[?publicidad\]?)/i;

const AFFILIATE_RE = /(programa de afiliado|ninguno de los art[íi]culos mencionados|sujetos a cambios sin previo aviso|enlaces de esta publicaci[óo]n|publicamos ofertas y descuentos|decisi[óo]n [úu]nica del equipo de editores|\u00danete a nuestro canal|ya est[áa] en whatsapp|desde tu dispositivo m[óo]vil)/i;

const ISO_TEXT_RE = /^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\s*$/;

const IMG_SKIP_RE = /^(data:|\/\/)|spacer|blank\.gif|placeholder|pixel|1x1|gravatar.*[?&]s=1/i;
const IMG_CLASS_SKIP_RE = /avatar|profile|author[-_]?photo|byline[-_]?photo|icon|emoji|logo/i;

const MIN_CONTENT_CHARS = 400;
const INLINE_TAGS = new Set(['strong', 'em', 'b', 'i', 'a', 'br', 'span', 'u', 's', 'small', 'sup', 'sub', 'time', 'code', 'cite', 'abbr']);
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'figure', 'figcaption', 'div', 'section', 'article', 'table', 'tr', 'td', 'th', 'hr', 'pre']);
const VOID_TAGS = new Set(['br', 'hr', 'img']);

function isSafeUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
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

function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function normalizeDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

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

function removeByRegex(html, re) {
  return html.replace(re, '');
}

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

function textLength(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

function linkDensity(html) {
  const total = textLength(html);
  if (!total) return 0;
  const links = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [])
    .map(t => textLength(t))
    .reduce((a, b) => a + b, 0);
  return links / total;
}

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

const ALLOWED_ATTRS = {
  a: ['href'],
  img: ['src', 'alt', 'title'],
};

const ALLOWED_TAGS = new Set([
  'p', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'br', 'a', 'img', 'figure', 'figcaption', 'hr',
]);

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
        }
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (stack.includes('a') && ['p', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'figure', 'figcaption'].includes(tag)) {
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
  return out;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

function wrapBareText(html) {
  const tokens = parseTags(html);
  const out = [];
  const stack = [];
  let buf = '';
  const flush = () => {
    const t = buf.replace(/\s+/g, ' ').trim();
    buf = '';
    if (t.length < 2) return;
    const inBlock = stack.some(s => ['p', 'h2', 'h3', 'h4', 'blockquote', 'li', 'figcaption'].includes(s));
    out.push(inBlock ? t : `<p>${escapeText(t)}</p>`);
  };
  for (const tok of tokens) {
    if (tok.type === 'text') {
      buf += tok.raw;
      continue;
    }
    flush();
    const raw = tok.raw;
    const slash = raw[1] === '/';
    const tag = (slash ? raw.slice(2) : raw.slice(1)).replace(/[>/].*$/, '').toLowerCase();
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

function escapeText(str) {
  return str.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, '&amp;');
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
