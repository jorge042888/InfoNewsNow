const CONFIG = {
  apiUrl: '/api/v4',
  maxResults: 12,
  lang: 'es',
  country: 'mx',
  cacheTTL: 10 * 60 * 1000,
};

const STATE = {
  category: 'technology',
  articles: [],
  view: 'grid',
  searchActive: false,
  cacheStatus: '—',
};

const DOM = {};

const CACHE_PREFIX = 'technews:cache:';
const REQ_COUNTER_KEY = 'technews:req';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getRequestCount() {
  try {
    const raw = localStorage.getItem(REQ_COUNTER_KEY);
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
    localStorage.setItem(REQ_COUNTER_KEY, JSON.stringify({ date: todayKey(), count }));
  } catch { /* almacenamiento no disponible */ }
  return count;
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
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
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
    pruneCache();
  } catch { /* cuota llena */ }
}

function pruneCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(CACHE_PREFIX)) continue;
      const { ts } = JSON.parse(localStorage.getItem(k) || '{}');
      if (!ts || Date.now() - ts > CONFIG.cacheTTL) localStorage.removeItem(k);
    }
  } catch { /* ignorar */ }
}

function init() {
  cacheDom();
  bindEvents();
  syncNav();
  updateStats();
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
  DOM.sidebarItems = document.querySelectorAll('.sidebar-item[data-category]');
}

function bindEvents() {
  DOM.tabs.forEach(tab => {
    tab.addEventListener('click', () => setCategory(tab.dataset.category));
  });

  DOM.sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
      const cat = item.dataset.category;
      if (cat === 'current') {
        DOM.searchInput.value = '';
        if (STATE.category === 'all') loadAll();
        else loadNews(STATE.category);
      } else {
        setCategory(cat);
      }
    });
  });

  DOM.refreshBtn.addEventListener('click', () => {
    const q = DOM.searchInput.value.trim();
    if (STATE.searchActive && q.length >= 2) {
      searchNews(q, { force: true });
    } else if (STATE.category === 'all') {
      loadAll({ force: true });
    } else {
      loadNews(STATE.category, { force: true });
    }
  });

  DOM.searchInput.addEventListener('input', debounce((e) => {
    const q = e.target.value.trim();
    if (q.length < 2) {
      if (searchAbortController) searchAbortController.abort();
      if (STATE.category === 'all') loadAll();
      else loadNews(STATE.category);
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
  });

  DOM.viewList.addEventListener('click', () => {
    DOM.viewList.classList.add('active');
    DOM.viewGrid.classList.remove('active');
    STATE.view = 'list';
    DOM.newsGrid.classList.add('list-view');
  });
}

function setCategory(category) {
  STATE.category = category;
  STATE.searchActive = false;
  DOM.searchInput.value = '';
  syncNav();
  if (category === 'all') loadAll();
  else loadNews(category);
}

function syncNav() {
  const cat = STATE.category;
  DOM.tabs.forEach(t => t.classList.toggle('active', t.dataset.category === cat));
  DOM.sidebarItems.forEach(item => {
    const dc = item.dataset.category;
    const active = dc === 'current' ? cat !== 'science' && cat !== 'technology' : dc === cat;
    item.classList.toggle('active', active);
  });
}

function updateCategoryLabel(category) {
  const labelMap = {
    technology: 'Tecnología',
    science: 'Ciencia',
    all: 'Todas',
  };
  DOM.currentCategoryLabel.textContent = labelMap[category] || category;
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
  if (cacheStatus !== 'Local') setApiStatus(true);
  renderArticles(articles);
  updateStats();
}

let navAbortController = null;

function abortNav() {
  if (navAbortController) navAbortController.abort();
  navAbortController = new AbortController();
  return navAbortController.signal;
}

function loadNews(category, { force = false } = {}) {
  STATE.category = category;
  STATE.searchActive = false;
  updateCategoryLabel(category);
  syncNav();
  hideError();

  const cacheKey = `cat:${category}:${CONFIG.lang}:${CONFIG.country}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      abortNav();
      showApiSuccess(cached, 'Local');
      return;
    }
  }

  const signal = abortNav();
  showSkeleton();

  const params = new URLSearchParams({
    topic: category,
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
      const articles = data.articles || [];
      cacheSet(cacheKey, articles);
      showApiSuccess(articles, 'Activa');
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      showApiError(err);
    });
}

function loadAll({ force = false } = {}) {
  STATE.category = 'all';
  STATE.searchActive = false;
  updateCategoryLabel('all');
  syncNav();
  hideError();

  const cacheKey = `all:${CONFIG.lang}:${CONFIG.country}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      abortNav();
      showApiSuccess(cached, 'Local');
      return;
    }
  }

  const signal = abortNav();
  showSkeleton();

  const topics = ['technology', 'science'];
  incrementRequestCount(2);
  updateStats();

  const promises = topics.map(topic => {
    const params = new URLSearchParams({
      topic,
      lang: CONFIG.lang,
      country: CONFIG.country,
      max: 6,
    });
    return fetch(`${CONFIG.apiUrl}/top-headlines?${params}`, { signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r.json();
      })
      .then(data => {
        if (data.errors) throw new Error(data.errors[0]?.message || 'Error de API');
        return data.articles || [];
      });
  });

  Promise.allSettled(promises)
    .then(([techRes, sciRes]) => {
      const rejected = [techRes, sciRes].filter(r => r.status === 'rejected');
      if (rejected.some(r => r.reason?.name === 'AbortError')) return;
      if (rejected.length === 2) throw rejected[0].reason;

      const techArts = techRes.status === 'fulfilled'
        ? techRes.value.map(a => ({ ...a, _cat: 'Tecnología' }))
        : [];
      const sciArts = sciRes.status === 'fulfilled'
        ? sciRes.value.map(a => ({ ...a, _cat: 'Ciencia' }))
        : [];

      const articles = interleave(techArts, sciArts);
      cacheSet(cacheKey, articles);
      showApiSuccess(articles, rejected.length ? 'Parcial' : 'Activa');
    })
    .catch(err => {
      if (err?.name === 'AbortError') return;
      showApiError(err);
    });
}

