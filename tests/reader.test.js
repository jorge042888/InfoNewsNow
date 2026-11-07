const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSafeUrl, resolveUrl, extractMetadata, extractContent } = require('../reader.js');

test('isSafeUrl acepta http/https públicos', () => {
  assert.equal(isSafeUrl('https://example.com/noticia'), true);
  assert.equal(isSafeUrl('http://example.com/noticia?a=1'), true);
});

test('isSafeUrl rechaza esquemas peligrosos', () => {
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUrl('file:///etc/passwd'), false);
  assert.equal(isSafeUrl('data:text/html,<script>'), false);
  assert.equal(isSafeUrl('ftp://example.com'), false);
  assert.equal(isSafeUrl(''), false);
  assert.equal(isSafeUrl(null), false);
  assert.equal(isSafeUrl('no es una url'), false);
});

test('isSafeUrl rechaza hosts privados y loopback', () => {
  assert.equal(isSafeUrl('http://localhost:3000/x'), false);
  assert.equal(isSafeUrl('http://127.0.0.1/x'), false);
  assert.equal(isSafeUrl('http://10.0.0.5/x'), false);
  assert.equal(isSafeUrl('http://192.168.1.1/x'), false);
  assert.equal(isSafeUrl('http://172.16.0.1/x'), false);
  assert.equal(isSafeUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isSafeUrl('http://user:pass@example.com/x'), false);
});

test('resolveUrl resuelve relativas y descarta protocolos no http', () => {
  assert.equal(resolveUrl('/img/a.jpg', 'https://example.com/noticia'), 'https://example.com/img/a.jpg');
  assert.equal(resolveUrl('https://other.com/b.jpg', 'https://example.com/'), 'https://other.com/b.jpg');
  assert.equal(resolveUrl('javascript:x', 'https://example.com/'), '');
  assert.equal(resolveUrl('', 'https://example.com/'), '');
});

test('extractMetadata lee og:title, og:image, fechas y autor', () => {
  const html = `
    <html><head>
      <title>Título fallback</title>
      <meta property="og:title" content="Titular OG">
      <meta property="og:image" content="/media/foto.jpg">
      <meta property="og:description" content="Resumen de la noticia">
      <meta property="article:published_time" content="2026-11-06T10:00:00Z">
      <meta property="article:modified_time" content="2026-11-06T14:30:00Z">
      <meta name="author" content="Redacción">
    </head><body></body></html>`;
  const meta = extractMetadata(html, 'https://example.com/n/1');
  assert.equal(meta.title, 'Titular OG');
  assert.equal(meta.image, 'https://example.com/media/foto.jpg');
  assert.equal(meta.description, 'Resumen de la noticia');
  assert.equal(meta.date, '2026-11-06T10:00:00.000Z');
  assert.equal(meta.modified, '2026-11-06T14:30:00.000Z');
  assert.equal(meta.author, 'Redacción');
});

test('extractMetadata prioriza JSON-LD (fecha, modificación, autor)', () => {
  const html = `
    <html><head>
      <meta property="og:title" content="OG title">
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": "Titular JSON-LD",
        "datePublished": "2026-11-05T08:00:00Z",
        "dateModified": "2026-11-06T09:15:00Z",
        "author": [{ "@type": "Person", "name": "María López" }],
        "image": ["https://example.com/ld.jpg"]
      }
      </script>
    </head><body></body></html>`;
  const meta = extractMetadata(html, 'https://example.com/n/2');
  assert.equal(meta.title, 'Titular JSON-LD');
  assert.equal(meta.date, '2026-11-05T08:00:00.000Z');
  assert.equal(meta.modified, '2026-11-06T09:15:00.000Z');
  assert.equal(meta.author, 'María López');
  assert.equal(meta.image, 'https://example.com/ld.jpg');
});

test('extractMetadata sin fecha de modificación devuelve vacío', () => {
  const html = `<meta property="article:published_time" content="2026-11-06T10:00:00Z">`;
  const meta = extractMetadata(html, 'https://example.com/x');
  assert.equal(meta.date, '2026-11-06T10:00:00.000Z');
  assert.equal(meta.modified, '');
});

const fixture = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="Noticia de prueba">
  <meta property="og:image" content="https://example.com/hero.jpg">
  <meta property="og:description" content="Descripción GNews">
</head>
<body>
  <nav class="menu"><a href="/a">Inicio</a><a href="/b">Deportes</a></nav>
  <header class="site-header">Marca</header>
  <div class="sidebar"><p>Widgets y publis</p></div>
  <div class="ad-banner"><p>Publicidad</p></div>
  <article class="story-body">
    <h1>Noticia de prueba</h1>
    <p>Primer párrafo con <strong>negritas</strong> y un <a href="https://example.com/rel">enlace</a>.</p>
    <p>Segundo párrafo que habla de tecnología, ciencia y el futuro de las noticias en línea para lectores modernos que buscan claridad.</p>
    <p>Tercer párrafo con más contexto suficiente para superar el mínimo de caracteres requerido por el extractor de contenido.</p>
    <p>Cuarto párrafo desarrolla la noticia con datos, citas de protagonistas y el desenlace esperado de los hechos relatados.</p>
    <img src="/media/inline.jpg" alt="Imagen">
    <script>alert('ads')</script>
    <p onclick="hack()">Párrafo con atributo peligroso.</p>
  </article>
  <footer class="site-footer"><p>Pie de página</p></footer>
  <aside class="related"><p>Noticias relacionadas</p></aside>
