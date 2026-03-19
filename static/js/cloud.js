const Cloud4 = (() => {
  let supabaseClient = null;
  let currentUser = null;
  let currentDisplayName = '';
  let currentRole = 'guest';
  let metrics = { notes: 0, modules: 0, decks: 0, quizzes: 0 };
  let cachedSearchResults = [];
  let adminNotesCache = [];
  let adminWordsByNote = new Map();
  let adminPage = 1;
  const adminPageSize = 10;
  let authSubscription = null;
  const runtimeLogs = [];

  const rootPath = () => window.__SITE_ROOT__ || '/';
  const byId = (id) => document.getElementById(id);
  const toText = (value) => String(value || '');
  const esc = (value) => toText(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const dateLabel = (value) => new Date(value || Date.now()).toLocaleDateString('de-DE');
  const isConfigured = () => Boolean((window.__SUPABASE_URL__ || '').trim() && (window.__SUPABASE_ANON_KEY__ || '').trim());
  const setText = (id, text) => {
    const el = byId(id);
    if (el) el.textContent = text;
  };
  const setBusy = (btn, busyText) => {
    if (!btn) return () => {};
    const original = btn.dataset.originalLabel || btn.textContent || '';
    btn.dataset.originalLabel = original;
    btn.textContent = busyText;
    btn.disabled = true;
    return () => {
      btn.textContent = original;
      btn.disabled = false;
    };
  };
  const writeDebugLog = (line) => {
    const box = byId('authDebugLog');
    if (!box) return;
    runtimeLogs.push(line);
    const clipped = runtimeLogs.slice(-80);
    box.textContent = clipped.join('\n');
  };
  const logEvent = (level, message, meta) => {
    const ts = new Date().toISOString().slice(11, 19);
    const payload = meta ? ` | ${toText(meta)}` : '';
    const line = `[${ts}] [${level}] ${message}${payload}`;
    writeDebugLog(line);
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
  };
  const installRuntimeErrorHandlers = () => {
    window.addEventListener('error', (event) => {
      logEvent('ERROR', 'window.error', event.message || 'Unbekannter Fehler');
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason?.message || event.reason || 'Promise rejection';
      logEvent('ERROR', 'unhandledrejection', toText(reason));
    });
  };

  function createSupabase() {
    if (supabaseClient) return supabaseClient;
    if (!window.supabase) return null;
    const url = (window.__SUPABASE_URL__ || '').trim();
    const key = (window.__SUPABASE_ANON_KEY__ || '').trim();
    if (!url || !key) return null;
    logEvent('INFO', 'Supabase Client wird initialisiert', `url=${url} keyLength=${key.length}`);
    supabaseClient = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      }
    });
    return supabaseClient;
  }

  async function ensureSupabaseClient(maxWaitMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const client = createSupabase();
      if (client) return client;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    logEvent('ERROR', 'Supabase Client konnte nicht initialisiert werden');
    return null;
  }

  function normalizeSupabaseError(error) {
    if (!error) return 'Unbekannter Fehler';
    const msg = toText(error.message || error.error_description || error.hint || error.details);
    if (!msg) return 'Unbekannter Fehler';
    if (msg.toLowerCase().includes('invalid login credentials')) return 'Ungültige E-Mail oder Passwort.';
    if (msg.toLowerCase().includes('email not confirmed')) return 'E-Mail ist noch nicht bestätigt.';
    if (msg.toLowerCase().includes('network')) return 'Netzwerkfehler. Bitte Verbindung prüfen.';
    if (msg.toLowerCase().includes('aborted')) return 'Anfrage abgebrochen. Seite neu laden und erneut versuchen.';
    return msg;
  }

  const isAuthenticatedUser = () => Boolean(currentUser?.id);
  const ensureWriteAccess = async (statusElementId, message = 'Bitte anmelden, um Inhalte zu bearbeiten.') => {
    if (!isAuthenticatedUser()) {
      const client = createSupabase();
      if (client) {
        const { data } = await client.auth.getUser();
        currentUser = data?.user || null;
      }
    }
    if (isAuthenticatedUser()) return true;
    setText(statusElementId, message);
    logEvent('WARN', 'Write action blocked (not authenticated)');
    return false;
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const withRetry = async (fn, retries = 2, label = 'query') => {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        logEvent('WARN', `${label} attempt failed`, `${attempt + 1}/${retries + 1} ${normalizeSupabaseError(error)}`);
        if (attempt < retries) await sleep(220 * (attempt + 1));
      }
    }
    throw lastError;
  };

  function bindAuthListener() {
    const client = createSupabase();
    if (!client || authSubscription) return;
    const { data } = client.auth.onAuthStateChange(async (event, session) => {
      logEvent('INFO', 'Auth State Change', `${event} user=${session?.user?.email || 'none'}`);
      await loadAuthState();
      await loadMetrics();
      await renderKonto();
      if (byId('adminStatus') && currentRole === 'admin') {
        await renderAdminNotes(true);
        await renderAdminWords();
      }
    });
    authSubscription = data?.subscription || null;
  }

  async function loadAuthState() {
    const client = createSupabase();
    if (!client) return;
    const { data } = await client.auth.getUser();
    currentUser = data?.user || null;
    if (!currentUser) {
      currentRole = 'guest';
      currentDisplayName = '';
      updateAuthNavigation();
      refreshHud();
      return;
    }
    const { data: profile } = await client
      .from('profiles')
      .select('username,full_name')
      .eq('id', currentUser.id)
      .maybeSingle();
    const { data: roleRows } = await client
      .from('user_roles')
      .select('role')
      .eq('user_id', currentUser.id)
      .limit(1);
    currentRole = roleRows?.[0]?.role || 'authenticated';
    currentDisplayName = profile?.full_name || profile?.username || currentUser.email || 'User';
    updateAuthNavigation();
    refreshHud();
    logEvent('INFO', 'Auth state loaded', `role=${currentRole} user=${currentDisplayName}`);
  }

  async function loadMetrics() {
    const client = createSupabase();
    if (!client) return;
    const fetchCount = async (table) => {
      const { count, error } = await withRetry(
        () => client.from(table).select('id', { count: 'exact' }).limit(1),
        1,
        `count:${table}`
      );
      if (error) throw error;
      return count || 0;
    };
    try {
      metrics.notes = await fetchCount('notes');
      metrics.modules = await fetchCount('modules');
      metrics.decks = await fetchCount('decks');
      metrics.quizzes = await fetchCount('quizzes');
    } catch (error) {
      logEvent('WARN', 'Metrics konnten nicht vollständig geladen werden', normalizeSupabaseError(error));
    }
  }

  function getTickerLines() {
    return [
      `Mitschriften aktiv: ${metrics.notes}`,
      `Module geladen: ${metrics.modules}`,
      `Decks verfügbar: ${metrics.decks}`,
      `Quiz-Sets online: ${metrics.quizzes}`,
      currentUser ? `Eingeloggt als: ${currentDisplayName} (${currentRole})` : 'Nicht eingeloggt'
    ];
  }

  function updateAuthNavigation() {
    const guestNodes = document.querySelectorAll('.guest-only-link');
    guestNodes.forEach((node) => {
      node.style.display = currentUser ? 'none' : '';
    });
    const authNodes = document.querySelectorAll('.auth-only-link');
    authNodes.forEach((node) => {
      node.style.display = currentUser ? '' : 'none';
    });
  }

  function refreshHud() {
    if (typeof window.loadTicker === 'function') window.loadTicker();
    if (typeof window.loadScoreChips === 'function') window.loadScoreChips();
  }

  function bindGlobalLogout() {
    const client = createSupabase();
    if (!client) return;
    const handler = async (event) => {
      event.preventDefault();
      const { error } = await client.auth.signOut();
      if (error) {
        logEvent('ERROR', 'Global logout failed', normalizeSupabaseError(error));
        return;
      }
      await loadAuthState();
      await loadMetrics();
      refreshHud();
      window.location.href = `${rootPath()}`;
    };
    const navLogout = byId('navLogoutLink');
    const mobileLogout = byId('mobileLogoutLink');
    if (navLogout && !navLogout.dataset.bound) {
      navLogout.dataset.bound = '1';
      navLogout.addEventListener('click', handler);
    }
    if (mobileLogout && !mobileLogout.dataset.bound) {
      mobileLogout.dataset.bound = '1';
      mobileLogout.addEventListener('click', handler);
    }
  }

  function getScoreChips() {
    return [
      `<div class="score-chip"><div class="score-teams">Mitschriften</div><div class="score-result">${metrics.notes}</div><div class="score-min">Cloud</div></div>`,
      `<div class="score-chip"><div class="score-teams">Module</div><div class="score-result">${metrics.modules}</div><div class="score-min">Cloud</div></div>`,
      `<div class="score-chip"><div class="score-teams">Karteikarten-Decks</div><div class="score-result">${metrics.decks}</div><div class="score-min">Cloud</div></div>`,
      `<div class="score-chip"><div class="score-teams">Quiz-Sets</div><div class="score-result">${metrics.quizzes}</div><div class="score-min">Cloud</div></div>`
    ];
  }

  async function loadSearchCache() {
    const client = createSupabase();
    if (!client) return;
    const { data: notes } = await client
      .from('notes')
      .select('id,title,teaser,category,body,image_path,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(300);
    const { data: words } = await client
      .from('search_words')
      .select('note_id,word');
    const wordMap = new Map();
    (words || []).forEach((row) => {
      const list = wordMap.get(row.note_id) || [];
      list.push(row.word);
      wordMap.set(row.note_id, list);
    });
    cachedSearchResults = (notes || []).map((note) => ({
      ...note,
      search_words: wordMap.get(note.id) || []
    }));
  }

  function insertHomeCards(notes) {
    const grid = byId('articleGrid');
    if (!grid) return;
    const sidebar = grid.querySelector('.sidebar-stack');
    grid.querySelectorAll('.card.filterable').forEach((el) => el.remove());
    notes.forEach((note) => {
      const card = document.createElement('div');
      card.className = 'card filterable';
      card.dataset.title = `${toText(note.category).toLowerCase()} ${toText(note.title).toLowerCase()} ${toText(note.teaser).toLowerCase()}`;
      card.dataset.noteId = note.id;
      card.onclick = () => { window.location.href = `${rootPath()}mitschrift/?id=${encodeURIComponent(note.id)}`; };
      card.innerHTML = `
        <button class="card-share" onclick="copyLink(event)">Link kopieren</button>
        <div class="card-img-ph shimmer">${note.image_path ? `<img src="${esc(note.image_path)}" alt="${esc(note.title)}">` : ''}</div>
        <div class="card-body">
          <div class="card-cat c-def"><span class="cdot cd-def"></span>${esc(note.category || 'Mitschrift')}</div>
          <div class="card-title">${esc(note.title || 'Ohne Titel')}</div>
          <div class="card-excerpt">${esc(note.teaser || '')}</div>
          <div class="card-foot">
            <div class="card-meta">${dateLabel(note.created_at)}</div>
            <div class="read-time">${Math.max(2, Math.round(toText(note.body).length / 900))} Min.</div>
          </div>
        </div>`;
      if (sidebar) grid.insertBefore(card, sidebar);
      else grid.appendChild(card);
    });
  }

  function renderHomeHero(notes) {
    const hero = notes[0];
    if (!hero) return;
    const titleEl = byId('heroMainTitle');
    const teaserEl = byId('heroMainTeaser');
    const categoryEl = byId('heroMainCategory');
    const metaEl = byId('heroMainMeta');
    const imageEl = byId('heroMainImage');
    const heroWrap = byId('heroMainArticle');
    if (titleEl) titleEl.textContent = toText(hero.title);
    if (teaserEl) teaserEl.textContent = toText(hero.teaser);
    if (categoryEl) categoryEl.textContent = toText(hero.category || 'Mitschrift');
    if (metaEl) metaEl.textContent = `Aktualisiert ${dateLabel(hero.updated_at || hero.created_at)}`;
    if (imageEl) imageEl.innerHTML = hero.image_path ? `<img src="${esc(hero.image_path)}" alt="${esc(hero.title)}">` : '';
    if (heroWrap) {
      heroWrap.dataset.title = `${toText(hero.category).toLowerCase()} ${toText(hero.title).toLowerCase()} ${toText(hero.teaser).toLowerCase()}`;
      heroWrap.onclick = () => { window.location.href = `${rootPath()}mitschrift/?id=${encodeURIComponent(hero.id)}`; };
    }
    const sidebar = byId('heroSidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '';
    notes.slice(1, 6).forEach((note) => {
      const node = document.createElement('div');
      node.className = 'hero-side-item filterable';
      node.dataset.title = `${toText(note.category).toLowerCase()} ${toText(note.title).toLowerCase()} ${toText(note.teaser).toLowerCase()}`;
      node.onclick = () => { window.location.href = `${rootPath()}mitschrift/?id=${encodeURIComponent(note.id)}`; };
      node.innerHTML = `
        <div class="side-thumb-ph shimmer">${note.image_path ? `<img src="${esc(note.image_path)}" alt="${esc(note.title)}">` : ''}</div>
        <div>
          <div class="side-cat">${esc(note.category || 'Mitschrift')}</div>
          <div class="side-title">${esc(note.title || 'Ohne Titel')}</div>
          <div class="side-date">${dateLabel(note.created_at)}</div>
        </div>`;
      sidebar.appendChild(node);
    });
  }

  async function renderHome() {
    const client = createSupabase();
    if (!client || !byId('articleGrid')) return;
    const { data: notes } = await client
      .from('notes')
      .select('id,title,teaser,category,body,image_path,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(18);
    const list = notes || [];
    renderHomeHero(list);
    insertHomeCards(list);
  }

  function cardHtml(title, subtitle, link) {
    return `<div class="card" onclick="window.location.href='${esc(link)}'"><div class="card-body"><div class="card-title">${esc(title)}</div><div class="card-excerpt">${esc(subtitle || '')}</div></div></div>`;
  }

  function resolveCollectionLink(tableName, row) {
    if (row?.url) return row.url;
    if (row?.slug) return `${rootPath()}${tableName}/?slug=${encodeURIComponent(row.slug)}`;
    if (!row?.id) return '#';
    if (tableName === 'modules') return `${rootPath()}zusammenfassungen/?id=${encodeURIComponent(row.id)}`;
    if (tableName === 'decks') return `${rootPath()}karteikarten/?id=${encodeURIComponent(row.id)}`;
    if (tableName === 'quizzes') return `${rootPath()}quiz/?id=${encodeURIComponent(row.id)}`;
    if (tableName === 'documents') return `${rootPath()}ai-mode/?id=${encodeURIComponent(row.id)}`;
    return '#';
  }

  function moduleSectionBlueprint() {
    return [
      { type: 'anfang', title: 'Anfang' },
      { type: 'hauptteil', title: 'Hauptteil' },
      { type: 'schluss', title: 'Schluss' }
    ];
  }

  async function ensureModuleCoreSections(client, moduleId, fallbackText = '') {
    const { data: existing } = await client
      .from('module_sections')
      .select('id,module_id,type,title,content,created_at,updated_at')
      .eq('module_id', moduleId);
    const existingMap = new Map((existing || []).map((row) => [row.type, row]));
    const missingRows = moduleSectionBlueprint()
      .filter((entry) => !existingMap.has(entry.type))
      .map((entry) => ({
        module_id: moduleId,
        type: entry.type,
        title: entry.title,
        content: entry.type === 'anfang' ? fallbackText : ''
      }));
    if (missingRows.length) {
      const { error } = await client.from('module_sections').insert(missingRows);
      if (error) {
        logEvent('WARN', 'Module sections bootstrap failed', normalizeSupabaseError(error));
      }
    }
    const { data: rows } = await client
      .from('module_sections')
      .select('id,module_id,type,title,content,created_at,updated_at')
      .eq('module_id', moduleId);
    const ordered = moduleSectionBlueprint().map((entry) => (rows || []).find((row) => row.type === entry.type)).filter(Boolean);
    return ordered;
  }

  async function renderSpiele() {
    const grid = byId('spieleGrid');
    if (!grid) return;
    const items = [
      { name: 'Typing Arena', subtitle: 'Singleplayer', href: `${rootPath()}spiele/#typing-arena` },
      { name: 'Synapse', subtitle: 'Strategic Grid', href: `${rootPath()}spiele/#synapse` },
      { name: 'Realm Builder V5', subtitle: 'Tower Defense', href: `${rootPath()}spiele/#realm-builder-v5` }
    ];
    const sidebar = grid.querySelector('.sidebar-stack');
    items.forEach((game) => {
      const node = document.createElement('div');
      node.innerHTML = cardHtml(game.name, game.subtitle, game.href);
      if (sidebar) grid.insertBefore(node.firstChild, sidebar);
    });
    const hi = byId('spieleHighlights');
    if (hi) {
      hi.innerHTML = items.map((item, idx) => `<div class="hot-side"><div class="hs-num">${String(idx + 1).padStart(2, '0')}</div><div class="hs-title">${esc(item.name)}</div><div class="hs-meta">${esc(item.subtitle)}</div></div>`).join('');
    }
    const client = createSupabase();
    const list = byId('spieleLeaderboard');
    if (!client || !list) return;
    const { data } = await client
      .from('game_leaderboards')
      .select('id,score,game_id,user_id')
      .order('score', { ascending: false })
      .limit(8);
    const userIds = [...new Set((data || []).map((row) => row.user_id).filter(Boolean))];
    let profileMap = new Map();
    if (userIds.length) {
      const { data: profiles } = await client.from('profiles').select('id,username,full_name').in('id', userIds);
      profileMap = new Map((profiles || []).map((row) => [row.id, row]));
    }
    list.innerHTML = (data || []).map((row, idx) => {
      const profile = profileMap.get(row.user_id);
      const name = profile?.username || profile?.full_name || 'Spieler';
      return `<div class="sidebar-item"><div class="sidebar-num">${String(idx + 1).padStart(2, '0')}</div><div class="sidebar-title">${esc(name)}</div><div class="sidebar-tag">${esc(row.game_id)} · ${row.score}</div></div>`;
    }).join('') || '<div class="sidebar-item"><div class="sidebar-title">Noch keine Highscores</div></div>';
  }

  async function renderCollection(tableName, gridId, highlightId, titleField = 'title', subtitleField = 'description') {
    const grid = byId(gridId);
    if (!grid) return;
    const client = createSupabase();
    if (!client) return;
    const selectMap = {
      modules: 'id,title,description,topic,difficulty,created_at',
      decks: 'id,title,theme,is_published,created_at',
      quizzes: 'id,title,description,difficulty,is_published,created_at',
      documents: 'id,title,upload_date,status,created_at'
    };
    const selectColumns = selectMap[tableName] || 'id,title,description,created_at';
    const { data } = await client.from(tableName).select(selectColumns).order('created_at', { ascending: false }).limit(24);
    const rows = data || [];
    grid.innerHTML = '';
    rows.forEach((row) => {
      const card = document.createElement('div');
      const link = resolveCollectionLink(tableName, row);
      card.innerHTML = cardHtml(row[titleField] || 'Eintrag', row[subtitleField] || '', link);
      grid.appendChild(card.firstChild);
    });
    const hi = byId(highlightId);
    if (hi) {
      hi.innerHTML = rows.slice(0, 4).map((row, idx) => `<div class="hot-side"><div class="hs-num">${String(idx + 1).padStart(2, '0')}</div><div class="hs-title">${esc(row[titleField] || '')}</div><div class="hs-meta">${esc(row[subtitleField] || '')}</div></div>`).join('');
    }
  }

  async function renderModuleDetail() {
    const detailBox = byId('moduleDetail');
    if (!detailBox) return;
    const moduleId = new URLSearchParams(window.location.search).get('id');
    const editorWrap = byId('moduleEditor');
    const sectionsGrid = byId('moduleSectionsGrid');
    const outlineBox = byId('moduleOutlineBox');
    const pdfWrap = byId('modulePdfBox');
    const pdfList = byId('modulePdfList');
    const pdfNameInput = byId('modulePdfName');
    const pdfUrlInput = byId('modulePdfUrl');
    const pdfAddBtn = byId('modulePdfAddBtn');
    if (!moduleId) {
      detailBox.style.display = '';
      detailBox.innerHTML = '<div class="wb-title">Modul auswählen</div><p class="author-text">Wähle ein Modul aus der Liste, um den Bearbeitungsmodus zu öffnen.</p>';
      if (editorWrap) {
        editorWrap.style.display = '';
        setText('moduleEditorTitle', 'Bearbeitungsmodus');
        setText('moduleEditorMeta', 'Noch kein Modul ausgewählt.');
      }
      if (sectionsGrid) {
        sectionsGrid.innerHTML = `
          <div class="card"><div class="card-body"><div class="card-title">Anfang</div><div style="min-height:120px;border:1px solid #333;padding:10px;background:#121212;color:#777;">Editor erscheint nach Modulauswahl.</div></div></div>
          <div class="card"><div class="card-body"><div class="card-title">Hauptteil</div><div style="min-height:120px;border:1px solid #333;padding:10px;background:#121212;color:#777;">Editor erscheint nach Modulauswahl.</div></div></div>
          <div class="card"><div class="card-body"><div class="card-title">Schluss</div><div style="min-height:120px;border:1px solid #333;padding:10px;background:#121212;color:#777;">Editor erscheint nach Modulauswahl.</div></div></div>`;
      }
      if (outlineBox) outlineBox.innerHTML = '01 Anfang<br>02 Hauptteil<br>03 Schluss';
      if (pdfWrap) {
        pdfWrap.style.display = '';
      }
      if (pdfList) {
        pdfList.innerHTML = 'PDF-Container wird nach Modulauswahl geladen.';
      }
      return;
    }
    const client = await ensureSupabaseClient();
    if (!client) {
      detailBox.style.display = '';
      detailBox.innerHTML = '<div class="wb-title">Supabase nicht verfügbar</div><p class="author-text">Bitte Verbindung prüfen.</p>';
      return;
    }
    const { data: moduleRow, error } = await client
      .from('modules')
      .select('id,title,description,content,summary,topic,difficulty,user_id,created_at,updated_at')
      .eq('id', moduleId)
      .maybeSingle();
    if (error || !moduleRow) {
      detailBox.style.display = '';
      detailBox.innerHTML = `<div class="wb-title">Modul nicht gefunden</div><p class="author-text">${esc(normalizeSupabaseError(error))}</p>`;
      return;
    }
    let sections = await ensureModuleCoreSections(client, moduleId, moduleRow.description || '');
    const { data: pdfs } = await client
      .from('module_pdfs')
      .select('id,module_id,user_id,name,url,created_at')
      .eq('module_id', moduleId)
      .order('created_at', { ascending: false });
    detailBox.style.display = '';
    detailBox.innerHTML = `
      <div>
        <div class="wb-title">${esc(moduleRow.title || 'Modul')}</div>
        <p class="author-text">${esc(moduleRow.description || '')}</p>
        <p class="author-text">${esc(moduleRow.content || moduleRow.summary || '')}</p>
      </div>
      <div class="support-qr">${esc(moduleRow.topic || 'MODUL')}</div>
    `;
    if (editorWrap && sectionsGrid) {
      editorWrap.style.display = '';
      const canEdit = isAuthenticatedUser();
      setText('moduleEditorTitle', `${moduleRow.title || 'Modul'} · Bearbeitungsmodus`);
      setText('moduleEditorMeta', canEdit ? `Eingeloggt als ${currentDisplayName || currentUser?.email || 'Nutzer'} · ${sections?.length || 0} Container` : `Nur lesbar. Für Bearbeitung bitte anmelden.`);
      sectionsGrid.innerHTML = '';
      (sections || moduleSectionBlueprint()).forEach((section) => {
        const isReadonlyRow = !section?.id;
        const safeTitle = section?.title || (section?.type === 'anfang' ? 'Anfang' : section?.type === 'hauptteil' ? 'Hauptteil' : section?.type === 'schluss' ? 'Schluss' : 'Abschnitt');
        const box = document.createElement('div');
        box.className = 'card';
        box.innerHTML = `
          <div class="card-body">
            <div class="card-title">${esc(safeTitle)}</div>
            ${canEdit ? `
              <div class="nl-form" style="margin-top:8px;margin-bottom:8px;">
                <button class="soc-btn section-format" data-id="${esc(section.id || '')}" data-cmd="bold" type="button">B</button>
                <button class="soc-btn section-format" data-id="${esc(section.id || '')}" data-cmd="italic" type="button">I</button>
                <button class="soc-btn section-format" data-id="${esc(section.id || '')}" data-cmd="underline" type="button">U</button>
                <button class="soc-btn section-format" data-id="${esc(section.id || '')}" data-cmd="insertUnorderedList" type="button">• Liste</button>
                <button class="soc-btn section-format" data-id="${esc(section.id || '')}" data-cmd="justifyLeft" type="button">L</button>
                <button class="soc-btn section-format" data-id="${esc(section.id || '')}" data-cmd="justifyCenter" type="button">C</button>
                <button class="soc-btn section-format" data-id="${esc(section.id || '')}" data-cmd="justifyRight" type="button">R</button>
              </div>
              <div class="module-section-content" contenteditable="true" data-id="${esc(section.id || '')}" style="width:100%;min-height:180px;border:1px solid #333;padding:12px;background:#121212;color:#ddd;">${section?.content || ''}</div>
              <div class="card-foot">
                <button class="soc-btn module-section-save" data-id="${esc(section.id || '')}" type="button"${isReadonlyRow ? ' disabled' : ''}>Speichern</button>
              </div>
            ` : `
              <div style="width:100%;min-height:180px;border:1px solid #333;padding:12px;background:#121212;color:#ddd;">${section?.content || ''}</div>
            `}
          </div>
        `;
        sectionsGrid.appendChild(box);
      });
      if (outlineBox) {
        const outlines = (sections || []).map((s, idx) => `${String(idx + 1).padStart(2, '0')} ${s.title || s.type || 'Abschnitt'}`);
        outlineBox.innerHTML = outlines.length ? outlines.join('<br>') : 'Keine Gliederung';
      }
      if (canEdit) {
        sectionsGrid.querySelectorAll('.section-format').forEach((btn) => {
          btn.addEventListener('click', () => {
            const sectionId = btn.dataset.id;
            const cmd = btn.dataset.cmd;
            const editor = sectionsGrid.querySelector(`.module-section-content[data-id="${sectionId}"]`);
            if (!editor || !cmd) return;
            editor.focus();
            document.execCommand(cmd, false);
          });
        });
        sectionsGrid.querySelectorAll('.module-section-save').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!(await ensureWriteAccess('moduleEditorMeta'))) return;
            const done = setBusy(btn, 'Speichert…');
            const sectionId = btn.dataset.id;
            const editor = sectionsGrid.querySelector(`.module-section-content[data-id="${sectionId}"]`);
            const content = editor?.innerHTML || '';
            if (!sectionId) {
              done();
              setText('moduleEditorMeta', 'Abschnitt konnte nicht gespeichert werden (fehlende ID).');
              return;
            }
            const { error: updateError } = await client
              .from('module_sections')
              .update({ content })
              .eq('id', sectionId);
            done();
            if (updateError) {
              setText('moduleEditorMeta', `Speicherfehler: ${normalizeSupabaseError(updateError)}`);
              return;
            }
            setText('moduleEditorMeta', `✅ Abschnitt gespeichert (${dateLabel(Date.now())})`);
          });
        });
      }
    }
    if (pdfWrap && pdfList) {
      pdfWrap.style.display = '';
      pdfList.innerHTML = (pdfs || []).map((pdf, idx) => `${String(idx + 1).padStart(2, '0')} <a href="${esc(pdf.url)}" target="_blank" rel="noopener noreferrer">${esc(pdf.name || 'PDF')}</a>`).join('<br>') || 'Keine PDFs';
      const canEditPdf = isAuthenticatedUser();
      if (pdfNameInput) pdfNameInput.disabled = !canEditPdf;
      if (pdfUrlInput) pdfUrlInput.disabled = !canEditPdf;
      if (pdfAddBtn) {
        pdfAddBtn.disabled = !canEditPdf;
        if (!canEditPdf) {
          setText('moduleEditorMeta', 'PDF-Upload ist nur für angemeldete Nutzer verfügbar.');
        }
        pdfAddBtn.onclick = async () => {
          if (!(await ensureWriteAccess('moduleEditorMeta'))) return;
          logEvent('INFO', 'Module PDF add clicked', moduleId);
          const done = setBusy(pdfAddBtn, 'Speichert…');
          const name = pdfNameInput?.value?.trim() || '';
          const url = pdfUrlInput?.value?.trim() || '';
          if (!name || !url) {
            done();
            setText('moduleEditorMeta', 'PDF Name und URL sind erforderlich.');
            return;
          }
          const { error: insertError } = await client
            .from('module_pdfs')
            .insert({ module_id: moduleId, name, url, user_id: currentUser?.id || null });
          done();
          if (insertError) {
            setText('moduleEditorMeta', `PDF Fehler: ${normalizeSupabaseError(insertError)}`);
            return;
          }
          pdfNameInput.value = '';
          pdfUrlInput.value = '';
          await renderModuleDetail();
        };
      }
    }
  }

  async function renderDeckDetail() {
    const detailWrap = byId('deckDetail');
    const cardsGrid = byId('deckCardsGrid');
    const statsBox = byId('deckStatsBox');
    const addBtn = byId('addFlashcardBtn');
    if (!detailWrap || !cardsGrid || !addBtn) return;
    const deckId = new URLSearchParams(window.location.search).get('id');
    if (!deckId) {
      detailWrap.style.display = 'none';
      cardsGrid.innerHTML = '';
      return;
    }
    const client = await ensureSupabaseClient();
    if (!client) return;
    const { data: deck, error } = await client.from('decks').select('id,title,theme,user_id,is_published,created_at,updated_at').eq('id', deckId).maybeSingle();
    if (error || !deck) {
      detailWrap.style.display = '';
      cardsGrid.innerHTML = `<div class="card"><div class="card-body"><div class="card-title">Deck nicht gefunden</div><div class="card-excerpt">${esc(normalizeSupabaseError(error))}</div></div></div>`;
      return;
    }
    const { data: cards } = await client.from('flashcards').select('id,deck_id,front,back,status,created_at,updated_at').eq('deck_id', deckId).order('created_at', { ascending: true });
    detailWrap.style.display = '';
    setText('deckDetailTitle', deck.title || 'Deck');
    setText('deckDetailMeta', `${deck.theme || 'Thema offen'} · ${(cards || []).length} Karten`);
    cardsGrid.innerHTML = '';
    (cards || []).forEach((card) => {
      const node = document.createElement('div');
      node.className = 'card';
      node.innerHTML = `
        <div class="card-body">
          <div class="card-title">${esc(card.front || 'Frage')}</div>
          <textarea class="nl-input flashcard-back" data-id="${esc(card.id)}" style="width:100%;height:100px;border:1px solid #333;margin-top:8px;">${esc(card.back || '')}</textarea>
          <div class="card-foot">
            <button class="soc-btn flashcard-save" data-id="${esc(card.id)}" type="button">Speichern</button>
            <button class="soc-btn flashcard-delete" data-id="${esc(card.id)}" type="button">Löschen</button>
          </div>
        </div>
      `;
      cardsGrid.appendChild(node);
    });
    const known = (cards || []).filter((c) => c.status === 'known').length;
    const unknown = Math.max(0, (cards || []).length - known);
    if (statsBox) statsBox.innerHTML = `Known ${known}<br>Unknown ${unknown}`;
    cardsGrid.querySelectorAll('.flashcard-save').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await ensureWriteAccess('deckDetailMeta'))) return;
        logEvent('INFO', 'Flashcard save clicked', btn.dataset.id);
        const done = setBusy(btn, 'Speichert…');
        const cardId = btn.dataset.id;
        const back = cardsGrid.querySelector(`.flashcard-back[data-id="${cardId}"]`)?.value || '';
        const { error: updateError } = await client.from('flashcards').update({ back }).eq('id', cardId);
        done();
        if (updateError) {
          setText('deckDetailMeta', `Fehler: ${normalizeSupabaseError(updateError)}`);
          return;
        }
        setText('deckDetailMeta', 'Karte gespeichert.');
      });
    });
    cardsGrid.querySelectorAll('.flashcard-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await ensureWriteAccess('deckDetailMeta'))) return;
        logEvent('INFO', 'Flashcard delete clicked', btn.dataset.id);
        const done = setBusy(btn, 'Löscht…');
        const cardId = btn.dataset.id;
        const { error: deleteError } = await client.from('flashcards').delete().eq('id', cardId);
        done();
        if (deleteError) {
          setText('deckDetailMeta', `Fehler: ${normalizeSupabaseError(deleteError)}`);
          return;
        }
        await renderDeckDetail();
      });
    });
    addBtn.onclick = async () => {
      if (!(await ensureWriteAccess('deckDetailMeta'))) return;
      logEvent('INFO', 'Flashcard add clicked', deckId);
      const done = setBusy(addBtn, 'Erstellt…');
      const front = byId('newFlashcardFront')?.value?.trim() || '';
      const back = byId('newFlashcardBack')?.value?.trim() || '';
      if (!front || !back) {
        done();
        setText('deckDetailMeta', 'Bitte Frage und Antwort eingeben.');
        return;
      }
      const { error: insertError } = await client
        .from('flashcards')
        .insert({ deck_id: deckId, front, back, status: 'new' });
      done();
      if (insertError) {
        setText('deckDetailMeta', `Fehler: ${normalizeSupabaseError(insertError)}`);
        return;
      }
      byId('newFlashcardFront').value = '';
      byId('newFlashcardBack').value = '';
      await renderDeckDetail();
    };
  }

  async function renderQuizDetail() {
    const detailWrap = byId('quizDetail');
    const questionsGrid = byId('quizQuestionsGrid');
    const statsBox = byId('quizStatsBox');
    const addBtn = byId('addQuizQuestionBtn');
    if (!detailWrap || !questionsGrid || !addBtn) return;
    const quizId = new URLSearchParams(window.location.search).get('id');
    if (!quizId) {
      detailWrap.style.display = 'none';
      questionsGrid.innerHTML = '';
      return;
    }
    const client = await ensureSupabaseClient();
    if (!client) return;
    const { data: quiz, error } = await client.from('quizzes').select('id,title,description,difficulty,time_limit_seconds,user_id,is_published,created_at,updated_at').eq('id', quizId).maybeSingle();
    if (error || !quiz) {
      detailWrap.style.display = '';
      questionsGrid.innerHTML = `<div class="card"><div class="card-body"><div class="card-title">Quiz nicht gefunden</div><div class="card-excerpt">${esc(normalizeSupabaseError(error))}</div></div></div>`;
      return;
    }
    const { data: questions } = await client.from('quiz_questions').select('id,quiz_id,type,question,options,correct_answer,feedback,order,created_at,updated_at').eq('quiz_id', quizId).order('order', { ascending: true });
    detailWrap.style.display = '';
    setText('quizDetailTitle', quiz.title || 'Quiz');
    setText('quizDetailMeta', `${quiz.difficulty || 'Grundlagen'} · ${(questions || []).length} Fragen`);
    questionsGrid.innerHTML = '';
    (questions || []).forEach((questionRow, idx) => {
      const options = Array.isArray(questionRow.options) ? questionRow.options.join(' | ') : '';
      const correct = Array.isArray(questionRow.correct_answer) ? Number(questionRow.correct_answer[0] || 0) : Number(questionRow.correct_answer || 0);
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-body">
          <div class="card-title">Frage ${idx + 1}</div>
          <input class="nl-input quiz-question-text" data-id="${esc(questionRow.id)}" value="${esc(questionRow.question || '')}" style="width:100%;border:1px solid #333;margin:8px 0;"/>
          <input class="nl-input quiz-question-options" data-id="${esc(questionRow.id)}" value="${esc(options)}" style="width:100%;border:1px solid #333;margin-bottom:8px;"/>
          <input class="nl-input quiz-question-correct" data-id="${esc(questionRow.id)}" type="number" value="${correct}" style="width:100%;border:1px solid #333;margin-bottom:8px;"/>
          <div class="card-foot">
            <button class="soc-btn quiz-question-save" data-id="${esc(questionRow.id)}" type="button">Speichern</button>
            <button class="soc-btn quiz-question-delete" data-id="${esc(questionRow.id)}" type="button">Löschen</button>
          </div>
        </div>
      `;
      questionsGrid.appendChild(card);
    });
    if (statsBox) statsBox.innerHTML = `${quiz.difficulty || 'Quiz'}<br>${(questions || []).length} Fragen`;
    questionsGrid.querySelectorAll('.quiz-question-save').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await ensureWriteAccess('quizDetailMeta'))) return;
        logEvent('INFO', 'Quiz question save clicked', btn.dataset.id);
        const done = setBusy(btn, 'Speichert…');
        const id = btn.dataset.id;
        const question = questionsGrid.querySelector(`.quiz-question-text[data-id="${id}"]`)?.value || '';
        const optionsText = questionsGrid.querySelector(`.quiz-question-options[data-id="${id}"]`)?.value || '';
        const options = optionsText.split('|').map((v) => v.trim()).filter(Boolean);
        const correct = Number(questionsGrid.querySelector(`.quiz-question-correct[data-id="${id}"]`)?.value || 0);
        const payload = { question, options, correct_answer: [Number.isFinite(correct) ? correct : 0] };
        const { error: updateError } = await client.from('quiz_questions').update(payload).eq('id', id);
        done();
        if (updateError) {
          setText('quizDetailMeta', `Fehler: ${normalizeSupabaseError(updateError)}`);
          return;
        }
        setText('quizDetailMeta', 'Frage gespeichert.');
      });
    });
    questionsGrid.querySelectorAll('.quiz-question-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await ensureWriteAccess('quizDetailMeta'))) return;
        logEvent('INFO', 'Quiz question delete clicked', btn.dataset.id);
        const done = setBusy(btn, 'Löscht…');
        const id = btn.dataset.id;
        const { error: deleteError } = await client.from('quiz_questions').delete().eq('id', id);
        done();
        if (deleteError) {
          setText('quizDetailMeta', `Fehler: ${normalizeSupabaseError(deleteError)}`);
          return;
        }
        await renderQuizDetail();
      });
    });
    addBtn.onclick = async () => {
      if (!(await ensureWriteAccess('quizDetailMeta'))) return;
      logEvent('INFO', 'Quiz question add clicked', quizId);
      const done = setBusy(addBtn, 'Erstellt…');
      const question = byId('newQuizQuestion')?.value?.trim() || '';
      const optionsText = byId('newQuizOptions')?.value?.trim() || '';
      const options = optionsText.split('|').map((v) => v.trim()).filter(Boolean);
      const correct = Number(byId('newQuizCorrectIndex')?.value || 0);
      if (!question || options.length < 2) {
        done();
        setText('quizDetailMeta', 'Frage und mindestens zwei Optionen erforderlich.');
        return;
      }
      const { error: insertError } = await client
        .from('quiz_questions')
        .insert({ quiz_id: quizId, type: 'multiple_choice', question, options, correct_answer: [Number.isFinite(correct) ? correct : 0], order: (questions || []).length });
      done();
      if (insertError) {
        setText('quizDetailMeta', `Fehler: ${normalizeSupabaseError(insertError)}`);
        return;
      }
      byId('newQuizQuestion').value = '';
      byId('newQuizOptions').value = '';
      byId('newQuizCorrectIndex').value = '';
      await renderQuizDetail();
    };
  }

  async function renderNetworkWorkspace() {
    const detailWrap = byId('networkDetail');
    const statsBox = byId('networkStatsBox');
    const createBtn = byId('createGroupBtn');
    if (!detailWrap || !createBtn) return;
    const client = await ensureSupabaseClient();
    if (!client) return;
    detailWrap.style.display = '';
    const friendsGrid = byId('friendsGrid');
    const groupsGrid = byId('groupsGrid');
    setText('networkDetailTitle', 'Vernetzen Workspace');
    setText('networkDetailMeta', 'Freunde, Gruppen und gemeinsames Arbeiten');
    if (statsBox) statsBox.innerHTML = `${friendsGrid?.children.length || 0} Friends<br>${groupsGrid?.children.length || 0} Groups`;
    const addFriendBtn = byId('addFriendBtn');
    if (addFriendBtn) {
      addFriendBtn.onclick = async () => {
        if (!(await ensureWriteAccess('networkDetailMeta'))) return;
        const done = setBusy(addFriendBtn, 'Verknüpft…');
        const friendCode = byId('friendCodeInput')?.value?.trim() || '';
        if (!friendCode) {
          done();
          setText('networkDetailMeta', 'Bitte Freundschaftscode eingeben.');
          return;
        }
        const { data: friendProfile, error: profileError } = await client
          .from('profiles')
          .select('id,username,full_name')
          .eq('friendship_code', friendCode)
          .maybeSingle();
        if (profileError || !friendProfile?.id || !currentUser?.id) {
          done();
          setText('networkDetailMeta', `Freund nicht gefunden: ${normalizeSupabaseError(profileError)}`);
          return;
        }
        if (friendProfile.id === currentUser.id) {
          done();
          setText('networkDetailMeta', 'Du kannst dich nicht selbst hinzufügen.');
          return;
        }
        const pairRows = [
          { user_id: currentUser.id, friend_user_id: friendProfile.id, status: 'accepted' },
          { user_id: friendProfile.id, friend_user_id: currentUser.id, status: 'accepted' }
        ];
        const { error: insertError } = await client.from('friendships').upsert(pairRows, { onConflict: 'user_id,friend_user_id' });
        done();
        if (insertError) {
          setText('networkDetailMeta', `Freund konnte nicht hinzugefügt werden: ${normalizeSupabaseError(insertError)}`);
          return;
        }
        byId('friendCodeInput').value = '';
        setText('networkDetailMeta', `Freund hinzugefügt: ${friendProfile.full_name || friendProfile.username || 'Nutzer'}`);
        await renderVernetzen();
      };
    }
    createBtn.onclick = async () => {
      if (!(await ensureWriteAccess('networkDetailMeta'))) return;
      logEvent('INFO', 'Create group clicked');
      const done = setBusy(createBtn, 'Erstellt…');
      const name = byId('newGroupName')?.value?.trim() || '';
      const description = byId('newGroupDescription')?.value?.trim() || '';
      if (!name) {
        done();
        setText('networkDetailMeta', 'Gruppenname ist erforderlich.');
        return;
      }
      const { data } = await client.auth.getUser();
      const userId = data?.user?.id || null;
      const { error } = await client.from('groups').insert({ name, description, owner_id: userId });
      done();
      if (error) {
        setText('networkDetailMeta', `Gruppenfehler: ${normalizeSupabaseError(error)}`);
        return;
      }
      byId('newGroupName').value = '';
      byId('newGroupDescription').value = '';
      await renderVernetzen();
      await renderNetworkWorkspace();
    };
  }

  async function renderVernetzen() {
    const client = await ensureSupabaseClient();
    if (!client) return;
    const friendsGrid = byId('friendsGrid');
    const groupsGrid = byId('groupsGrid');
    const groupPanelContent = byId('groupPanelContent');
    const hi = byId('networkHighlights');
    if (friendsGrid) {
      friendsGrid.innerHTML = '';
      if (!currentUser?.id) {
        friendsGrid.innerHTML = '<div class="card"><div class="card-body"><div class="card-title">Bitte anmelden</div><div class="card-excerpt">Freundesliste ist für eingeloggte Nutzer sichtbar.</div></div></div>';
      } else {
        const { data: relations } = await client
          .from('friendships')
          .select('friend_user_id')
          .eq('user_id', currentUser.id)
          .limit(200);
        const friendIds = (relations || []).map((row) => row.friend_user_id).filter(Boolean);
        let profiles = [];
        if (friendIds.length) {
          const { data } = await client
            .from('profiles')
            .select('id,username,full_name,study_program,friendship_code')
            .in('id', friendIds);
          profiles = data || [];
        }
        profiles.forEach((row) => {
          const name = row.username || row.full_name || 'Nutzer';
          const subtitle = `${row.study_program || 'Studiengang offen'} · Code ${row.friendship_code || '—'}`;
          const card = document.createElement('div');
          card.innerHTML = cardHtml(name, subtitle, '#');
          friendsGrid.appendChild(card.firstChild);
        });
        if (!profiles.length) {
          friendsGrid.innerHTML = '<div class="card"><div class="card-body"><div class="card-title">Noch keine Freunde</div><div class="card-excerpt">Nutze einen Freundschaftscode zum Hinzufügen.</div></div></div>';
        }
      }
    }
    if (groupsGrid) {
      groupsGrid.innerHTML = '';
      const { data } = await client.from('groups').select('id,name,description,owner_id').order('name', { ascending: true }).limit(40);
      (data || []).forEach((row) => {
        const card = document.createElement('div');
        card.innerHTML = cardHtml(row.name || 'Gruppe', row.description || '', `${rootPath()}vernetzen/?group=${encodeURIComponent(row.id)}`);
        const el = card.firstChild;
        el.onclick = () => {
          const params = new URLSearchParams(window.location.search);
          params.set('group', row.id);
          window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
          if (groupPanelContent) {
            groupPanelContent.innerHTML = `<div class="wb-title">${esc(row.name || 'Gruppe')}</div><p class="author-text">${esc(row.description || '')}</p><p class="author-text">Owner: ${esc(row.owner_id || 'unbekannt')}</p>`;
          }
        };
        groupsGrid.appendChild(el);
      });
      const selectedGroup = new URLSearchParams(window.location.search).get('group');
      if (groupPanelContent) {
        if (!selectedGroup) groupPanelContent.innerHTML = 'Bitte Gruppe auswählen.';
        const picked = (data || []).find((g) => g.id === selectedGroup);
        if (picked) {
          groupPanelContent.innerHTML = `<div class="wb-title">${esc(picked.name || 'Gruppe')}</div><p class="author-text">${esc(picked.description || '')}</p>`;
        }
      }
    }
    if (hi) {
      hi.innerHTML = `<div class="hot-side"><div class="hs-num">01</div><div class="hs-title">Freunde</div><div class="hs-meta">${friendsGrid ? friendsGrid.children.length : 0} Einträge</div></div>
      <div class="hot-side"><div class="hs-num">02</div><div class="hs-title">Gruppen</div><div class="hs-meta">${groupsGrid ? groupsGrid.children.length : 0} Einträge</div></div>`;
    }
  }

  async function renderKonto() {
    if (!byId('accountProfileBox')) return;
    const client = createSupabase();
    if (!client) return;
    const { data } = await client.auth.getUser();
    const user = data?.user || null;
    if (!user) {
      if (byId('accountName')) byId('accountName').textContent = 'Nicht eingeloggt';
      if (byId('accountMail')) byId('accountMail').textContent = 'Bitte einloggen, um Kontodaten zu sehen.';
      return;
    }
    const { data: profile } = await client.from('profiles').select('username,full_name,avatar_url,about_me,study_program,friendship_code').eq('id', user.id).maybeSingle();
    if (byId('accountName')) byId('accountName').textContent = profile?.full_name || profile?.username || user.email || 'Profil';
    if (byId('accountMail')) byId('accountMail').textContent = user.email || '';
    if (byId('accountMeta')) byId('accountMeta').textContent = `Rolle: ${currentRole}`;
    if (byId('accountAvatar')) byId('accountAvatar').innerHTML = profile?.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;">` : 'Profil';
    const logoutBtn = byId('accountLogoutBtn');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        const done = setBusy(logoutBtn, 'Logout…');
        const { error } = await client.auth.signOut();
        done();
        if (error) {
          setText('accountLogoutStatus', `Logout fehlgeschlagen: ${normalizeSupabaseError(error)}`);
          logEvent('ERROR', 'Logout failed', normalizeSupabaseError(error));
          return;
        }
        setText('accountLogoutStatus', 'Erfolgreich ausgeloggt.');
        logEvent('INFO', 'Logout successful', user.email || user.id);
        window.location.href = `${rootPath()}login/`;
      };
    }
    const aboutEl = byId('profileAboutMe');
    const studyEl = byId('profileStudyProgram');
    const codeEl = byId('profileFriendCode');
    if (aboutEl) aboutEl.value = profile?.about_me || '';
    if (studyEl) studyEl.value = profile?.study_program || '';
    if (codeEl) codeEl.value = profile?.friendship_code || '';
    const saveBtn = byId('saveProfileBtn');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const done = setBusy(saveBtn, 'Speichert…');
        const aboutMe = byId('profileAboutMe')?.value || '';
        const studyProgram = byId('profileStudyProgram')?.value || '';
        const payload = { about_me: aboutMe, study_program: studyProgram };
        const { error } = await client.from('profiles').update(payload).eq('id', user.id);
        done();
        if (error) {
          setText('profileStatus', `Speichern fehlgeschlagen: ${normalizeSupabaseError(error)}`);
          return;
        }
        setText('profileStatus', 'Profil erfolgreich gespeichert.');
      };
    }
    const { data: notes } = await client.from('notes').select('id,title,teaser').eq('author_id', user.id).order('created_at', { ascending: false }).limit(24);
    const grid = byId('accountNotesGrid');
    if (grid) {
      (notes || []).forEach((note) => {
        const card = document.createElement('div');
        card.innerHTML = cardHtml(note.title || 'Mitschrift', note.teaser || '', `${rootPath()}mitschrift/?id=${encodeURIComponent(note.id)}`);
        grid.appendChild(card.firstChild);
      });
    }
  }

  async function renderMitschrift() {
    if (!byId('noteTitle')) return;
    const id = new URLSearchParams(window.location.search).get('id');
    const client = createSupabase();
    if (!client || !id) {
      if (byId('noteTitle')) byId('noteTitle').textContent = 'MITSCHRIFT NICHT GEFUNDEN';
      if (byId('noteTeaser')) byId('noteTeaser').textContent = 'Keine gültige ID übergeben.';
      return;
    }
    const { data: note } = await client.from('notes').select('id,title,teaser,category,body,image_path,created_at,updated_at,author_id').eq('id', id).maybeSingle();
    if (!note) {
      if (byId('noteTitle')) byId('noteTitle').textContent = 'MITSCHRIFT NICHT GEFUNDEN';
      if (byId('noteTeaser')) byId('noteTeaser').textContent = 'Dieser Eintrag existiert nicht.';
      return;
    }
    if (byId('noteTitle')) byId('noteTitle').textContent = toText(note.title);
    if (byId('noteTeaser')) byId('noteTeaser').textContent = toText(note.teaser);
    if (byId('noteMeta')) byId('noteMeta').textContent = `Kategorie: ${toText(note.category || 'Mitschrift')} · ${dateLabel(note.updated_at || note.created_at)}`;
    if (byId('noteImage')) byId('noteImage').innerHTML = note.image_path ? `<img src="${esc(note.image_path)}" alt="${esc(note.title)}">` : '';
    const { data: sections } = await client.from('note_sections').select('id,note_id,heading,content,order_index').eq('note_id', id).order('order_index', { ascending: true });
    const body = byId('noteContent');
    if (body) {
      body.innerHTML = '';
      (sections || []).forEach((section) => {
        const block = document.createElement('div');
        block.innerHTML = `<h2>${esc(section.heading || 'Abschnitt')}</h2><p>${esc(section.content || '').replaceAll('\n', '<br>')}</p>`;
        body.appendChild(block);
      });
      if (!sections?.length) {
        body.innerHTML = `<p>${esc(note.body || '')}</p>`;
      }
      if (currentRole === 'admin') {
        const edit = document.createElement('div');
        edit.innerHTML = `<textarea id="noteEditText" class="nl-input" style="width:100%;height:220px;border:1px solid #333;margin-top:16px;">${esc(note.body || '')}</textarea>
        <button id="noteSaveBtn" class="nl-btn" type="button" style="margin-top:10px;">Änderungen speichern</button>`;
        body.appendChild(edit);
        const saveBtn = byId('noteSaveBtn');
        if (saveBtn) {
          saveBtn.addEventListener('click', async () => {
            const value = byId('noteEditText')?.value || '';
            await client.from('notes').update({ body: value, teaser: value.slice(0, 180) }).eq('id', id);
            window.location.reload();
          });
        }
      }
    }
    const { data: words } = await client.from('search_words').select('id,note_id,word').eq('note_id', id).order('word', { ascending: true });
    const wordsBox = byId('noteSearchWords');
    if (wordsBox) {
      wordsBox.innerHTML = (words || []).map((row, idx) => `<div class="sidebar-item"><div class="sidebar-num">${String(idx + 1).padStart(2, '0')}</div><div class="sidebar-title">${esc(row.word)}</div></div>`).join('') || '<div class="sidebar-item"><div class="sidebar-title">Keine Suchwörter hinterlegt</div></div>';
    }
  }

  function rankHits(q, items) {
    const terms = q.split(/\s+/).filter(Boolean);
    return items
      .map((row) => {
        const title = toText(row.title).toLowerCase();
        const teaser = toText(row.teaser).toLowerCase();
        const body = toText(row.body).toLowerCase();
        const words = toText((row.search_words || []).join(' ')).toLowerCase();
        let score = 0;
        terms.forEach((term) => {
          if (title.includes(term)) score += 6;
          if (teaser.includes(term)) score += 3;
          if (words.includes(term)) score += 4;
          if (body.includes(term)) score += 1;
        });
        return { row, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.row.updated_at || b.row.created_at) - new Date(a.row.updated_at || a.row.created_at))
      .map((entry) => entry.row);
  }

  async function search(query, rawInput) {
    if (!cachedSearchResults.length) await loadSearchCache();
    const q = toText(query).toLowerCase();
    const localMatched = cachedSearchResults.filter((row) => {
      const haystack = `${toText(row.title)} ${toText(row.teaser)} ${toText(row.body)} ${toText((row.search_words || []).join(' '))}`.toLowerCase();
      return haystack.includes(q);
    });
    let hits = rankHits(q, localMatched);
    const client = createSupabase();
    if (client && q.length >= 2) {
      const { data: remoteHits, error } = await client.rpc('search_notes', { query_text: rawInput, result_limit: 24 });
      if (!error && Array.isArray(remoteHits) && remoteHits.length) {
        const map = new Map();
        [...remoteHits, ...hits].forEach((row) => {
          if (!map.has(row.id)) map.set(row.id, row);
        });
        hits = [...map.values()];
      }
    }
    const box = byId('searchResults');
    if (box) {
      box.innerHTML = hits.slice(0, 8).map((row) => `<a class="search-hit" href="${rootPath()}mitschrift/?id=${encodeURIComponent(row.id)}"><div class="search-hit-title">${esc(row.title)}</div><div class="search-hit-meta">${esc(row.category || 'Mitschrift')} · ${dateLabel(row.created_at)}</div></a>`).join('') || '<div class="search-hit"><div class="search-hit-title">Keine Treffer</div></div>';
      box.classList.add('open');
    }
    const bar = byId('filterBar');
    if (bar) bar.classList.add('active');
    const text = byId('filterBarText');
    if (text) text.textContent = `Suche: "${rawInput}" — ${hits.length} Treffer`;
    const homeCards = document.querySelectorAll('.filterable[data-note-id], #heroMainArticle.filterable, .hero-side-item.filterable');
    if (homeCards.length) {
      let count = 0;
      homeCards.forEach((el) => {
        const title = toText(el.dataset.title).toLowerCase();
        const match = title.includes(q);
        el.style.display = match ? '' : 'none';
        if (match) count += 1;
      });
      const noRes = byId('noResults');
      if (noRes) noRes.style.display = count === 0 ? 'block' : 'none';
    }
  }

  async function checkAdmin() {
    if (currentRole !== 'admin') return false;
    return true;
  }

  async function loadAdminCache(forceReload = false) {
    const client = createSupabase();
    if (!client) return;
    if (!forceReload && adminNotesCache.length > 0) return;
    const { data: notes } = await client
      .from('notes')
      .select('id,title,teaser,image_path,updated_at')
      .order('updated_at', { ascending: false })
      .limit(1000);
    adminNotesCache = notes || [];
    const noteIds = adminNotesCache.map((note) => note.id);
    adminWordsByNote = new Map();
    if (!noteIds.length) return;
    const { data: words } = await client
      .from('search_words')
      .select('id,word,note_id')
      .in('note_id', noteIds)
      .order('word', { ascending: true });
    (words || []).forEach((row) => {
      const list = adminWordsByNote.get(row.note_id) || [];
      list.push(row);
      adminWordsByNote.set(row.note_id, list);
    });
  }

  function renderAdminPager(totalItems) {
    const pager = byId('adminNotesPager');
    if (!pager) return;
    const pages = Math.max(1, Math.ceil(totalItems / adminPageSize));
    if (adminPage > pages) adminPage = pages;
    pager.innerHTML = `
      <button class="soc-btn" id="adminPrevPageBtn" type="button"${adminPage <= 1 ? ' disabled' : ''}>Zurück</button>
      <span style="margin:0 12px;color:#bbb;">Seite ${adminPage} / ${pages}</span>
      <button class="soc-btn" id="adminNextPageBtn" type="button"${adminPage >= pages ? ' disabled' : ''}>Weiter</button>
    `;
    const prev = byId('adminPrevPageBtn');
    const next = byId('adminNextPageBtn');
    if (prev) {
      prev.addEventListener('click', async () => {
        if (adminPage <= 1) return;
        adminPage -= 1;
        await renderAdminNotes(false);
      });
    }
    if (next) {
      next.addEventListener('click', async () => {
        if (adminPage >= pages) return;
        adminPage += 1;
        await renderAdminNotes(false);
      });
    }
  }

  async function renderAdminNotes(forceReload = false) {
    const grid = byId('adminNotesGrid');
    const client = createSupabase();
    if (!grid || !client) return;
    await loadAdminCache(forceReload);
    const total = adminNotesCache.length;
    const pages = Math.max(1, Math.ceil(total / adminPageSize));
    if (adminPage > pages) adminPage = pages;
    if (adminPage < 1) adminPage = 1;
    const start = (adminPage - 1) * adminPageSize;
    const visibleNotes = adminNotesCache.slice(start, start + adminPageSize);
    grid.innerHTML = '';
    visibleNotes.forEach((note) => {
      const words = adminWordsByNote.get(note.id) || [];
      const chips = words.map((row) => `<button class="soc-btn admin-remove-note-word" data-id="${esc(note.id)}" data-word-id="${esc(row.id)}" type="button" style="margin-right:6px;margin-bottom:6px;">${esc(row.word)} ×</button>`).join('');
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-body">
          <input class="nl-input admin-note-title" data-id="${esc(note.id)}" value="${esc(note.title || '')}" style="width:100%;border:1px solid #333;margin-bottom:8px;" />
          <input class="nl-input admin-note-teaser" data-id="${esc(note.id)}" value="${esc(note.teaser || '')}" style="width:100%;border:1px solid #333;margin-bottom:8px;" />
          <input class="nl-input admin-note-image" data-id="${esc(note.id)}" value="${esc(note.image_path || '')}" style="width:100%;border:1px solid #333;margin-bottom:8px;" />
          <div style="margin-bottom:8px;">${chips || '<span style="color:#777;">Keine Suchwörter</span>'}</div>
          <div class="nl-form" style="margin-bottom:8px;">
            <input class="nl-input admin-note-word" data-id="${esc(note.id)}" placeholder="Suchwort für diese Mitschrift" />
            <button class="nl-btn admin-add-note-word" data-id="${esc(note.id)}" type="button">Wort+</button>
          </div>
          <div class="card-foot">
            <button class="soc-btn admin-save-note" data-id="${esc(note.id)}" type="button">Speichern</button>
            <button class="soc-btn admin-delete-note" data-id="${esc(note.id)}" type="button">Löschen</button>
          </div>
        </div>`;
      grid.appendChild(card);
    });
    renderAdminPager(total);
    grid.querySelectorAll('.admin-save-note').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const done = setBusy(btn, 'Speichert…');
        const id = btn.dataset.id;
        const title = grid.querySelector(`.admin-note-title[data-id="${id}"]`)?.value || '';
        const teaser = grid.querySelector(`.admin-note-teaser[data-id="${id}"]`)?.value || '';
        const imagePath = grid.querySelector(`.admin-note-image[data-id="${id}"]`)?.value || '';
        if (!title.trim() || !teaser.trim()) {
          done();
          setText('adminStatus', 'Titel und Teaser dürfen nicht leer sein.');
          return;
        }
        const { error } = await client.from('notes').update({ title: title.trim(), teaser: teaser.trim(), image_path: imagePath.trim() || null }).eq('id', id);
        done();
        if (error) {
          setText('adminStatus', `Fehler beim Speichern: ${error.message}`);
          return;
        }
        setText('adminStatus', 'Mitschrift gespeichert.');
        await renderAdminNotes(true);
        await loadSearchCache();
      });
    });
    grid.querySelectorAll('.admin-delete-note').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Mitschrift wirklich löschen?')) return;
        const done = setBusy(btn, 'Löscht…');
        const id = btn.dataset.id;
        setText('adminStatus', 'Lösche Mitschrift…');
        const r1 = await client.from('note_sections').delete().eq('note_id', id);
        const r2 = await client.from('search_words').delete().eq('note_id', id);
        const r3 = await client.from('notes').delete().eq('id', id);
        done();
        if (r1.error || r2.error || r3.error) {
          const message = r1.error?.message || r2.error?.message || r3.error?.message || 'Unbekannter Fehler';
          setText('adminStatus', `Löschen fehlgeschlagen: ${message}`);
          return;
        }
        setText('adminStatus', 'Mitschrift gelöscht.');
        await renderAdminNotes(true);
        await renderAdminWords();
        await loadSearchCache();
      });
    });
    grid.querySelectorAll('.admin-add-note-word').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const done = setBusy(btn, 'Speichert…');
        const id = btn.dataset.id;
        const input = grid.querySelector(`.admin-note-word[data-id="${id}"]`);
        const word = (input?.value || '').trim();
        if (!word) {
          done();
          return;
        }
        const { error } = await client.from('search_words').insert({ note_id: id, word });
        done();
        if (error && !error.message.toLowerCase().includes('duplicate')) {
          setText('adminStatus', `Suchwort konnte nicht gespeichert werden: ${error.message}`);
          return;
        }
        setText('adminStatus', `Suchwort "${word}" gespeichert.`);
        input.value = '';
        await renderAdminNotes(true);
        await renderAdminWords();
        await loadSearchCache();
      });
    });
    grid.querySelectorAll('.admin-remove-note-word').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const done = setBusy(btn, 'Entfernt…');
        const wordId = btn.dataset.wordId;
        const { error } = await client.from('search_words').delete().eq('id', wordId);
        done();
        if (error) {
          setText('adminStatus', `Suchwort konnte nicht gelöscht werden: ${error.message}`);
          return;
        }
        setText('adminStatus', 'Suchwort gelöscht.');
        await renderAdminNotes(true);
        await renderAdminWords();
        await loadSearchCache();
      });
    });
  }

  async function renderAdminWords() {
    const list = byId('adminSearchWordsList');
    const client = createSupabase();
    if (!list || !client) return;
    await loadAdminCache(false);
    const noteName = new Map(adminNotesCache.map((row) => [row.id, row.title]));
    const flattened = [];
    adminWordsByNote.forEach((rows, noteId) => {
      rows.forEach((row) => {
        flattened.push({
          id: row.id,
          word: row.word,
          noteId,
          noteTitle: noteName.get(noteId) || 'Mitschrift'
        });
      });
    });
    flattened.sort((a, b) => a.word.localeCompare(b.word, 'de'));
    list.innerHTML = flattened.map((row) => `<div style="margin-bottom:6px;">${esc(row.word)} · ${esc(row.noteTitle)} <button class="soc-btn admin-delete-word" data-id="${esc(row.id)}" type="button">x</button></div>`).join('') || 'Keine Suchwörter geladen';
    list.querySelectorAll('.admin-delete-word').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const done = setBusy(btn, '…');
        const { error } = await client.from('search_words').delete().eq('id', btn.dataset.id);
        done();
        if (error) {
          setText('adminStatus', `Suchwort konnte nicht gelöscht werden: ${error.message}`);
          return;
        }
        setText('adminStatus', 'Suchwort gelöscht.');
        await renderAdminNotes(true);
        await renderAdminWords();
        await loadSearchCache();
      });
    });
  }

  async function setupAdminPage() {
    if (!byId('adminStatus')) return;
    logEvent('INFO', 'setupAdminPage gestartet');
    const client = await ensureSupabaseClient();
    if (!client) {
      logEvent('ERROR', 'setupAdminPage: Supabase Client fehlt');
      byId('adminStatus').textContent = 'Supabase-Verbindung fehlt. URL/Key oder Netzverbindung prüfen.';
      return;
    }
    const loginBtn = byId('adminLoginBtn');
    const logoutBtn = byId('adminLogoutBtn');
    const createBtn = byId('createNoteBtn');
    const addWordBtn = byId('addSearchWordBtn');
    if (loginBtn) {
      logEvent('INFO', 'Admin-Login-Button gefunden und Event gebunden');
      loginBtn.addEventListener('click', async () => {
        logEvent('INFO', 'Admin-Login Klick erkannt');
        const done = setBusy(loginBtn, 'Lädt…');
        const email = byId('adminEmail')?.value || '';
        const password = byId('adminPassword')?.value || '';
        if (!email.trim() || !password.trim()) {
          done();
          byId('adminStatus').textContent = 'Bitte E-Mail und Passwort eingeben.';
          return;
        }
        const { error } = await client.auth.signInWithPassword({ email, password });
        done();
        if (error) {
          logEvent('ERROR', 'Admin-Login fehlgeschlagen', normalizeSupabaseError(error));
          byId('adminStatus').textContent = `Login fehlgeschlagen: ${normalizeSupabaseError(error)}`;
          return;
        }
        await loadAuthState();
        const isAdmin = await checkAdmin();
        logEvent('INFO', 'Admin-Login erfolgreich', `isAdmin=${isAdmin} email=${email.trim()}`);
        byId('adminStatus').textContent = isAdmin ? 'Admin-Login erfolgreich.' : 'Eingeloggt, aber keine Admin-Rolle.';
        if (isAdmin) {
          adminPage = 1;
          await renderAdminNotes(true);
          await renderAdminWords();
        }
      });
    }
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await client.auth.signOut();
        currentRole = 'guest';
        currentUser = null;
        byId('adminStatus').textContent = 'Ausgeloggt.';
      });
    }
    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        if (!(await checkAdmin())) {
          byId('adminStatus').textContent = 'Nur Admins können Mitschriften erstellen.';
          return;
        }
        const title = byId('newNoteTitle')?.value || '';
        const teaser = byId('newNoteTeaser')?.value || '';
        const imagePath = byId('newNoteImage')?.value || '';
        const body = byId('newNoteBody')?.value || '';
        if (!title.trim() || !teaser.trim() || !body.trim()) {
          setText('adminStatus', 'Titel, Teaser und Inhalt sind Pflichtfelder.');
          return;
        }
        const done = setBusy(createBtn, 'Erstellt…');
        setText('adminStatus', 'Erstelle Mitschrift…');
        const { data: inserted, error } = await client
          .from('notes')
          .insert({
            title: title.trim(),
            teaser: teaser.trim(),
            body: body.trim(),
            category: 'Mitschrift',
            image_path: imagePath.trim() || null,
            author_id: currentUser?.id || null
          })
          .select('id')
          .single();
        done();
        if (error || !inserted?.id) {
          setText('adminStatus', `Erstellen fehlgeschlagen: ${error?.message || 'Unbekannter Fehler'}`);
          return;
        }
        const sectionResult = await client.from('note_sections').insert({ note_id: inserted.id, heading: 'Inhalt', content: body.trim(), order_index: 1 });
        if (sectionResult.error) {
          setText('adminStatus', `Abschnitt konnte nicht erstellt werden: ${sectionResult.error.message}`);
          return;
        }
        byId('newNoteTitle').value = '';
        byId('newNoteTeaser').value = '';
        byId('newNoteImage').value = '';
        byId('newNoteBody').value = '';
        setText('adminStatus', 'Mitschrift erstellt.');
        adminPage = 1;
        await renderAdminNotes(true);
        await renderAdminWords();
        await loadSearchCache();
      });
    }
    if (addWordBtn) {
      addWordBtn.addEventListener('click', async () => {
        const done = setBusy(addWordBtn, 'Speichert…');
        if (!(await checkAdmin())) {
          done();
          byId('adminStatus').textContent = 'Nur Admins können Suchwörter bearbeiten.';
          return;
        }
        const word = byId('newSearchWord')?.value || '';
        const { data: latest } = await client.from('notes').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!latest?.id || !word.trim()) {
          done();
          return;
        }
        const { error } = await client.from('search_words').insert({ note_id: latest.id, word: word.trim() });
        done();
        if (error && !error.message.toLowerCase().includes('duplicate')) {
          setText('adminStatus', `Suchwort fehlgeschlagen: ${error.message}`);
          return;
        }
        byId('newSearchWord').value = '';
        setText('adminStatus', 'Suchwort hinzugefügt.');
        await renderAdminNotes(true);
        await renderAdminWords();
        await loadSearchCache();
      });
    }
    await loadAuthState();
    if (await checkAdmin()) {
      byId('adminStatus').textContent = 'Admin aktiv.';
      await renderAdminNotes(true);
      await renderAdminWords();
    } else if (currentUser) {
      byId('adminStatus').textContent = 'Eingeloggt, aber keine Admin-Rolle.';
    } else {
      byId('adminStatus').textContent = 'Bitte als Admin einloggen.';
    }
  }

  async function setupAuthPages() {
    logEvent('INFO', 'setupAuthPages gestartet');
    const client = await ensureSupabaseClient();
    if (!client) {
      logEvent('ERROR', 'setupAuthPages: Supabase Client fehlt');
      if (byId('loginStatus')) byId('loginStatus').textContent = 'Supabase-Verbindung fehlt. Bitte Konfiguration prüfen.';
      if (byId('registerStatus')) byId('registerStatus').textContent = 'Supabase-Verbindung fehlt. Bitte Konfiguration prüfen.';
      return;
    }
    logEvent('INFO', 'setupAuthPages: Supabase Client verfügbar');
    const loginBtn = byId('loginSubmit');
    if (loginBtn) {
      logEvent('INFO', 'Login-Button gefunden und Event gebunden');
      loginBtn.addEventListener('click', async () => {
        logEvent('INFO', 'Login-Klick erkannt');
        const done = setBusy(loginBtn, 'Prüft…');
        const email = byId('loginEmail')?.value || '';
        const password = byId('loginPassword')?.value || '';
        if (!email.trim() || !password.trim()) {
          done();
          if (byId('loginStatus')) byId('loginStatus').textContent = 'Bitte E-Mail und Passwort eingeben.';
          return;
        }
        logEvent('INFO', 'Login-Request wird gesendet', email.trim());
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          done();
          logEvent('ERROR', 'Login fehlgeschlagen', normalizeSupabaseError(error));
          if (byId('loginStatus')) byId('loginStatus').textContent = `Fehler: ${normalizeSupabaseError(error)}`;
          return;
        }
        await loadAuthState();
        done();
        logEvent('INFO', 'Login erfolgreich', currentUser?.email || email);
        if (byId('loginStatus')) byId('loginStatus').textContent = `Anmeldung erfolgreich. Rolle: ${currentRole} · User: ${currentDisplayName || currentUser?.email || email}`;
        window.location.href = `${rootPath()}`;
      });
    } else {
      logEvent('WARN', 'Login-Button nicht gefunden');
    }
    const registerBtn = byId('registerSubmit');
    if (registerBtn) {
      logEvent('INFO', 'Register-Button gefunden und Event gebunden');
      registerBtn.addEventListener('click', async () => {
        logEvent('INFO', 'Register-Klick erkannt');
        const done = setBusy(registerBtn, 'Erstellt…');
        const email = byId('registerEmail')?.value || '';
        const password = byId('registerPassword')?.value || '';
        if (!email.trim() || !password.trim()) {
          done();
          if (byId('registerStatus')) byId('registerStatus').textContent = 'Bitte E-Mail und Passwort eingeben.';
          return;
        }
        if (password.length < 6) {
          done();
          if (byId('registerStatus')) byId('registerStatus').textContent = 'Passwort muss mindestens 6 Zeichen haben.';
          return;
        }
        const { error } = await client.auth.signUp({ email, password });
        if (error) {
          done();
          logEvent('ERROR', 'Registrierung fehlgeschlagen', normalizeSupabaseError(error));
          if (byId('registerStatus')) byId('registerStatus').textContent = `Fehler: ${normalizeSupabaseError(error)}`;
          return;
        }
        done();
        logEvent('INFO', 'Registrierung erfolgreich ausgelöst', email.trim());
        if (byId('registerStatus')) byId('registerStatus').textContent = 'Registrierung erfolgreich. Bitte E-Mail bestätigen.';
      });
    }
    const registerInlineBtn = byId('registerSubmitInline');
    if (registerInlineBtn) {
      registerInlineBtn.addEventListener('click', async () => {
        const done = setBusy(registerInlineBtn, 'Erstellt…');
        const email = byId('registerEmailInline')?.value || '';
        const password = byId('registerPasswordInline')?.value || '';
        if (!email.trim() || !password.trim()) {
          done();
          setText('adminStatus', 'Für Registrierung E-Mail und Passwort eingeben.');
          return;
        }
        const { error } = await client.auth.signUp({ email, password });
        done();
        if (error) {
          setText('adminStatus', `Registrierung fehlgeschlagen: ${normalizeSupabaseError(error)}`);
          return;
        }
        setText('adminStatus', 'Registrierung erfolgreich. Bitte E-Mail bestätigen.');
      });
    }
  }

  async function setupCreateWorkspaces() {
    const client = await ensureSupabaseClient();
    if (!client) return;
    const createModuleBtn = byId('createModuleBtn');
    if (!isAuthenticatedUser()) {
      setText('moduleCreateStatus', 'Bitte anmelden, um ein Modul zu erstellen.');
      if (createModuleBtn) createModuleBtn.disabled = false;
    }
    if (createModuleBtn) {
      document.querySelectorAll('.create-section-format').forEach((btn) => {
        btn.onclick = () => {
          const target = btn.dataset.target;
          const cmd = btn.dataset.cmd;
          const editor = target ? byId(target) : null;
          if (!editor || !cmd) return;
          editor.focus();
          document.execCommand(cmd, false);
        };
      });
      createModuleBtn.onclick = async () => {
        if (!(await ensureWriteAccess('moduleCreateStatus'))) return;
        logEvent('INFO', 'Create module clicked');
        const done = setBusy(createModuleBtn, 'Erstellt…');
        const title = byId('newModuleTitle')?.value?.trim() || '';
        const description = byId('newModuleDescription')?.value?.trim() || '';
        const introHtml = byId('newModuleIntro')?.innerHTML?.trim() || '';
        const mainHtml = byId('newModuleMain')?.innerHTML?.trim() || '';
        const conclusionHtml = byId('newModuleConclusion')?.innerHTML?.trim() || '';
        const content = [introHtml, mainHtml, conclusionHtml].filter(Boolean).join('<hr/>');
        const topic = byId('newModuleTopic')?.value?.trim() || '';
        if (!title || !description) {
          done();
          setText('moduleCreateStatus', 'Titel und Kurzbeschreibung sind erforderlich.');
          return;
        }
        const payload = {
          title,
          description,
          content,
          topic,
          difficulty: 'Grundlagen',
          user_id: currentUser?.id || null,
          is_published: true
        };
        const { data: inserted, error } = await client.from('modules').insert(payload).select('id').single();
        if (error || !inserted?.id) {
          done();
          const errText = normalizeSupabaseError(error);
          if (errText.toLowerCase().includes('column') && (errText.toLowerCase().includes('title') || errText.toLowerCase().includes('description') || errText.toLowerCase().includes('content'))) {
            setText('moduleCreateStatus', 'Erstellen fehlgeschlagen: Module-Tabelle ist nicht aktuell. Bitte das neueste SQL vollständig ausführen.');
          } else {
            setText('moduleCreateStatus', `Erstellen fehlgeschlagen: ${errText}`);
          }
          return;
        }
        const sectionRows = [
          { module_id: inserted.id, type: 'anfang', title: 'Anfang', content: introHtml || description },
          { module_id: inserted.id, type: 'hauptteil', title: 'Hauptteil', content: mainHtml || '' },
          { module_id: inserted.id, type: 'schluss', title: 'Schluss', content: conclusionHtml || '' }
        ];
        const { error: sectionError } = await client.from('module_sections').insert(sectionRows);
        done();
        if (sectionError) {
          await client.from('modules').delete().eq('id', inserted.id);
          setText('moduleCreateStatus', `Modul konnte nicht vollständig erstellt werden: ${normalizeSupabaseError(sectionError)}`);
          return;
        }
        setText('moduleCreateStatus', `✅ Modul erfolgreich erstellt (ID: ${inserted.id}).`);
        byId('newModuleTitle').value = '';
        byId('newModuleDescription').value = '';
        if (byId('newModuleIntro')) byId('newModuleIntro').innerHTML = '';
        if (byId('newModuleMain')) byId('newModuleMain').innerHTML = '';
        if (byId('newModuleConclusion')) byId('newModuleConclusion').innerHTML = '';
        byId('newModuleTopic').value = '';
        await renderCollection('modules', 'moduleGrid', 'moduleHighlights');
        const next = `${rootPath()}zusammenfassungen/?id=${encodeURIComponent(inserted.id)}`;
        window.location.href = next;
      };
    }
    const createDeckBtn = byId('createDeckBtn');
    if (createDeckBtn) {
      createDeckBtn.onclick = async () => {
        if (!(await ensureWriteAccess('deckCreateStatus'))) return;
        logEvent('INFO', 'Create deck clicked');
        const done = setBusy(createDeckBtn, 'Erstellt…');
        const title = byId('newDeckTitle')?.value?.trim() || '';
        const theme = byId('newDeckTheme')?.value?.trim() || '';
        if (!title) {
          done();
          setText('deckCreateStatus', 'Deck Titel ist erforderlich.');
          return;
        }
        const { error } = await client.from('decks').insert({ title, theme, user_id: currentUser?.id || null, is_published: true });
        done();
        if (error) {
          setText('deckCreateStatus', `Erstellen fehlgeschlagen: ${normalizeSupabaseError(error)}`);
          return;
        }
        setText('deckCreateStatus', 'Deck erstellt.');
        byId('newDeckTitle').value = '';
        byId('newDeckTheme').value = '';
        await renderCollection('decks', 'deckGrid', 'deckHighlights', 'title', 'theme');
      };
    }
    const createQuizBtn = byId('createQuizBtn');
    if (createQuizBtn) {
      createQuizBtn.onclick = async () => {
        if (!(await ensureWriteAccess('quizCreateStatus'))) return;
        logEvent('INFO', 'Create quiz clicked');
        const done = setBusy(createQuizBtn, 'Erstellt…');
        const title = byId('newQuizTitle')?.value?.trim() || '';
        const description = byId('newQuizDescription')?.value?.trim() || '';
        const difficulty = byId('newQuizDifficulty')?.value?.trim() || 'Grundlagen';
        if (!title) {
          done();
          setText('quizCreateStatus', 'Quiz Titel ist erforderlich.');
          return;
        }
        const payload = { title, description, difficulty, user_id: currentUser?.id || null, is_published: true };
        const { error } = await client.from('quizzes').insert(payload);
        done();
        if (error) {
          setText('quizCreateStatus', `Erstellen fehlgeschlagen: ${normalizeSupabaseError(error)}`);
          return;
        }
        setText('quizCreateStatus', 'Quiz erstellt.');
        byId('newQuizTitle').value = '';
        byId('newQuizDescription').value = '';
        byId('newQuizDifficulty').value = '';
        await renderCollection('quizzes', 'quizGrid', 'quizHighlights');
      };
    }
  }

  async function boot() {
    installRuntimeErrorHandlers();
    logEvent('INFO', 'Cloud4 boot gestartet');
    const safe = async (fn) => {
      try {
        await fn();
      } catch (error) {
        logEvent('ERROR', 'Cloud4 init step failed', error?.message || error);
      }
    };
    const client = await ensureSupabaseClient();
    logEvent('INFO', 'Supabase Konfiguration', `configured=${isConfigured()} client=${Boolean(client)}`);
    if (!client && isConfigured()) {
      setText('loginStatus', 'Supabase Script konnte nicht geladen werden.');
      setText('registerStatus', 'Supabase Script konnte nicht geladen werden.');
      setText('adminStatus', 'Supabase Script konnte nicht geladen werden.');
    }
    bindAuthListener();
    bindGlobalLogout();
    await safe(loadAuthState);
    await safe(loadMetrics);
    await safe(loadSearchCache);
    await safe(renderHome);
    await safe(renderSpiele);
    await safe(() => renderCollection('modules', 'moduleGrid', 'moduleHighlights'));
    await safe(() => renderCollection('decks', 'deckGrid', 'deckHighlights', 'title', 'theme'));
    await safe(() => renderCollection('quizzes', 'quizGrid', 'quizHighlights'));
    await safe(() => renderCollection('documents', 'pipelineGrid', '', 'title', 'upload_date'));
    await safe(renderModuleDetail);
    await safe(renderDeckDetail);
    await safe(renderQuizDetail);
    await safe(renderVernetzen);
    await safe(renderNetworkWorkspace);
    await safe(renderKonto);
    await safe(renderMitschrift);
    await safe(setupAdminPage);
    await safe(setupAuthPages);
    await safe(setupCreateWorkspaces);
  }

  return {
    boot,
    search,
    getTickerLines,
    getScoreChips,
    get cachedSearchResults() {
      return cachedSearchResults;
    }
  };
})();

window.Cloud4 = Cloud4;
window.addEventListener('DOMContentLoaded', () => {
  Cloud4.boot();
});
