const CONFIG = {
  apiUrl: '/api/v4',
  maxResults: 10,
  lang: 'es',
  country: 'co', // solo se aplica a las categorías con `country` (Colombia)
  cacheTTL: 10 * 60 * 1000,
};

// GNews no tiene categoría de gaming: se resuelve con búsqueda (en título y
// descripción) a nivel global en español, sin filtro de país porque los medios
// colombianos publican poco del tema y mezclan mucho ruido. Sin tildes: GNews
// rechaza tildes en la consulta.
const GAMING_QUERY = 'videojuegos OR videojuego OR gaming OR PlayStation OR Xbox OR Nintendo OR "Nintendo Switch" OR Steam OR GTA OR esports';

const CATEGORIES = [
  { id: 'technology', label: 'Tecnología', color: '#7dd3fc' },
  { id: 'science', label: 'Ciencia', color: '#a5b4fc' },
  // Sección local: noticias generales publicadas por medios colombianos.
  { id: 'colombia', label: 'Colombia', color: '#fcd34d', apiCategory: 'general', country: CONFIG.country },
  { id: 'world', label: 'Mundo', color: '#fdba74' },
  { id: 'business', label: 'Negocios', color: '#86efac' },
  { id: 'sports', label: 'Deportes', color: '#fca5a5' },
  { id: 'gaming', label: 'Gaming', color: '#c4b5fd', search: GAMING_QUERY },
  { id: 'health', label: 'Salud', color: '#f9a8d4' },
  { id: 'general', label: 'Todas', color: '#e4e4e7' },
];

// Enlaces directos a medios (panel "Para estar más informado"). Editable.
const SOURCES = [
  {
    group: 'Internacional',
    items: [
      { name: 'BBC Mundo', url: 'https://www.bbc.com/mundo' },
      { name: 'DW Español', url: 'https://www.dw.com/es/' },
      { name: 'France 24', url: 'https://www.france24.com/es/' },
      { name: 'Euronews', url: 'https://es.euronews.com/' },
      { name: 'CNN en Español', url: 'https://cnnespanol.cnn.com/' },
      { name: 'El País', url: 'https://elpais.com/' },
    ],
  },
  {
    group: 'Colombia',
    items: [
      { name: 'El Tiempo', url: 'https://www.eltiempo.com/' },
      { name: 'El Espectador', url: 'https://www.elespectador.com/' },
      { name: 'Portafolio', url: 'https://www.portafolio.co/' },
      { name: 'La República', url: 'https://www.larepublica.co/' },
    ],
  },
];

const STATE = {
  category: 'technology',
  mode: 'feed',
  articles: [],
  view: 'grid',
  searchActive: false,
  cacheStatus: '—',
};

const STORAGE = {
  cache: 'infonewsnow:cache:',
  req: 'infonewsnow:req',
  favs: 'infonewsnow:favs',
  sidebar: 'infonewsnow:sidebar',
  legacy: 'technews:',
};

const FAV_MAX = 50;
const DOM = {};

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getRequestCount() {
  try {
    const raw = localStorage.getItem(STORAGE.req);
    if (!raw) return 0;
    const { date, count } = JSON.parse(raw);
    return date === todayKey() ? count : 0;
  } catch {
    return 0;
  }
}

function incrementRequestCount(n = 1) {
  const count = getRequestCount() + n;
  try {
    localStorage.setItem(STORAGE.req, JSON.stringify({ date: todayKey(), count }));
  } catch { /* almacenamiento no disponible */ }
  return count;
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(STORAGE.cache + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CONFIG.cacheTTL) return null;
    return data;
  } catch {
    return null;
  }
}

function cacheSet(key, data) {
  try {
    localStorage.setItem(STORAGE.cache + key, JSON.stringify({ ts: Date.now(), data }));
    pruneCache();
  } catch { /* cuota llena */ }
}

function pruneCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(STORAGE.cache)) continue;
      const { ts } = JSON.parse(localStorage.getItem(k) || '{}');
      if (!ts || Date.now() - ts > CONFIG.cacheTTL) localStorage.removeItem(k);
    }
  } catch { /* ignorar */ }
}

