/* ═══════════════════════════════════════
   MAIN.JS — ZEIT DAS SICH WAS DREHT
   Alle interaktiven Funktionen
═══════════════════════════════════════ */

/* ── Datum im Header ── */
(function() {
  const el = document.getElementById('headerDate');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleDateString('de-DE', {
      weekday:'short', day:'numeric', month:'long', year:'numeric'
    });
  }
})();

/* ── LIGA FILTER (nur auf Homepage) ── */
(function() {
  const params = new URLSearchParams(window.location.search);
  const liga = params.get('liga');
  if (!liga) return;

  const map = { '1bl': '1. Bundesliga', '2bl': '2. Bundesliga' };
  const ligaName = map[liga];
  if (!ligaName) return;

  // Warte bis DOM fertig
  window.addEventListener('DOMContentLoaded', () => {
    applyFilter(ligaName);
  });
})();

function applyFilter(ligaName) {
  const items = document.querySelectorAll('.filterable[data-league]');
  let count = 0;
  items.forEach(el => {
    const match =
      (el.dataset.title  || '').toLowerCase().includes(ligaName.toLowerCase()) ||
      (el.dataset.league || '').toLowerCase().includes(ligaName.toLowerCase());
    if (match) { el.style.display = ''; count++; }
    else        { el.style.display = 'none'; }
  });

  const bar = document.getElementById('filterBar');
  if (bar) {
    bar.classList.add('active');
    const txt = document.getElementById('filterBarText');
    if (txt) txt.textContent = 'Filter: ' + ligaName + ' — ' + count + ' Artikel';
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

  // URL-Parameter entfernen ohne Seiten-Reload
  const url = new URL(window.location);
  url.searchParams.delete('liga');
  window.history.replaceState({}, '', url);
}

/* ── SEARCH ── */
function toggleSearch() {
  const inp = document.getElementById('searchInput');
  if (!inp) return;
  inp.classList.toggle('open');
  if (inp.classList.contains('open')) {
    inp.focus();
    inp.addEventListener('input', onSearchInput);
  } else {
    inp.value = '';
    inp.removeEventListener('input', onSearchInput);
    clearFilter();
  }
}

function onSearchInput(e) {
  const q = e.target.value.toLowerCase().trim();
  if (!q) { clearFilter(); return; }

  const items = document.querySelectorAll('.filterable[data-league]');
  let count = 0;
  items.forEach(el => {
    const match = (el.dataset.title || '').toLowerCase().includes(q);
    if (match) { el.style.display = ''; count++; }
    else        { el.style.display = 'none'; }
  });

  const bar = document.getElementById('filterBar');
  if (bar) {
    bar.classList.add('active');
    const txt = document.getElementById('filterBarText');
    if (txt) txt.textContent = 'Suche: "' + e.target.value + '" — ' + count + ' Treffer';
  }
  const noRes = document.getElementById('noResults');
  if (noRes) noRes.style.display = count === 0 ? 'block' : 'none';
}

/* ── DARK MODE ── */
function toggleTheme() {
  const html = document.documentElement;
  const btn  = document.getElementById('themeBtn');
  const isDark = html.dataset.theme === 'dark';
  html.dataset.theme = isDark ? 'light' : 'dark';
  if (btn) btn.textContent = isDark ? '🌙 Dark' : '☀️ Hell';
  localStorage.setItem('zdswt-theme', isDark ? 'light' : 'dark');
}

// Theme aus localStorage wiederherstellen
(function() {
  const saved = localStorage.getItem('zdswt-theme');
  if (saved) {
    document.documentElement.dataset.theme = saved;
    window.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('themeBtn');
      if (btn) btn.textContent = saved === 'dark' ? '☀️ Hell' : '🌙 Dark';
    });
  }
})();

/* ── MOBILE MENU ── */
function toggleMenu() {
  const burger = document.getElementById('hamburger');
  const menu   = document.getElementById('mobileMenu');
  if (burger) burger.classList.toggle('open');
  if (menu)   menu.classList.toggle('open');
}

/* ── SCROLL EFFECTS ── */
window.addEventListener('scroll', () => {
  const s = window.scrollY;
  const d = document.body.scrollHeight - window.innerHeight;

  // Progress bar
  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.width = (d > 0 ? (s / d) * 100 : 0) + '%';

  // Nav shadow
  const nav = document.getElementById('mainNav');
  if (nav) nav.classList.toggle('scrolled', s > 60);

  // Back to top
  const btn = document.getElementById('back-top');
  if (btn) btn.classList.toggle('visible', s > 400);
});

/* ── COPY LINK ── */
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

/* ── TRENDING COUNTER ANIMATION ── */
function animateCounts() {
  document.querySelectorAll('.trend-count span').forEach(el => {
    const raw    = el.textContent.replace('k', '').trim();
    const target = parseFloat(raw) * 1000;
    if (isNaN(target)) return;
    let cur = 0;
    const step = target / 40;
    const t = setInterval(() => {
      cur = Math.min(cur + step, target);
      el.textContent = cur >= 1000
        ? (cur / 1000).toFixed(1) + 'k'
        : Math.round(cur);
      if (cur >= target) clearInterval(t);
    }, 28);
  });
}
window.addEventListener('DOMContentLoaded', () => setTimeout(animateCounts, 800));
