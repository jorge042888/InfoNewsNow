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
- **Vistas grid y lista** — con animación de entrada y estados vacíos claros.
- **Caché local** — TTL de 10 minutos por categoría/búsqueda para respetar la cuota diaria.
- **Contador de cuota** — panel de estado con solicitudes del día (`N/100`), artículos y estado de la API.
- **Diseño responsive** — sidebar oculto en pantallas medianas, buscador a segunda fila en móvil.
- **Accesibilidad** — `focus-visible`, `prefers-reduced-motion`, etiquetas ARIA.

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | HTML5, CSS3, JavaScript (ES6+, sin frameworks ni build) |
| Servidor | Node.js 18+ (proxy `/api/v4` sin dependencias) |
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

2. **Fallback incluido** — si no se define la variable, `server.js` usa una key de desarrollo embebida.

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
| `npm test` | Ejecuta la suite con `node --test` (9 tests) |

## Estructura de archivos

```
technews-landing/
├── index.html          # Estructura de la app
├── styles.css          # Sistema de diseño editorial dark
├── app.js              # Lógica: categorías, favoritos, compartir, caché, ticker
├── utils.js            # Utilidades puras (escapeHtml, formatDate, debounce…)
├── server.js           # Proxy Node sin dependencias + server-side API key
├── package.json        # Scripts start / test
├── .gitignore
└── tests/
    └── utils.test.js   # Tests unitarios (node --test)
```

## Cómo funciona el proxy

El navegador llama a rutas locales (`/api/v4/top-headlines`, `/api/v4/search`). `server.js`:

1. Valida método (solo GET) y whitelist de parámetros.
2. Inyecta la API key en el header `Authorization` (nunca llega al cliente).
3. Hace el fetch a `https://gnews.io/api/v4/...` con timeout de 10 s.
4. Devuelve la respuesta JSON al cliente.

## Créditos

- Datos: [GNews API](https://gnews.io)
- Tipografías: [Google Fonts](https://fonts.google.com) — Inter, Instrument Serif
- Iconos: [Font Awesome](https://fontawesome.com)

## Licencia

MIT