function cleanupLegacyStorage() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE.legacy)) localStorage.removeItem(k);
    }
  } catch { /* ignorar */ }
}

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.favs)) || [];
  } catch {
    return [];
  }
}

function saveFavorites(favs) {
  try {
    localStorage.setItem(STORAGE.favs, JSON.stringify(favs));
  } catch { /* cuota llena */ }
}

function isFavorite(url) {
  return getFavorites().some(f => f.url === url);
}

function toggleFavorite(article) {
  const favs = getFavorites();
  const idx = favs.findIndex(f => f.url === article.url);
  let added;
  if (idx >= 0) {
    favs.splice(idx, 1);
    added = false;
  } else {
    favs.unshift({
      url: article.url,
      title: article.title,
      description: article.description,
      image: article.image,
      source: article.source,
      publishedAt: article.publishedAt,
      _cat: article._cat,
      _cid: article._cid,
    });
    if (favs.length > FAV_MAX) favs.length = FAV_MAX;
    added = true;
  }
  saveFavorites(favs);
  return added;
}

// Preferencias de la barra lateral: { hidden, collapsed: { favs, sources, status } }.
function loadSidebarPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE.sidebar)) || {};
    return { hidden: !!p.hidden, collapsed: p.collapsed && typeof p.collapsed === 'object' ? p.collapsed : {} };
  } catch {
    return { hidden: false, collapsed: {} };
  }
}

function saveSidebarPrefs(prefs) {
  try {
    localStorage.setItem(STORAGE.sidebar, JSON.stringify(prefs));
  } catch { /* almacenamiento no disponible */ }
}

function categoryById(id) {
  return CATEGORIES.find(c => c.id === id);
}

function init() {
  cleanupLegacyStorage();
  cacheDom();
  bindEvents();
  syncNav();
  updateStats();
  renderSidebarFavorites();
  renderSources();
  initSidebar();
  updateHeaderDate();
  updateClock();
  setInterval(updateClock, 1000);
  loadNews('technology');
}

function cacheDom() {
  DOM.tabs = document.querySelectorAll('.tab[data-category]');
  DOM.newsGrid = document.getElementById('newsGrid');
  DOM.skeletonGrid = document.getElementById('skeletonGrid');
  DOM.errorBanner = document.getElementById('errorBanner');
  DOM.errorMessage = document.getElementById('errorMessage');
  DOM.errorClose = document.getElementById('errorClose');
  DOM.searchInput = document.getElementById('searchInput');
  DOM.refreshBtn = document.getElementById('refreshBtn');
  DOM.currentCategoryLabel = document.getElementById('currentCategoryLabel');
  DOM.resultCount = document.getElementById('resultCount');
  DOM.requestCount = document.getElementById('requestCount');
  DOM.articleCount = document.getElementById('articleCount');
  DOM.cacheStatus = document.getElementById('cacheStatus');
  DOM.apiStatus = document.getElementById('apiStatus');
  DOM.sbConnection = document.getElementById('sbConnection');
  DOM.sbTime = document.getElementById('sbTime');
  DOM.viewGrid = document.getElementById('viewGrid');
  DOM.viewList = document.getElementById('viewList');
  DOM.sidebarFavItem = document.querySelector('.sidebar-item[data-action="favorites-view"]');
  DOM.favList = document.getElementById('favList');
  DOM.favCount = document.getElementById('favCount');
  DOM.favSideCount = document.getElementById('favSideCount');
  DOM.favViewBtn = document.getElementById('favViewBtn');
  DOM.sidebar = document.getElementById('sidebar');
  DOM.sidebarToggle = document.getElementById('sidebarToggle');
  DOM.sourcesList = document.getElementById('sourcesList');
  DOM.ticker = document.getElementById('ticker');
  DOM.tickerTrack = document.getElementById('tickerTrack');
  DOM.headerDate = document.getElementById('headerDate');
  DOM.toast = document.getElementById('toast');
  DOM.readerModal = document.getElementById('readerModal');
  DOM.readerClose = document.getElementById('readerClose');
  DOM.readerShare = document.getElementById('readerShare');
  DOM.readerOriginal = document.getElementById('readerOriginal');
  DOM.readerSource = document.getElementById('readerSource');
  DOM.readerDate = document.getElementById('readerDate');
  DOM.readerLoading = document.getElementById('readerLoading');
  DOM.readerArticle = document.getElementById('readerArticle');
  DOM.readerFallback = document.getElementById('readerFallback');
  DOM.readerHero = document.getElementById('readerHero');
  DOM.readerTitle = document.getElementById('readerTitle');
  DOM.readerByline = document.getElementById('readerByline');
  DOM.readerBody = document.getElementById('readerBody');
  DOM.readerFallbackReason = document.getElementById('readerFallbackReason');
  DOM.readerFallbackDesc = document.getElementById('readerFallbackDesc');
  DOM.readerFallbackLink = document.getElementById('readerFallbackLink');
}