let searchAbortController = null;

function searchNews(query, { force = false } = {}) {
  STATE.searchActive = true;
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

function renderArticles(articles) {
  hideSkeleton();

  if (!articles || articles.length === 0) {
    DOM.newsGrid.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon"><i class="fas fa-search"></i></div>
        <div class="no-results-text">No se encontraron artículos</div>
      </div>`;
    DOM.resultCount.textContent = '0 artículos';
    DOM.articleCount.textContent = '0';
    return;
  }

  DOM.newsGrid.innerHTML = articles.map((a, i) => {
    const title = a.title || 'Sin título';
    const desc = a.description || 'Sin descripción disponible';
    const image = a.image || '';
    const source = a.source?.name || a.source?.title || 'Fuente desconocida';
    const date = a.publishedAt ? formatDate(a.publishedAt) : '';
    const url = a.url || '#';
    const category = a._cat || '';

    return `
      <a class="news-card" style="animation-delay:${i * 0.04}s" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        <img class="news-card-image" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22340%22 height=%22180%22><rect fill=%22%2321262d%22 width=%22340%22 height=%22180%22/><text fill=%22%236e7681%22 x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dy=%22.3em%22 font-family=%22monospace%22>No Image</text></svg>'">
        <div class="news-card-body">
          <div class="news-card-source">
            <span class="source-dot"></span>
            ${category ? `<span style="color:var(--accent-orange)">${category}</span> · ` : ''}
            ${escapeHtml(source)}
          </div>
          <h2 class="news-card-title">${escapeHtml(title)}</h2>
          <p class="news-card-desc">${escapeHtml(desc)}</p>
          <div class="news-card-footer">
            <span class="news-card-date"><i class="far fa-clock"></i> ${date}</span>
            <span class="news-card-open"><i class="fas fa-external-link-alt"></i> Abrir →</span>
          </div>
        </div>
      </a>`;
  }).join('');

  DOM.resultCount.textContent = `${articles.length} artículos`;
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

function updateClock() {
  const now = new Date();
  DOM.sbTime.innerHTML = `<i class="far fa-clock"></i> ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
}

document.addEventListener('DOMContentLoaded', init);
