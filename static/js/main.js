/* ═══════════════════════════════════════
   MAIN.JS — FussballGenie.de
   Alle interaktiven Funktionen
════════════════════════════════════════ */

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

const LIVE_API = 'https://api.openligadb.de';

window.addEventListener('DOMContentLoaded', () => {
  loadLiveTicker();
  setInterval(loadLiveTicker, 60000);
});

async function loadLiveTicker() {
  const track = document.getElementById('liveTickerTrack');
  const label = document.getElementById('tickerLabel');
  if (!track) return;

  try {
    const [bl1, bl2] = await Promise.all([
      fetch(`${LIVE_API}/getmatchdata/bl1`).then(r => r.ok ? r.json() : []),
      fetch(`${LIVE_API}/getmatchdata/bl2`).then(r => r.ok ? r.json() : [])
    ]);

    const lines = [
      ...buildTickerLines(bl1, '1.BL'),
      ...buildTickerLines(bl2, '2.BL')
    ].slice(0, 12);

    const safeLines = lines.length ? lines : ['Aktuell keine Live-Spiele verfügbar'];
    const doubled = [...safeLines, ...safeLines];
    track.innerHTML = doubled.map(line => `<span>${escapeHtml(line)}</span>`).join('');
    if (label) label.textContent = 'Live';
  } catch (error) {
    track.innerHTML = '<span>Live-Daten derzeit nicht verfügbar</span><span>Live-Daten derzeit nicht verfügbar</span>';
    if (label) label.textContent = 'Live';
  }
}

function buildTickerLines(matches, badge) {
  return (matches || []).slice(0, 8).map(match => {
    const t1 = match.team1?.shortName || match.team1?.teamName || 'Team 1';
    const t2 = match.team2?.shortName || match.team2?.teamName || 'Team 2';
    const result = getResult(match);
    const isLive = result && !match.matchIsFinished;
    const isDone = !!match.matchIsFinished;
    const when = match.matchDateTime ? new Date(match.matchDateTime) : null;
    const timeText = when ? when.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }) : '--:--';

    if (isDone) {
      return `${badge} ${t1} ${result} ${t2} — Abpfiff`;
    }
    if (isLive) {
      return `${badge} ${t1} ${result} ${t2} — Live`;
    }
    return `${badge} ${t1} vs ${t2} — ${timeText}`;
  });
}

function getResult(match) {
  const results = match?.matchResults || [];
  if (!results.length) return '';
  const finalResult = results.find(r => r.resultTypeID === 2) || results[results.length - 1];
  const p1 = finalResult?.pointsTeam1;
  const p2 = finalResult?.pointsTeam2;
  if (typeof p1 !== 'number' || typeof p2 !== 'number') return '';
  return `${p1}:${p2}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

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