function bindEvents() {
  DOM.tabs.forEach(tab => {
    tab.addEventListener('click', () => setCategory(tab.dataset.category));
  });

  DOM.sidebarFavItem.addEventListener('click', showFavorites);

  DOM.favViewBtn.addEventListener('click', () => {
    if (STATE.mode === 'favorites') loadNews(STATE.category);
    else showFavorites();
  });

  DOM.refreshBtn.addEventListener('click', () => {
    if (STATE.mode === 'favorites') showFavorites();
    else loadNews(STATE.category, { force: true });
  });

  DOM.searchInput.addEventListener('input', debounce((e) => {
    const q = e.target.value.trim();
    if (q.length < 2) {
      if (searchAbortController) searchAbortController.abort();
      loadNews(STATE.category);
      return;
    }
    searchNews(q);
  }, 400));

  DOM.errorClose.addEventListener('click', () => {
    DOM.errorBanner.style.display = 'none';
  });

  DOM.viewGrid.addEventListener('click', () => {
    DOM.viewGrid.classList.add('active');
    DOM.viewList.classList.remove('active');
    STATE.view = 'grid';
    DOM.newsGrid.classList.remove('list-view');
    renderArticles(STATE.articles, emptyMessage());
  });

  DOM.viewList.addEventListener('click', () => {
    DOM.viewList.classList.add('active');
    DOM.viewGrid.classList.remove('active');
    STATE.view = 'list';
    DOM.newsGrid.classList.add('list-view');
    renderArticles(STATE.articles, emptyMessage());
  });

  DOM.newsGrid.addEventListener('click', e => {
    const favBtn = e.target.closest('.btn-fav');
    if (favBtn) {
      e.preventDefault();
      handleFavClick(favBtn);
      return;
    }
    const shareBtn = e.target.closest('.btn-share');
    if (shareBtn) {
      e.preventDefault();
      const card = shareBtn.closest('.news-card');
      const article = STATE.articles[Number(card?.dataset.index)];
      if (article) shareArticle(article);
      return;
    }
    const openLink = e.target.closest('.card-overlay, .news-card-open');
    if (openLink) {
      e.preventDefault();
      const card = openLink.closest('.news-card');
      const article = STATE.articles[Number(card?.dataset.index)];
      if (article && article.url) openReader(article);
    }
  });

  DOM.readerClose.addEventListener('click', closeReader);
  DOM.readerModal.querySelector('[data-reader-close]').addEventListener('click', closeReader);
  DOM.readerShare.addEventListener('click', () => {
    if (readerState.article) shareArticle(readerState.article);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !DOM.readerModal.hidden) closeReader();
  });
}

function setCategory(category) {
  STATE.mode = 'feed';
  STATE.category = category;
  STATE.searchActive = false;
  DOM.searchInput.value = '';
  syncNav();
  loadNews(category);
}

function syncNav() {
  const feed = STATE.mode === 'feed';
  DOM.tabs.forEach(t => {
    t.classList.toggle('active', feed && t.dataset.category === STATE.category);
  });
  DOM.sidebarFavItem.classList.toggle('active', !feed);
  DOM.favViewBtn.classList.toggle('active', !feed);
}

function updateCategoryLabel() {
  if (STATE.mode === 'favorites') {
    DOM.currentCategoryLabel.textContent = 'Favoritos';
    return;
  }
  if (STATE.searchActive) {
    DOM.currentCategoryLabel.textContent = 'Búsqueda';
    return;
  }
  const cat = categoryById(STATE.category);
  DOM.currentCategoryLabel.textContent = cat ? cat.label : STATE.category;
}

