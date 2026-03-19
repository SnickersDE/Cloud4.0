function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function applyFilter(keyword) {
  const normalized = (keyword || '').toLowerCase();
  const items = document.querySelectorAll('.filterable[data-title]');
  let count = 0;
  items.forEach(el => {
    const match = (el.dataset.title || '').toLowerCase().includes(normalized);
    if (match) { el.style.display = ''; count++; }
    else        { el.style.display = 'none'; }
  });

  const bar = document.getElementById('filterBar');
  if (bar) {
    bar.classList.add('active');
    const txt = document.getElementById('filterBarText');
    if (txt) txt.textContent = 'Filter: ' + keyword + ' — ' + count + ' Treffer';
  }

  const noRes = document.getElementById('noResults');
  if (noRes) noRes.style.display = count === 0 ? 'block' : 'none';
}

function clearFilter() {
  document.querySelectorAll('.filterable').forEach(el => el.style.display = '');
  const bar = document.getElementById('filterBar');
  if (bar) bar.classList.remove('active');
  const noRes = document.getElementById('noResults');
  if (noRes) noRes.style.display = 'none';
}
function toggleSearch() {
  const inp = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  if (!inp) return;
  inp.classList.toggle('open');
  if (inp.classList.contains('open')) {
    inp.focus();
    inp.addEventListener('input', onSearchInput);
  } else {
    inp.value = '';
    inp.removeEventListener('input', onSearchInput);
    if (results) {
      results.innerHTML = '';
      results.classList.remove('open');
    }
    clearFilter();
  }
}

function onSearchInput(e) {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    const results = document.getElementById('searchResults');
    if (results) {
      results.innerHTML = '';
      results.classList.remove('open');
    }
    clearFilter();
    return;
  }
  if (window.Cloud4 && typeof window.Cloud4.search === 'function') {
    window.Cloud4.search(q, e.target.value);
  } else {
    applyFilter(q);
    renderGlobalSearch(q);
  }
}

function renderGlobalSearch(query) {
  const box = document.getElementById('searchResults');
  if (!box) return;
  const index = (window.Cloud4 && Array.isArray(window.Cloud4.cachedSearchResults))
    ? window.Cloud4.cachedSearchResults
    : [];
  if (!index.length || query.length < 2) {
    box.innerHTML = '';
    box.classList.remove('open');
    return;
  }
  const terms = query.split(/\s+/).filter(Boolean);
  const hits = index
    .map(item => {
      const haystack = `${item.title || ''} ${item.teaser || ''} ${(item.search_words || []).join(' ')}`.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
      return { item, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (!hits.length) {
    box.innerHTML = '<div class="search-hit"><div class="search-hit-title">Keine Treffer</div></div>';
    box.classList.add('open');
    return;
  }

  box.innerHTML = hits.map(({ item }) => {
    const title = escapeHtml(item.title || 'Mitschrift');
    const meta = escapeHtml(`${item.category || 'Modul'} · ${new Date(item.created_at || item.updated_at || Date.now()).toLocaleDateString('de-DE')}`);
    return `<a class="search-hit" href="${(window.__SITE_ROOT__ || '/') + 'mitschrift/?id=' + encodeURIComponent(item.id)}"><div class="search-hit-title">${title}</div><div class="search-hit-meta">${meta}</div></a>`;
  }).join('');
  box.classList.add('open');
}
function toggleMenu() {
  const burger = document.getElementById('hamburger');
  const menu   = document.getElementById('mobileMenu');
  if (burger) burger.classList.toggle('open');
  if (menu)   menu.classList.toggle('open');
}
window.addEventListener('scroll', () => {
  const s = window.scrollY;
  const d = document.body.scrollHeight - window.innerHeight;
  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.width = (d > 0 ? (s / d) * 100 : 0) + '%';
  const nav = document.getElementById('mainNav');
  if (nav) nav.classList.toggle('scrolled', s > 60);
  const btn = document.getElementById('back-top');
  if (btn) btn.classList.toggle('visible', d > 0 && s >= (d - 24));
});
function copyLink(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  try { navigator.clipboard.writeText(window.location.href); } catch(err) {}
  const orig = btn.textContent;
  btn.textContent = '✓ Kopiert!';
  btn.style.background = '#009944';
  setTimeout(() => {
    btn.textContent = orig;
    btn.style.background = '';
  }, 2000);
}

function loadTicker() {
  const track = document.getElementById('liveTickerTrack');
  if (!track) return;
  const lines = (window.Cloud4 && typeof window.Cloud4.getTickerLines === 'function')
    ? window.Cloud4.getTickerLines()
    : ['Cloud4.0 verbunden', 'Mitschriften laden', 'Suche aktiv'];
  const doubled = [...lines, ...lines];
  track.innerHTML = doubled.map(line => `<span>${escapeHtml(line)}</span>`).join('');
}

function loadScoreChips() {
  const track = document.getElementById('scoresTrack');
  if (!track) return;
  const chips = (window.Cloud4 && typeof window.Cloud4.getScoreChips === 'function')
    ? window.Cloud4.getScoreChips()
    : [
        '<div class="score-chip"><div class="score-teams">Mitschriften: 0</div></div>',
        '<div class="score-chip"><div class="score-teams">Decks: 0</div></div>'
      ];
  const safe = chips.length ? chips : ['<div class="score-chip"><div class="score-teams">Keine Daten</div></div>'];
  track.innerHTML = [...safe, ...safe].join('');
}

window.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('headerDate');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleDateString('de-DE', {
      weekday:'short', day:'numeric', month:'long', year:'numeric'
    });
  }
  loadTicker();
  loadScoreChips();
  setInterval(loadTicker, 60000);
  setInterval(loadScoreChips, 60000);
});
