# InfoNewsNow

Portal de noticias de **ciencia y tecnología** en español, con estética *editorial dark premium*. Construido con HTML/CSS/JS vanilla y un servidor Node sin dependencias que actúa de proxy seguro para la API de [GNews](https://gnews.io).

![Captura](docs/screenshot.png)

## Características

- **Hero destacado** — la nota principal a todo el ancho con tipografía serif editorial.
- **Ticker de últimas noticias** — franja animada con los últimos titulares (sin requests extra).
- **8 categorías reales** — Tecnología, Ciencia, Mundo, Negocios, Deportes, Entretenimiento, Salud y Todas (parámetro `category=` de GNews).
- **Favoritos / leer después** — estrella por artículo, panel en el sidebar y vista propia (máx. 50, persistente en `localStorage`).
- **Compartir artículos** — Web Share API o copiar enlace al portapapeles con toast de confirmación.
- **Buscador** — debounce de 400 ms con cancelación de peticiones obsoletas.
- **Lector interno** — al hacer clic en una tarjeta o en el hero se abre un modal con el texto completo extraído de la página fuente (eludiendo cookies, avisos y scripts), con imagen, autor y fechas de publicación/actualización destacadas; si la extracción falla, muestra un fallback con el resumen de GNews y el enlace original.
- **Vistas grid y lista** — con animación de entrada y estados vacíos claros.
- **Caché local** — TTL de 10 minutos por categoría/búsqueda para respetar la cuota diaria.
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
npm start
```

Abre **http://localhost:3000** en tu navegador.

## API key

La API key de GNews se maneja **solo en el servidor** (nunca se expone al cliente):

1. **Opción recomendada** — variable de entorno:

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

2. **Fallback incluido** — si no se define la variable, el servidor usa una key de desarrollo embebida en `lib/handlers.js`.

> ⚠️ **Importante**: este repositorio es público. Si la key embebida sigue activa, **rotála** en [gnews.io](https://gnews.io) y usá la variable de entorno en producción.

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
| `npm test` | Ejecuta la suite con `node --test` (29 tests) |

## Estructura de archivos

```
technews-landing/
├── index.html          # Estructura de la app
├── styles.css          # Sistema de diseño editorial dark + modal del lector
├── app.js              # Lógica: categorías, favoritos, compartir, caché, ticker, lector
├── utils.js            # Utilidades puras (escapeHtml, formatDate, debounce…)
├── reader.js           # Extractor de contenido de la fuente (JSON-LD, sanitizado, limpieza)
├── lib/handlers.js     # Lógica compartida de API (proxy GNews + lector)
├── api/                # Funciones de Vercel (deploy en producción)
│   ├── reader.js       #   GET /api/reader?url=
│   └── v4/
│       ├── top-headlines.js
│       └── search.js
├── server.js           # Servidor local de desarrollo (mismos handlers que api/)
├── package.json        # Scripts start / test
├── .vercelignore       # Excluye server.js y tests del deploy
├── .gitignore
└── tests/              # node --test (utils, reader, api)
```

## Cómo funciona el proxy

El navegador llama a rutas locales (`/api/v4/top-headlines`, `/api/v4/search`, `/api/reader`). La lógica vive en `lib/handlers.js` y corre igual en local (`server.js`) y en Vercel (`api/`):

1. Valida método (solo GET) y whitelist de endpoints (`top-headlines`, `search`).
2. Inyecta la API key como parámetro `apikey` (nunca llega al cliente).
3. Hace el fetch a `https://gnews.io/api/v4/...` con timeout de 10 s.
4. `/api/reader` descarga la página fuente (UA de navegador, gzip/br, redirects validados, cap de 2 MB), extrae el contenido con `reader.js` y lo devuelve en JSON con caché en memoria de 15 min.

## Despliegue en Vercel

1. Importa el repositorio en [vercel.com](https://vercel.com) (framework detectado: **Other**, sin build).
2. Las funciones de `api/` se enrutan automáticamente: `api/v4/top-headlines.js` → `/api/v4/top-headlines`, etc. El enrutado de rutas del cliente no cambia (`/api/v4` y `/api/reader` son las mismas URLs).
3. Recomendado: define la variable de entorno `GNEWS_API_KEY` en *Project Settings → Environment Variables* (si no, se usa el fallback embebido).
4. Cada push a `master` despliega automáticamente. `server.js`, `tests/` y `.claude/` se excluyen del deploy con `.vercelignore` (así `server.js` —que contiene la key de fallback— no queda expuesto como archivo estático).

> En el plan Hobby las funciones viven en una sola región (`iad1` por defecto) y la caché en memoria del lector es por instancia: tras un frío, la primera lectura de una URL tarda ~1 s más.

## Créditos

- Datos: [GNews API](https://gnews.io)
- Tipografías: [Google Fonts](https://fonts.google.com) — Inter, Instrument Serif
- Iconos: [Font Awesome](https://fontawesome.com)

## Licencia

MIT
