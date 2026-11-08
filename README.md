# InfoNewsNow

Portal de noticias de **ciencia y tecnología** en español, con estética *editorial dark premium*. Construido con HTML/CSS/JS vanilla y un servidor Node sin dependencias que actúa de proxy seguro para la API de [GNews](https://gnews.io).

## Características

- **Hero destacado** — la nota principal a todo el ancho con tipografía serif editorial.
- **Ticker de últimas noticias** — franja animada con los últimos titulares (sin requests extra).
- **9 pestañas** — Tecnología, Ciencia, **Colombia**, Mundo, Negocios, Deportes, Gaming, Salud y Todas. Todo es **global en español** (más volumen y relevancia que filtrar por país) excepto **Colombia**, la sección local (`country=co`, noticias generales de medios colombianos). **Gaming** no existe en GNews: se resuelve con una búsqueda global en español (título y descripción). Entretenimiento se retiró: en Colombia era casi todo farándula.
- **Solo noticias que merecen la pena** — `lib/quality.js` descarta en el servidor loterías, horóscopos, farándula, chismes, influencers, contenido patrocinado y fuentes tabloides (listas editables `BLOCKED_SOURCES` y `BLOCKED_TOPICS`). Como consecuencia, algunas categorías devuelven pocas notas.
- **Favoritos / leer después** — estrella por artículo, panel en el sidebar y vista propia (máx. 50, persistente en `localStorage`).
- **Compartir artículos** — Web Share API o copiar enlace al portapapeles con toast de confirmación.
- **Buscador** — debounce de 400 ms con cancelación de peticiones obsoletas.
- **Lector interno** — al hacer clic en una tarjeta o en el hero se abre un modal con el texto completo extraído de la página fuente (eludiendo cookies, avisos y scripts), con imagen, autor y fechas de publicación/actualización destacadas. El texto conserva espacios y párrafos, decodifica el charset real de la página (UTF-8, ISO-8859-1, windows-1252…) y las entidades HTML.
- **Solo notas legibles** — el servidor verifica en paralelo cada nota de GNews con el lector y descarta las que no se pueden leer dentro de la app (paywalls, bloqueos, contenido insuficiente); nunca hay que abrir la fuente. Puede haber menos de 10 notas por categoría y la primera carga tarda ~2-5 s más (después queda en caché). La verificación no consume cuota de GNews (solo descarga las páginas fuente).
- **Vistas grid y lista** — con animación de entrada y estados vacíos claros.
- **Caché** — TTL de 10 minutos por categoría/búsqueda en el navegador y en el servidor (compartida entre visitantes) para respetar la cuota diaria.
- **Contador de cuota** — panel de estado con solicitudes del día (`N/100`), artículos y estado de la API.
- **Diseño responsive** — sidebar oculto en pantallas medianas, buscador a segunda fila en móvil.
- **Accesibilidad** — `focus-visible`, `prefers-reduced-motion`, etiquetas ARIA.

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | HTML5, CSS3, JavaScript (ES6+, sin frameworks ni build) |
| Servidor | Node.js 18+ (proxy `/api/v4` y lector `/api/reader` sin dependencias; local o Vercel Functions) |
| API | [GNews](https://gnews.io) v4 (top-headlines / search) |
| Tipografía | Inter + Instrument Serif (Google Fonts) |
| Iconos | Font Awesome 6 |
| Tests | `node --test` (runner nativo de Node) |

## Requisitos

- **Node.js 18 o superior**
- Conexión a internet (API GNews + Google Fonts + Font Awesome)

## Puesta en marcha

```bash
git clone https://github.com/jorge042888/InfoNewsNow.git
cd InfoNewsNow
export GNEWS_API_KEY="tu-api-key"   # ver sección API key (PowerShell: $env:GNEWS_API_KEY = "...")
npm start
```

Abre **http://localhost:3000** en tu navegador.

## API key

La API key de GNews se maneja **solo en el servidor** (nunca se expone al cliente):

Define la variable de entorno `GNEWS_API_KEY` (obligatoria; sin ella la API responde 500):

   ```powershell
   # PowerShell (Windows)
   $env:GNEWS_API_KEY = "tu-api-key"
   npm start
   ```

   ```bash
   # macOS / Linux
   export GNEWS_API_KEY="tu-api-key"
   npm start
   ```

> El código no incluye ninguna key. Nunca subas la key al repositorio (es público).

## Límites de GNews (plan Free)

| Límite | Valor | Comportamiento |
|--------|-------|----------------|
| Cuota diaria | 100 requests/día | `403` si se agota |
| Rate limit | 1 request/segundo | `429` si se rebasa |
| Artículos | máx. 10 por request | la app pide `max=10` |

La app mitiga estos límites con caché local de 10 minutos, una sola request por carga (`category=` en vez de requests paralelas) y cancelación de peticiones obsoletas con `AbortController`.

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm start` | Levanta el servidor en `http://localhost:3000` |
| `npm test` | Ejecuta la suite con `node --test` (43 tests) |

## Estructura de archivos

```
technews-landing/
├── public/             # Frontend estático (Vercel lo sirve como raíz)
│   ├── index.html      #   Estructura de la app
│   ├── styles.css      #   Sistema de diseño editorial dark + modal del lector
│   ├── app.js          #   Lógica: categorías, favoritos, compartir, caché, ticker, lector
│   └── utils.js        #   Utilidades puras (escapeHtml, formatDate, debounce…)
├── reader.js           # Extractor de contenido de la fuente (JSON-LD, sanitizado, limpieza)
├── lib/handlers.js     # Lógica compartida de API (proxy GNews + filtrado + lector + charset)
├── lib/quality.js      # Filtro editorial (farándula, loterías, patrocinado, fuentes tabloides)
├── lib/cache.js        # Caché en memoria con TTL (lector y respuestas de GNews)
├── api/                # Funciones de Vercel (deploy en producción)
│   ├── reader.js       #   GET /api/reader?url=
│   └── v4/
│       ├── top-headlines.js
│       └── search.js
├── server.js           # Servidor local de desarrollo (mismos handlers que api/)
├── package.json        # Scripts start / test
├── vercel.json         # Sin framework, salida en public/, maxDuration 30 s en api/v4
├── .vercelignore       # Excluye server.js y tests del deploy
├── .gitignore
└── tests/              # node --test (utils, reader, api, quality, cache)
```

## Cómo funciona el proxy

El navegador llama a rutas locales (`/api/v4/top-headlines`, `/api/v4/search`, `/api/reader`). La lógica vive en `lib/handlers.js` y corre igual en local (`server.js`) y en Vercel (`api/`):

1. Valida método (solo GET) y whitelist de endpoints (`top-headlines`, `search`).
2. Inyecta la API key como parámetro `apikey` (nunca llega al cliente).
3. Hace el fetch a `https://gnews.io/api/v4/...` con timeout de 10 s, descarta las notas superfluas (`lib/quality.js`) y filtra las que el lector no puede mostrar. El resultado se cachea 10 min en el servidor (compartido entre visitantes; peticiones simultáneas iguales comparten una sola request a GNews), lo que reduce mucho el gasto de cuota (deadline de 8 s; las notas verificadas quedan en la caché del lector).
4. `/api/reader` descarga la página fuente (UA de navegador, gzip/br, charset detectado por header/`<meta>`, redirects validados, cap de 2 MB), extrae el contenido con `reader.js` y lo devuelve en JSON con caché en memoria de 15 min.

## Cómo funciona el lector

`reader.js` convierte el HTML de la fuente en un fragmento limpio y seguro (`extractContent`):

1. **Metadatos** — título, imagen, autor y fechas (JSON-LD → Open Graph → `<title>`), con entidades decodificadas.
2. **Bloque de contenido** — `<article>`, `<main>` o el `div`/`section` con más texto y menos enlaces.
3. **Limpieza** — elimina scripts, navegación, publicidad, widgets de recirculación y secciones de cierre ("Más noticias", "Suscríbete"…).
4. **Sanitizado** — whitelist de tags y atributos (anti-XSS) y resolución de URLs. Los tags de bloque descartados (`div`, `td`…) se sustituyen por un espacio y los inline (`span`…) solo si separaban frases, para no pegar palabras.
5. **Párrafos** — el texto suelto se envuelve en `<p>` manteniendo en línea los tags inline (`<b>`, `<a>`, `<em>`).

Si una nota no supera `MIN_CONTENT_CHARS` (400 caracteres visibles) se considera ilegible y el servidor la descarta de los resultados.

## Despliegue en Vercel

1. Importa el repositorio en [vercel.com](https://vercel.com). `vercel.json` fija **sin framework**, sin build y `public/` como salida estática (sin él, Vercel intenta desplegar el proyecto como servidor Node y falla con "No entrypoint found").
2. Las funciones de `api/` se enrutan automáticamente: `api/v4/top-headlines.js` → `/api/v4/top-headlines`, etc. El enrutado de rutas del cliente no cambia (`/api/v4` y `/api/reader` son las mismas URLs).
3. Define la variable de entorno `GNEWS_API_KEY` en *Project Settings → Environment Variables* (**obligatoria**; tras cambiarla hay que hacer *Redeploy*).
4. Cada push a `master` despliega automáticamente. `server.js`, `tests/` y `.claude/` se excluyen del deploy con `.vercelignore` (así `server.js` no queda expuesto como archivo estático).

> Las funciones de `api/v4/` tienen `maxDuration` de 30 s porque verifican las notas antes de responder. En el plan Hobby las funciones viven en una sola región (`iad1` por defecto) y la caché en memoria del lector es por instancia: tras un frío, la primera lectura de una URL tarda ~1 s más.

## Créditos

- Datos: [GNews API](https://gnews.io)
- Tipografías: [Google Fonts](https://fonts.google.com) — Inter, Instrument Serif
- Iconos: [Font Awesome](https://fontawesome.com)

## Licencia

MIT