function emptyMessage() {
  return STATE.mode === 'favorites'
    ? 'Aún no guardas artículos. Toca la estrella en cualquier nota.'
    : 'No hay notas legibles por ahora. Prueba otra categoría o vuelve en unos minutos.';
}

function setApiStatus(online) {
  if (online) {
    DOM.apiStatus.innerHTML = '<i class="fas fa-check-circle"></i> Online';
    DOM.apiStatus.className = 'stat-value green';
    DOM.sbConnection.innerHTML = '<i class="fas fa-check-circle"></i> Conectado';
  } else {
    DOM.apiStatus.innerHTML = '<i class="fas fa-times-circle"></i> Offline';
    DOM.apiStatus.className = 'stat-value red';
    DOM.sbConnection.innerHTML = '<i class="fas fa-times-circle"></i> Desconectado';
  }
}

function showApiError(err) {
  console.error(err);
  STATE.cacheStatus = 'Fallo';
  setApiStatus(false);
  showError(err.message);
  hideSkeleton();
  updateStats();
}

function showApiSuccess(articles, cacheStatus) {
  STATE.articles = articles;
  STATE.cacheStatus = cacheStatus;
  if (cacheStatus === 'Local') {
    DOM.sbConnection.innerHTML = '<i class="fas fa-database"></i> Caché local';
  } else {
    setApiStatus(true);
  }
  renderArticles(articles, emptyMessage());
  updateStats();
}

let navAbortController = null;

function abortNav() {
  if (navAbortController) navAbortController.abort();
  navAbortController = new AbortController();
  return navAbortController.signal;
}

// GNews devuelve errors como [{ message }] o como ["texto"] (p. ej. cuota agotada).
function apiErrorMessage(errors, fallback) {
  const first = Array.isArray(errors) ? errors[0] : errors;
  return (typeof first === 'string' ? first : first?.message) || fallback;
}

function labelArticles(articles, category) {
  const cat = categoryById(category);
  return articles.map(a => ({ ...a, _cat: cat?.label, _cid: cat?.id }));
}

function loadNews(category, { force = false } = {}) {
  STATE.mode = 'feed';
  STATE.category = category;
  STATE.searchActive = false;
  updateCategoryLabel();
  syncNav();
  hideError();

  const cacheKey = `cat:${category}:${CONFIG.lang}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      abortNav();
      showApiSuccess(cached, 'Local');
      renderTicker(cached);
      return;
    }
  }

  const signal = abortNav();
  showSkeleton();

  const cat = categoryById(category);
  // Todo es global en español salvo la sección Colombia (`country`).
  // Las categorías con `search` (gaming) usan /search; el resto /top-headlines.
  const endpoint = cat?.search ? 'search' : 'top-headlines';
  const params = new URLSearchParams({ lang: CONFIG.lang, max: CONFIG.maxResults });
  if (cat?.search) {
    params.set('q', cat.search);
    params.set('in', 'title,description');
  } else {
    params.set('category', cat?.apiCategory || category);
    if (cat?.country) params.set('country', cat.country);
  }

  incrementRequestCount();
  updateStats();

  fetch(`${CONFIG.apiUrl}/${endpoint}?${params}`, { signal })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r.json();
    })
    .then(data => {
      if (data.errors) throw new Error(apiErrorMessage(data.errors, 'Error de API'));
      const articles = labelArticles(data.articles || [], category);
      cacheSet(cacheKey, articles);
      showApiSuccess(articles, 'Activa');
      renderTicker(articles);
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      showApiError(err);
    });
}

let searchAbortController = null;

function searchNews(query, { force = false } = {}) {
  STATE.mode = 'feed';
  STATE.searchActive = true;
  updateCategoryLabel();
  syncNav();
  hideError();

  const cacheKey = `search:${query}:${CONFIG.lang}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      if (searchAbortController) searchAbortController.abort();
      showApiSuccess(cached, 'Local');
      return;
    }
  }

  showSkeleton();
  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();

  const params = new URLSearchParams({
    q: query,
    lang: CONFIG.lang,
    max: CONFIG.maxResults,
  });

  incrementRequestCount();
  updateStats();

  fetch(`${CONFIG.apiUrl}/search?${params}`, { signal: searchAbortController.signal })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r.json();
    })
    .then(data => {
      if (data.errors) throw new Error(apiErrorMessage(data.errors, 'Error de búsqueda'));
      const articles = data.articles || [];
      cacheSet(cacheKey, articles);
      showApiSuccess(articles, 'Activa');
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      showApiError(err);
    });
}

