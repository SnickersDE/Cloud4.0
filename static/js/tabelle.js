/* ═══════════════════════════════════════
   TABELLE.JS — Live OpenLigaDB Widget
═══════════════════════════════════════ */

const API = 'https://api.openligadb.de';
let currentLiga = 'bl1';

/* ── Init on page load ── */
window.addEventListener('DOMContentLoaded', () => {
  // Liga aus URL-Param lesen
  const params = new URLSearchParams(window.location.search);
  const ligaParam = params.get('liga');
  if (ligaParam === 'bl2') {
    currentLiga = 'bl2';
    document.getElementById('tab-bl1').classList.remove('active');
    document.getElementById('tab-bl2').classList.add('active');
  }
  loadLiga(currentLiga);
  // Auto-refresh alle 90 Sekunden
  setInterval(() => loadLiga(currentLiga), 90000);
});

function switchLiga(liga) {
  currentLiga = liga;
  document.getElementById('tab-bl1').classList.toggle('active', liga === 'bl1');
  document.getElementById('tab-bl2').classList.toggle('active', liga === 'bl2');
  // URL-Param aktualisieren
  const url = new URL(window.location);
  url.searchParams.set('liga', liga);
  window.history.replaceState({}, '', url);
  loadLiga(liga);
}

async function loadLiga(liga) {
  showSkeleton();
  try {
    const [tableData, matchData] = await Promise.all([
      fetchJSON(`${API}/getbltable/${liga}/2024`),
      fetchJSON(`${API}/getmatchdata/${liga}`)
    ]);
    renderTable(tableData, liga);
    renderMatches(matchData);
    const now = new Date();
    document.getElementById('lastUpdate').textContent =
      'Aktualisiert: ' + now.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }) + ' Uhr';
  } catch (err) {
    showError(err);
  }
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function showSkeleton() {
  document.getElementById('matchesGrid').innerHTML =
    Array(6).fill('<div class="skel-match shimmer"></div>').join('');
  document.getElementById('standingsBody').innerHTML =
    Array(18).fill('<tr><td colspan="10"><div class="skel-row shimmer" style="margin:0;"></div></td></tr>').join('');
  document.getElementById('matchdayTitle').textContent = 'Lade…';
}

function showError(err) {
  document.getElementById('standingsBody').innerHTML = `
    <tr><td colspan="10">
      <div class="api-error">
        <strong>Daten nicht verfügbar</strong>
        OpenLigaDB konnte nicht erreicht werden.<br>
        <small style="margin-top:8px;display:block;opacity:.6;">${err.message}</small>
      </div>
    </td></tr>`;
  document.getElementById('matchesGrid').innerHTML =
    '<div style="padding:20px;font-family:\'Barlow Condensed\',sans-serif;color:var(--mid);grid-column:1/-1;">Spieltag nicht verfügbar.</div>';
  document.getElementById('matchdayTitle').textContent = '—';
}