</body>
</html>`;

test('extractContent extrae <article>, limpia nav/ads/scripts y resuelve imágenes', () => {
  const result = extractContent(fixture, 'https://example.com/noticias/1');
  assert.equal(result.ok, true);
  assert.match(result.content, /Primer párrafo/);
  assert.match(result.content, /Segundo párrafo/);
  assert.match(result.content, /href="https:\/\/example\.com\/rel"/);
  assert.match(result.content, /src="https:\/\/example\.com\/media\/inline\.jpg"/);
  assert.doesNotMatch(result.content, /alert\(/);
  assert.doesNotMatch(result.content, /onclick/);
  assert.doesNotMatch(result.content, /Publicidad/);
  assert.doesNotMatch(result.content, /Widgets/);
  assert.doesNotMatch(result.content, /Pie de página/);
  assert.doesNotMatch(result.content, /Noticias relacionadas/);
  assert.doesNotMatch(result.content, /Inicio/);
  assert.doesNotMatch(result.content, /<script/i);
});

test('extractContent devuelve ok:false si no hay contenido suficiente', () => {
  const html = `<html><head><meta property="og:title" content="Vacía"></head>
    <body><article><p>Corto.</p></article></body></html>`;
  const result = extractContent(html, 'https://example.com/x');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Contenido insuficiente');
  assert.equal(result.meta.title, 'Vacía');
});

test('extractContent prefiere <article> sobre wrappers y descarta JS puro', () => {
  const jsShell = `<html><body><div id="app"></div><script>render()</script></body></html>`;
  const result = extractContent(jsShell, 'https://example.com/spa');
  assert.equal(result.ok, false);
});

test('extractContent corta secciones finales de junk (Otros temas, Más noticias)', () => {
  const html = `<html><head><meta property="og:title" content="Titular"></head><body>
    <article>
      <p>El cuerpo principal de la noticia contiene la información importante que el lector necesita, con datos verificados y contexto suficiente.</p>
      <p>Segundo párrafo con más detalles del acontecimiento, declaraciones de los protagonistas y el desenlace de la historia para los lectores.</p>
      <p>Tercer párrafo desarrolla el tema con citas textuales, cifras oficiales y el contexto histórico completo del hecho noticioso.</p>
      <p>Cuarto párrafo extiende la información con datos adicionales, testimonios y proyecciones a futuro relevantes para la audiencia.</p>
      <p>Quinto párrafo cierra la cobertura con conclusiones, posturas de los involucrados y la información pendiente que se confirmará.</p>
      <h2>Otros temas</h2>
      <p><a href="https://example.com/1">Noticia relacionada uno</a></p>
      <p><a href="https://example.com/2">Noticia relacionada dos</a></p>
    </article></body></html>`;
  const result = extractContent(html, 'https://example.com/n');
  assert.equal(result.ok, true);
  assert.match(result.content, /Quinto párrafo/);
  assert.doesNotMatch(result.content, /Otros temas/);
  assert.doesNotMatch(result.content, /Noticia relacionada/);
});

test('extractContent elimina imágenes dentro de enlaces y atributos peligrosos', () => {
  const html = `<html><head><meta property="og:title" content="Titular"></head><body>
    <article>
      <p>Primer párrafo del cuerpo con contenido suficiente y bien estructurado para superar el mínimo establecido.</p>
      <p>Segundo párrafo desarrolla la historia con datos concretos, fechas verificadas y el contexto necesario.</p>
      <p>Tercer párrafo aporta más información de valor, citas y el desenlace esperado de los hechos.</p>
      <p>Cuarto párrafo extiende el relato con testimonios, cifras y proyecciones relevantes para el lector.</p>
      <p>Quinto párrafo remata con conclusiones y lo que se saber pendiente para próximas entregas periodísticas.</p>
      <p>Y un sexto párrafo para asegurar que la extracción supere holgadamente el mínimo de caracteres visibles.</p>
      <a href="https://example.com/rel"><img src="/thumb.jpg" alt="Relacionada"></a>
      <img src="/media/foto-real.jpg" alt="Foto de la noticia" onclick="hack()" onerror="x()">
      <img src="data:image/gif;base64,R0lGOD" alt="tracking">
    </article></body></html>`;
  const result = extractContent(html, 'https://example.com/n');
  assert.equal(result.ok, true);
  assert.match(result.content, /src="https:\/\/example\.com\/media\/foto-real\.jpg"/);
  assert.doesNotMatch(result.content, /thumb\.jpg/);
  assert.doesNotMatch(result.content, /data:image/);
  assert.doesNotMatch(result.content, /onclick|onerror/);
});