function showFavorites() {
  if (searchAbortController) searchAbortController.abort();
  STATE.mode = 'favorites';
  STATE.searchActive = false;
  DOM.searchInput.value = '';
  STATE.articles = getFavorites();
  updateCategoryLabel();
  syncNav();
  hideError();
  showApiSuccess(STATE.articles, 'Local');
}

function handleFavClick(btn) {
  const card = btn.closest('.news-card');
  const article = STATE.articles[Number(card?.dataset.index)];
  if (!article) return;

  const added = toggleFavorite(article);
  card.querySelectorAll('.btn-fav').forEach(b => {
    b.classList.toggle('active', added);
    b.title = added ? 'Quitar de guardados' : 'Guardar';
  });

  renderSidebarFavorites();

  if (STATE.mode === 'favorites' && !added) {
    STATE.articles = getFavorites();
    renderArticles(STATE.articles, emptyMessage());
  }
}

async function shareArticle(article) {
  const url = article.url;
  const title = article.title || 'InfoNewsNow';
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Enlace copiado ✓');
  } catch {
    showToast('No se pudo copiar el enlace');
  }
}

let toastTimer = null;
function showToast(msg) {
  DOM.toast.textContent = msg;
  DOM.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => DOM.toast.classList.remove('show'), 2400);
}

const readerState = { article: null, controller: null, lastFocus: null };

function formatFullDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function readerSetMode(mode) {
  DOM.readerLoading.hidden = mode !== 'loading';
  DOM.readerArticle.hidden = mode !== 'article';
  DOM.readerFallback.hidden = mode !== 'fallback';
}

function renderReaderByline({ author, published, updated }) {
  const bits = [];
  if (author) bits.push(`<span class="rb-author">Por ${escapeHtml(author)}</span>`);
  const pub = formatFullDate(published);
  if (pub) bits.push(`<span class="rb-item"><i class="far fa-calendar"></i> Publicado ${pub}</span>`);
  const upd = formatFullDate(updated);
  if (upd && upd !== pub) bits.push(`<span class="rb-item rb-updated"><i class="fas fa-sync-alt"></i> Actualizado ${upd}</span>`);
  DOM.readerByline.innerHTML = bits.join('<span class="rb-sep">·</span>');
}

function bindReaderImages(root) {
  root.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', () => {
      img.remove();
    }, { once: true });
  });
  if (root !== DOM.readerHero && DOM.readerHero.closest('#readerArticle')) {
    DOM.readerHero.addEventListener('error', () => {
      DOM.readerHero.hidden = true;
    }, { once: true });
  }
}

function openReader(article) {
  if (!article || !article.url) return;
  readerState.article = article;
  readerState.lastFocus = document.activeElement;

  const source = article.source?.name || article.source?.title || 'Fuente desconocida';
  const published = article.publishedAt || '';
  DOM.readerSource.textContent = source;
  DOM.readerDate.textContent = formatFullDate(published) || (published ? formatDate(published) : '');
  DOM.readerOriginal.href = article.url;
  DOM.readerFallbackLink.href = article.url;

  DOM.readerTitle.textContent = article.title || '';
  renderReaderByline({ author: article.author || '', published, updated: '' });
  if (article.image) {
    DOM.readerHero.src = article.image;
    DOM.readerHero.alt = article.title || '';
    DOM.readerHero.hidden = false;
  } else {
    DOM.readerHero.hidden = true;
    DOM.readerHero.removeAttribute('src');
  }
  DOM.readerBody.innerHTML = '';
  DOM.readerFallbackDesc.textContent = article.description || '';
  readerSetMode('loading');

  DOM.readerModal.hidden = false;
  document.body.classList.add('reader-open');
  DOM.readerClose.focus();

  if (readerState.controller) readerState.controller.abort();
  readerState.controller = new AbortController();

  fetch(`/api/reader?url=${encodeURIComponent(article.url)}`, { signal: readerState.controller.signal })
    .then(r => r.json())
    .then(data => {
      if (readerState.article !== article) return;
      if (data.ok && data.content) {
        if (data.image) {
          DOM.readerHero.src = data.image;
          DOM.readerHero.alt = data.title || article.title || '';
          DOM.readerHero.hidden = false;
        }
        if (data.title) DOM.readerTitle.textContent = data.title;
        const publishedIso = data.date || published;
        DOM.readerDate.textContent = formatFullDate(publishedIso) || DOM.readerDate.textContent;
        renderReaderByline({
          author: data.author || article.author || '',
          published: publishedIso,
          updated: data.modified || '',
        });
        DOM.readerBody.innerHTML = data.content;
        bindReaderImages(DOM.readerBody);
        readerSetMode('article');
      } else {
        showReaderFallback(data.reason || 'No se pudo extraer el contenido');
      }
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      if (readerState.article !== article) return;
      showReaderFallback('No se pudo cargar la página fuente');
    });
}

