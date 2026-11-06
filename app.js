const CONFIG = {
  apiUrl: '/api/v4',
  maxResults: 10,
  lang: 'es',
  country: 'mx',
  cacheTTL: 10 * 60 * 1000,
};

const CATEGORIES = [
  { id: 'technology', label: 'Tecnología', color: '#7dd3fc' },
  { id: 'science', label: 'Ciencia', color: '#a5b4fc' },
  { id: 'world', label: 'Mundo', color: '#fdba74' },
  { id: 'business', label: 'Negocios', color: '#86efac' },
  { id: 'sports', label: 'Deportes', color: '#fca5a5' },
  { id: 'entertainment', label: 'Entretenimiento', color: '#fde047' },
  { id: 'health', label: 'Salud', color: '#f9a8d4' },
  { id: 'general', label: 'Todas', color: '#e4e4e7' },
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
  DOM.ticker = document.getElementById('ticker');
  DOM.tickerTrack = document.getElementById('tickerTrack');
  DOM.headerDate = document.getElementById('headerDate');
  DOM.toast = document.getElementById('toast');
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
    }
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
    : 'No se encontraron artículos';
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

  const cacheKey = `cat:${category}:${CONFIG.lang}:${CONFIG.country}`;
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

  const params = new URLSearchParams({
    category,
    lang: CONFIG.lang,
    country: CONFIG.country,
    max: CONFIG.maxResults,
  });

  incrementRequestCount();
  updateStats();

  fetch(`${CONFIG.apiUrl}/top-headlines?${params}`, { signal })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r.json();
    })
    .then(data => {
      if (data.errors) throw new Error(data.errors[0]?.message || 'Error de API');
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

  const cacheKey = `search:${query}:${CONFIG.lang}:${CONFIG.country}`;
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
    country: CONFIG.country,
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
      if (data.errors) throw new Error(data.errors[0]?.message || 'Error de búsqueda');
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

function renderTicker(articles) {
  const items = (articles || []).filter(a => a.title && a.url).slice(0, 10);
  if (!items.length) {
    DOM.ticker.style.display = 'none';
    return;
  }
  DOM.ticker.style.display = '';
  const inner = items.map(a => `
    <a class="ticker-item" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>
    <span class="ticker-sep">·</span>`).join('');
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
    <a class="fav-list-item" href="${escapeHtml(f.url || '#')}" target="_blank" rel="noopener noreferrer">
      <i class="far fa-newspaper"></i>
      <span>${escapeHtml(f.title || 'Sin título')}</span>
    </a>`).join('');
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
}

function showSkeleton() {
  DOM.skeletonGrid.style.display = 'grid';
  DOM.newsGrid.innerHTML = '';
}

function hideSkeleton() {
  DOM.skeletonGrid.style.display = 'none';
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
  DOM.headerDate.textContent = new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function updateClock() {
  const now = new Date();
  DOM.sbTime.innerHTML = `<i class="far fa-clock"></i> ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
}

document.addEventListener('DOMContentLoaded', init);
