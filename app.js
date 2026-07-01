const CONFIG = {
  apiKey: '4db32ab0a906a065b648342044542ee5',
  apiUrl: 'https://gnews.io/api/v4',
  maxResults: 12,
  lang: 'es',
  country: 'mx',
};

const STATE = {
  category: 'technology',
  articles: [],
  view: 'grid',
  requestCount: 0,
  cacheStatus: '—',
};

const DOM = {};

function init() {
  cacheDom();
  bindEvents();
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
  DOM.sidebarItems = document.querySelectorAll('.sidebar-item');
}

function bindEvents() {
  DOM.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      DOM.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const category = tab.dataset.category;
      if (category !== 'all') {
        loadNews(category);
      } else {
        loadAll();
      }
    });
  });

  DOM.sidebarItems.forEach((item, idx) => {
    item.addEventListener('click', () => {
      DOM.sidebarItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      if (idx === 0) loadNews(STATE.category);
      else if (idx === 1) loadNews('science');
      else if (idx === 2) loadNews('technology');
    });
  });

  DOM.refreshBtn.addEventListener('click', () => {
    if (STATE.category === 'all') loadAll();
    else loadNews(STATE.category);
  });

  DOM.searchInput.addEventListener('input', debounce((e) => {
    const q = e.target.value.trim();
    if (q.length < 2) {
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

function loadNews(category) {
  STATE.category = category;

  const labelMap = {
    technology: 'Tecnología',
    science: 'Ciencia',
  };
  DOM.currentCategoryLabel.textContent = labelMap[category] || category;

  showSkeleton();
  hideError();

  const params = new URLSearchParams({
    topic: category,
    lang: CONFIG.lang,
    country: CONFIG.country,
    max: CONFIG.maxResults,
    apikey: CONFIG.apiKey,
  });

  STATE.requestCount++;
  updateStats();

  fetch(`${CONFIG.apiUrl}/top-headlines?${params}`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r.json();
    })
    .then(data => {
      if (data.errors) throw new Error(data.errors[0]?.message || 'Error de API');
      STATE.articles = data.articles || [];
      STATE.cacheStatus = 'Activa';
      DOM.apiStatus.innerHTML = '<i class="fas fa-check-circle"></i> Online';
      DOM.apiStatus.className = 'stat-value green';
      DOM.sbConnection.innerHTML = '<i class="fas fa-check-circle"></i> Conectado';
      renderArticles(STATE.articles);
      updateStats();
    })
    .catch(err => {
      console.error(err);
      STATE.cacheStatus = 'Fallo';
      DOM.apiStatus.innerHTML = '<i class="fas fa-times-circle"></i> Offline';
      DOM.apiStatus.className = 'stat-value red';
      DOM.sbConnection.innerHTML = '<i class="fas fa-times-circle"></i> Desconectado';
      showError(err.message);
      hideSkeleton();
      updateStats();
    });
}

function loadAll() {
  STATE.category = 'all';
  DOM.currentCategoryLabel.textContent = 'Todas';

  showSkeleton();
  hideError();

  STATE.requestCount++;
  updateStats();

  const topics = ['technology', 'science'];
  const promises = topics.map(topic => {
    const params = new URLSearchParams({
      topic,
      lang: CONFIG.lang,
      country: CONFIG.country,
      max: 6,
      apikey: CONFIG.apiKey,
    });
    return fetch(`${CONFIG.apiUrl}/top-headlines?${params}`).then(r => r.json());
  });

  Promise.all(promises)
    .then(([tech, science]) => {
      const techArts = (tech.articles || []).map(a => ({ ...a, _cat: 'Tecnología' }));
      const sciArts = (science.articles || []).map(a => ({ ...a, _cat: 'Ciencia' }));
      STATE.articles = interleave(techArts, sciArts);
      STATE.cacheStatus = 'Activa';
      DOM.apiStatus.innerHTML = '<i class="fas fa-check-circle"></i> Online';
      DOM.apiStatus.className = 'stat-value green';
      DOM.sbConnection.innerHTML = '<i class="fas fa-check-circle"></i> Conectado';
      renderArticles(STATE.articles);
      updateStats();
    })
    .catch(err => {
      console.error(err);
      STATE.cacheStatus = 'Fallo';
      DOM.apiStatus.innerHTML = '<i class="fas fa-times-circle"></i> Offline';
      DOM.apiStatus.className = 'stat-value red';
      DOM.sbConnection.innerHTML = '<i class="fas fa-times-circle"></i> Desconectado';
      showError(err.message);
      hideSkeleton();
      updateStats();
    });
}

function searchNews(query) {
  showSkeleton();
  hideError();

  const params = new URLSearchParams({
    q: query,
    lang: CONFIG.lang,
    country: CONFIG.country,
    max: CONFIG.maxResults,
    apikey: CONFIG.apiKey,
  });

  STATE.requestCount++;
  updateStats();

  fetch(`${CONFIG.apiUrl}/search?${params}`)
    .then(r => r.json())
    .then(data => {
      if (data.errors) throw new Error(data.errors[0]?.message || 'Error de búsqueda');
      STATE.articles = data.articles || [];
      renderArticles(STATE.articles);
      updateStats();
    })
    .catch(err => {
      showError(err.message);
      hideSkeleton();
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
        <img class="news-card-image" src="${image}" alt="${title}" loading="lazy"
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
  DOM.errorMessage.textContent = `Error: ${msg || 'No se pudieron cargar las noticias. Verifica tu API key en app.js'}`;
  DOM.errorBanner.style.display = 'flex';
}

function hideError() {
  DOM.errorBanner.style.display = 'none';
}

function updateStats() {
  DOM.requestCount.textContent = `${STATE.requestCount}/100`;
  DOM.cacheStatus.textContent = STATE.cacheStatus;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 60) return `${mins}m`;
  if (hrs < 24) return `${hrs}h`;
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function updateClock() {
  const now = new Date();
  DOM.sbTime.innerHTML = `<i class="far fa-clock"></i> ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function interleave(a, b) {
  const result = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (i < a.length) result.push(a[i]);
    if (i < b.length) result.push(b[i]);
  }
  return result;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

document.addEventListener('DOMContentLoaded', init);