function showReaderFallback(reason) {
  DOM.readerFallbackReason.textContent = reason || 'Contenido no disponible';
  readerSetMode('fallback');
}

function closeReader() {
  if (DOM.readerModal.hidden) return;
  if (readerState.controller) readerState.controller.abort();
  readerState.controller = null;
  readerState.article = null;
  DOM.readerModal.hidden = true;
  document.body.classList.remove('reader-open');
  DOM.readerBody.innerHTML = '';
  if (readerState.lastFocus && typeof readerState.lastFocus.focus === 'function') {
    readerState.lastFocus.focus();
  }
  readerState.lastFocus = null;
}

const CATEGORY_ICONS = {
  technology: 'fa-microchip',
  science: 'fa-flask',
  world: 'fa-globe',
  business: 'fa-chart-line',
  sports: 'fa-futbol',
  gaming: 'fa-gamepad',
  colombia: 'fa-flag',
  health: 'fa-heartbeat',
  general: 'fa-newspaper',
};

function renderTicker(articles) {
  const items = (articles || []).filter(a => a.title && a.url).slice(0, 10);
  if (!items.length) {
    DOM.ticker.style.display = 'none';
    return;
  }
  DOM.ticker.style.display = '';
  const inner = items.map(a => {
    const icon = CATEGORY_ICONS[a._cid] || 'fa-newspaper';
    return `
    <a class="ticker-item" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer"><i class="fas ${icon} ticker-icon" aria-hidden="true"></i><span class="ticker-title">${escapeHtml(a.title)}</span></a>
    <span class="ticker-sep">·</span>`;
  }).join('');
  DOM.tickerTrack.innerHTML = `<div class="ticker-move">${inner}${inner}</div>`;
}

function renderSidebarFavorites() {
  const favs = getFavorites();
  DOM.favCount.textContent = favs.length;
  DOM.favSideCount.textContent = favs.length;

  if (!favs.length) {
    DOM.favList.innerHTML = '<div class="fav-empty">Sin artículos guardados</div>';
    return;
  }
  DOM.favList.innerHTML = favs.slice(0, 6).map(f => `
    <div class="fav-row">
      <a class="fav-list-item" href="${escapeHtml(f.url || '#')}" target="_blank" rel="noopener noreferrer">
        <i class="far fa-newspaper"></i>
        <span>${escapeHtml(f.title || 'Sin título')}</span>
      </a>
      <button class="fav-remove" type="button" data-url="${escapeHtml(f.url || '')}" title="Quitar de guardados" aria-label="Quitar de guardados"><i class="fas fa-times"></i></button>
    </div>`).join('');
}

// Panel "Para estar más informado": enlaces directos agrupados.
function renderSources() {
  DOM.sourcesList.innerHTML = SOURCES.map(g => `
    <div class="source-group">
      <div class="source-group-title">${escapeHtml(g.group)}</div>
      ${g.items.map(i => `
      <a class="source-item" href="${escapeHtml(i.url)}" target="_blank" rel="noopener noreferrer">
        <span class="source-dot" aria-hidden="true"></span>
        <span class="source-name">${escapeHtml(i.name)}</span>
      </a>`).join('')}
    </div>`).join('');
}