/* ── TABELLE rendern ── */
function renderTable(data, liga) {
  const isFirst = liga === 'bl1';

  function zoneClass(pos) {
    if (isFirst) {
      if (pos <= 4)  return 'zone-cl';
      if (pos === 5) return 'zone-el';
      if (pos === 6) return 'zone-ecl';
      if (pos >= 16) return 'zone-rel';
    } else {
      if (pos <= 2)  return 'zone-cl';
      if (pos === 3) return 'zone-el';
      if (pos >= 16) return 'zone-rel';
    }
    return 'zone-none';
  }

  function zoneTitle(pos) {
    if (isFirst) {
      if (pos <= 4)  return 'Champions League';
      if (pos === 5) return 'Europa League';
      if (pos === 6) return 'Conference League';
      if (pos === 16) return 'Relegation Playoff';
      if (pos >= 17) return 'Direktabstieg';
    } else {
      if (pos <= 2)  return 'Direktaufstieg';
      if (pos === 3) return 'Aufstiegs-Playoff';
      if (pos === 16) return 'Abstiegs-Playoff';
      if (pos >= 17) return 'Direktabstieg';
    }
    return '';
  }

  const rows = (data || []).map((team, i) => {
    const pos  = i + 1;
    const diff = (team.goals || 0) - (team.opponentGoals || 0);
    const diffStr   = diff > 0 ? '+' + diff : String(diff);
    const diffColor = diff > 0 ? '#009944' : diff < 0 ? 'var(--red)' : 'var(--mid)';

    const logoUrl  = team.teamIconUrl || '';
    const shortN   = (team.shortName  || '').substring(0, 3).toUpperCase();
    const logoHtml = logoUrl
      ? `<img class="team-logo-img" src="${logoUrl}" alt="${shortN}"
             onerror="this.style.display='none';this.nextSibling.style.display='flex'">
         <div class="team-logo-ph" style="display:none;">${shortN}</div>`
      : `<div class="team-logo-ph">${shortN}</div>`;

    // Dummy form dots (echte Form bräuchte weitere API-Aufrufe)
    const formPool = ['fw','fw','fd','fl','fw','fw','fl'];
    const formDots = formPool.slice(0, 5)
      .map(c => `<div class="fdot ${c}"></div>`).join('');

    return `
      <tr title="${zoneTitle(pos)}">
        <td class="num">
          <div class="rank-cell">
            <div class="rank-zone ${zoneClass(pos)}"></div>
            <span class="rank-num">${pos}</span>
          </div>
        </td>
        <td>
          <div class="team-cell">
            ${logoHtml}
            <span class="team-fullname">${team.teamName || team.shortName || '—'}</span>
          </div>
        </td>
        <td class="num">${team.matches        || 0}</td>
        <td class="num">${team.won            || 0}</td>
        <td class="num">${team.draw           || 0}</td>
        <td class="num">${team.lost           || 0}</td>
        <td class="num">${team.goals || 0}:${team.opponentGoals || 0}</td>
        <td class="num" style="color:${diffColor};font-weight:800;">${diffStr}</td>
        <td class="num"><span class="pts-cell">${team.points || 0}</span></td>
        <td><div class="form-dots">${formDots}</div></td>
      </tr>`;
  }).join('');

  document.getElementById('standingsBody').innerHTML = rows ||
    '<tr><td colspan="10" style="padding:24px;text-align:center;color:var(--mid);">Keine Tabellendaten</td></tr>';
}

/* ── SPIELTAG rendern ── */
function renderMatches(data) {
  if (!data || data.length === 0) {
    document.getElementById('matchesGrid').innerHTML =
      '<div style="padding:20px;font-family:\'Barlow Condensed\',sans-serif;color:var(--mid);grid-column:1/-1;">Keine Spieldaten.</div>';
    document.getElementById('matchdayTitle').textContent = '—';
    return;
  }

  const first = data[0];
  document.getElementById('matchdayTitle').textContent =
    first?.group?.groupName || `${first?.group?.groupOrderID || ''}. Spieltag`;

  const chips = data.map(match => {
    const t1 = match.team1?.shortName || match.team1?.teamName || '—';
    const t2 = match.team2?.shortName || match.team2?.teamName || '—';
    const results = match.matchResults || [];
    const final = results.find(r => r.resultTypeID === 2) || results[results.length - 1];
    const s1 = final?.pointsTeam1 ?? null;
    const s2 = final?.pointsTeam2 ?? null;
    const hasScore  = s1 !== null && s2 !== null;
    const isFinished = match.matchIsFinished;
    const isLive    = !isFinished && hasScore;

    let scoreHtml, statusHtml;
    if (isFinished) {
      scoreHtml  = `<div class="match-score-big">${s1}:${s2}</div>`;
      statusHtml = `<div class="match-status done">Abgepfiffen</div>`;
    } else if (isLive) {
      scoreHtml  = `<div class="match-score-big live">${s1}:${s2}</div>`;
      statusHtml = `<div class="match-status live">● Live</div>`;
    } else {
      const dt = match.matchDateTime ? new Date(match.matchDateTime) : null;
      const timeStr = dt
        ? dt.toLocaleString('de-DE', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '—';
      scoreHtml  = `<div class="match-score-big" style="font-size:14px;color:var(--mid);">vs.</div>`;
      statusHtml = `<div class="match-status sched">${timeStr}</div>`;
    }

    return `
      <div class="match-chip">
        <div class="match-teams">
          <div class="match-home"><span>${t1}</span></div>
          <div class="match-away"><span>${t2}</span></div>
          ${statusHtml}
        </div>
        ${scoreHtml}
      </div>`;
  }).join('');

  document.getElementById('matchesGrid').innerHTML = chips;
}