// Barra lateral: bloques plegables y botón para ocultarla; se recuerda la elección.
function initSidebar() {
  const prefs = loadSidebarPrefs();

  const applyHidden = hidden => {
    document.body.classList.toggle('sidebar-hidden', hidden);
    DOM.sidebarToggle.setAttribute('aria-expanded', String(!hidden));
    DOM.sidebar.setAttribute('aria-hidden', String(hidden));
  };
  applyHidden(prefs.hidden);

  const toggleSidebar = () => {
    prefs.hidden = !document.body.classList.contains('sidebar-hidden');
    applyHidden(prefs.hidden);
    saveSidebarPrefs(prefs);
  };
  DOM.sidebarToggle.addEventListener('click', toggleSidebar);
  document.getElementById('sidebarHandle').addEventListener('click', toggleSidebar);

  DOM.sidebar.querySelectorAll('.sidebar-block').forEach(block => {
    const key = block.dataset.block;
    const btn = block.querySelector('.section-toggle');
    const setCollapsed = collapsed => {
      block.classList.toggle('collapsed', collapsed);
      btn.setAttribute('aria-expanded', String(!collapsed));
    };
    setCollapsed(!!prefs.collapsed[key]);
    btn.addEventListener('click', () => {
      const collapsed = !block.classList.contains('collapsed');
      setCollapsed(collapsed);
      prefs.collapsed[key] = collapsed;
      saveSidebarPrefs(prefs);
    });
  });

  DOM.favList.addEventListener('click', e => {
    const rm = e.target.closest('.fav-remove');
    if (!rm) return;
    const url = rm.dataset.url;
    saveFavorites(getFavorites().filter(f => f.url !== url));
    renderSidebarFavorites();
    if (STATE.mode === 'favorites') {
      showFavorites();
    } else {
      document.querySelectorAll('.news-card').forEach(card => {
        const a = STATE.articles[Number(card.dataset.index)];
        if (a && a.url === url) card.querySelector('.btn-fav')?.classList.remove('active');
      });
    }
  });
}

const IMG_FALLBACK = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22340%22 height=%22180%22><rect fill=%22%2318181c%22 width=%22340%22 height=%22180%22/><text fill=%22%236e6e78%22 x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dy=%22.3em%22 font-family=%22sans-serif%22 font-size=%2213%22>Sin imagen</text></svg>';

function renderCard(article, index, isHero) {
  const a = article;
  const title = a.title || 'Sin título';
  const desc = a.description || 'Sin descripción disponible';
  const image = a.image || '';
  const source = a.source?.name || a.source?.title || 'Fuente desconocida';
  const date = a.publishedAt ? formatDate(a.publishedAt) : '';
  const url = a.url || '#';

  const cid = a._cid || (STATE.mode === 'feed' && !STATE.searchActive ? STATE.category : null);
  const cat = cid ? categoryById(cid) : null;
  const fav = isFavorite(url);
  const delay = Math.min(index, 8) * 0.04;

  const favBtn = `
    <button class="card-iconbtn btn-fav${fav ? ' active' : ''}" type="button"
            title="${fav ? 'Quitar de guardados' : 'Guardar'}" aria-label="Guardar artículo">
      <i class="fas fa-star"></i>
    </button>`;

  if (isHero) {
    return `
      <article class="news-card news-hero" data-index="${index}" style="animation-delay:${delay}s">
        <div class="news-card-media">
          <img class="news-card-image" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.src='${IMG_FALLBACK}'">
          <div class="hero-overlay"></div>
          ${cat ? `<span class="cat-badge" style="--cat:${cat.color}">${escapeHtml(cat.label)}</span>` : ''}
          <div class="hero-content">
            <span class="hero-label">Destacado</span>
            <h2 class="hero-title">${escapeHtml(title)}</h2>
            <p class="hero-desc">${escapeHtml(desc)}</p>
            <div class="hero-meta">
              <span class="hero-source">${escapeHtml(source)}</span>
              <span class="hm-sep">·</span>
              <span class="hero-time">${date}</span>
            </div>
          </div>
          ${favBtn}
        </div>
        <div class="news-card-body hero-body">
          <div class="news-card-footer">
            <span class="news-card-date"><i class="far fa-newspaper"></i> ${escapeHtml(source)}</span>
            <div class="news-card-actions">
              <button class="card-iconbtn btn-share" type="button" title="Compartir" aria-label="Compartir"><i class="fas fa-share-alt"></i></button>
              <a class="news-card-open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir artículo <i class="fas fa-arrow-right"></i></a>
            </div>
          </div>
        </div>
        <a class="card-overlay" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(title)}"></a>
      </article>`;
  }

  return `
    <article class="news-card" data-index="${index}" style="animation-delay:${delay}s">
      <div class="news-card-media">
        <img class="news-card-image" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.src='${IMG_FALLBACK}'">
        ${cat ? `<span class="cat-badge" style="--cat:${cat.color}">${escapeHtml(cat.label)}</span>` : ''}
        ${favBtn}
      </div>
      <div class="news-card-body">
        <div class="news-card-source">
          ${cat ? `<span class="src-cat" style="--cat:${cat.color}">${escapeHtml(cat.label)}</span>` : ''}
          <span class="src-name">${escapeHtml(source)}</span>
        </div>
        <h2 class="news-card-title">${escapeHtml(title)}</h2>
        <p class="news-card-desc">${escapeHtml(desc)}</p>
        <div class="news-card-footer">
          <span class="news-card-date"><i class="far fa-clock"></i> ${date}</span>
          <div class="news-card-actions">
            <button class="card-iconbtn btn-share" type="button" title="Compartir" aria-label="Compartir"><i class="fas fa-share-alt"></i></button>
            <a class="news-card-open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir <i class="fas fa-arrow-right"></i></a>
          </div>
        </div>
      </div>
      <a class="card-overlay" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(title)}"></a>
    </article>`;
}

function renderArticles(articles, emptyMsg) {
  hideSkeleton();

  if (!articles || articles.length === 0) {
    DOM.newsGrid.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon"><i class="fas fa-${STATE.mode === 'favorites' ? 'bookmark' : 'search'}"></i></div>
        <div class="no-results-text">${emptyMsg || 'No se encontraron artículos'}</div>
      </div>`;
    DOM.resultCount.textContent = STATE.mode === 'favorites' ? '0 guardados' : '0 artículos';
    DOM.articleCount.textContent = '0';
    return;
  }

  const withHero = STATE.view === 'grid';
  DOM.newsGrid.innerHTML = articles
    .map((a, i) => renderCard(a, i, withHero && i === 0))
    .join('');

  const suffix = STATE.mode === 'favorites' ? ' guardados' : ' artículos';
  DOM.resultCount.textContent = `${articles.length}${suffix}`;
  DOM.articleCount.textContent = `${articles.length}`;
  popNumber(DOM.resultCount);
  popNumber(DOM.articleCount);
}

function showSkeleton() {
  DOM.skeletonGrid.style.display = 'grid';
  DOM.newsGrid.innerHTML = '';
  setLoading(true);
}

function hideSkeleton() {
  DOM.skeletonGrid.style.display = 'none';
  setLoading(false);
}

// Marca la pestaña activa y el botón de recargar como "cargando" (spinner/giro).
function setLoading(on) {
  document.body.classList.toggle('is-loading', on);
  DOM.refreshBtn.classList.toggle('spinning', on);
}

// Pequeño "pop" en un contador cuando cambia su valor.
function popNumber(el) {
  el.classList.remove('pop');
  void el.offsetWidth; // reinicia la animación
  el.classList.add('pop');
}

function showError(msg) {
  DOM.errorMessage.textContent = `Error: ${msg || 'No se pudieron cargar las noticias. Intenta de nuevo más tarde.'}`;
  DOM.errorBanner.style.display = 'flex';
}

function hideError() {
  DOM.errorBanner.style.display = 'none';
}

function updateStats() {
  DOM.requestCount.textContent = `${getRequestCount()}/100 hoy`;
  DOM.cacheStatus.textContent = STATE.cacheStatus;
}

function updateHeaderDate() {
  DOM.headerDate.textContent = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function updateClock() {
  const now = new Date();
  DOM.sbTime.innerHTML = `<i class="far fa-clock"></i> ${now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
}

document.addEventListener('DOMContentLoaded', init);
