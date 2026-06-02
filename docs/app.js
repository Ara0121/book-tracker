'use strict';
import { bookStore, metaStore } from './store.js';
import { verifyRepo, fetchBooksJson } from './github.js';
import { extractISBN, lookupISBN, searchTitle, hasCJK } from './openlibrary.js';
import { scheduleSync, flush, pullAndMerge } from './sync.js';
import { renderDiscover } from './discover.js';
import { renderStats } from './stats.js';

// ── State ─────────────────────────────────────────────────────────────────────

const S = {
  screen:   'loading',   // loading | settings | home | add | detail | discover
  detailId: null,
  filter:   { lang: 'all', query: '' },
  syncing:  false,
  syncMsg:  '',
  collapsed: { want_to_read: false, reading: false, read: false },
};

// ── Utils ─────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function uuid() { return crypto.randomUUID(); }

function now() { return new Date().toISOString(); }

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ja-JP', { year:'numeric', month:'short', day:'numeric' });
}

function stars(n, max = 5) {
  return '★'.repeat(n || 0) + '☆'.repeat(max - (n || 0));
}

function coverPlaceholder(title, status) {
  const colors = { want_to_read: '#7c3aed', reading: '#d97706', read: '#16a34a' };
  const bg = colors[status] || '#7c3aed';
  const letter = esc((title || '?')[0].toUpperCase());
  return `<div class="book-cover-placeholder" style="background:${bg}">${letter}</div>`;
}

function coverImg(url, cls = 'book-cover') {
  if (!url) return '';
  return `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy"
    onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='flex')">`;
}

// ── Navigation ────────────────────────────────────────────────────────────────

function go(screen, extra = {}) {
  Object.assign(S, { screen, ...extra });
  render();
  window.scrollTo(0, 0);
}

// ── Root render ───────────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById('app');
  if (S.screen === 'loading')  { app.innerHTML = renderLoading();  return; }
  if (S.screen === 'settings') { app.innerHTML = renderSettings(); bindSettings(); return; }
  if (S.screen === 'home')     { renderHome(app); return; }
  if (S.screen === 'add')      { app.innerHTML = renderAdd();      bindAdd();     return; }
  if (S.screen === 'detail')   { renderDetail(app); return; }
  if (S.screen === 'discover') { launchDiscover(app); return; }
  if (S.screen === 'stats')    { launchStats(app);    return; }
}

// ── Sync indicator ────────────────────────────────────────────────────────────

function syncBadgeHTML() {
  if (!navigator.onLine)  return `<span class="sync-badge offline">Offline</span>`;
  if (S.syncing)           return `<span class="sync-badge syncing">Syncing…</span>`;
  if (S.syncError)         return `<span class="sync-badge error" title="${esc(S.syncError)}">Sync ✕</span>`;
  return `<span class="sync-badge synced">Synced ✓</span>`;
}

window.addEventListener('bt:synced',     () => { S.syncing = false; S.syncError = null;  refreshSyncBadge(); });
window.addEventListener('bt:sync-error', e  => { S.syncing = false; S.syncError = e.detail; refreshSyncBadge(); });
window.addEventListener('online',  refreshSyncBadge);
window.addEventListener('offline', refreshSyncBadge);

function refreshSyncBadge() {
  const el = document.getElementById('sync-badge');
  if (el) el.outerHTML = syncBadgeHTML();
}

// ── Screen: Loading ───────────────────────────────────────────────────────────

function renderLoading() {
  return `<div class="loading-screen">
    <div class="spinner"></div>
    <span>Loading…</span>
  </div>`;
}

// ── Screen: Settings ─────────────────────────────────────────────────────────

function renderSettings() {
  return `<div class="screen">
    <header class="app-header">
      <h1 class="header-title">Book<span>Kit</span> Setup</h1>
    </header>
    <div class="settings-body">
      <p class="settings-intro">
        BookKit stores your reading data in a <strong>private GitHub repo</strong> you own.
        It never leaves your GitHub account. Enter a fine-grained token and your data repo below.
      </p>
      <div class="form-group">
        <label class="form-label" for="pat-input">GitHub Personal Access Token</label>
        <input id="pat-input" class="form-input" type="password"
          placeholder="github_pat_…" autocomplete="off" autocorrect="off" spellcheck="false">
        <p class="form-hint">
          Create at <strong>github.com → Settings → Developer settings → Fine-grained tokens</strong>.
          Scope: your data repo only, <em>Contents: Read and write</em>.
        </p>
      </div>
      <div class="form-group">
        <label class="form-label" for="repo-input">Data repo</label>
        <input id="repo-input" class="form-input" type="text"
          placeholder="username/book-data" autocapitalize="none" autocorrect="off" spellcheck="false">
        <p class="form-hint">Format: <strong>owner/repo-name</strong>. Must be a private repo you created.</p>
      </div>
      <div id="settings-error"></div>
      <button id="connect-btn" class="primary-btn">Connect →</button>
    </div>
  </div>`;
}

function bindSettings() {
  const btn     = document.getElementById('connect-btn');
  const errBox  = document.getElementById('settings-error');
  const patEl   = document.getElementById('pat-input');
  const repoEl  = document.getElementById('repo-input');

  // Pre-fill saved values
  Promise.all([metaStore.get('pat'), metaStore.get('repo')]).then(([p, r]) => {
    if (p) patEl.value = p;
    if (r) repoEl.value = r;
  });

  btn.addEventListener('click', async () => {
    const pat  = patEl.value.trim();
    const repo = repoEl.value.trim();
    errBox.innerHTML = '';

    if (!pat || !repo) {
      errBox.innerHTML = `<div class="error-box">Please fill in both fields.</div>`;
      return;
    }
    if (!/^[^/]+\/[^/]+$/.test(repo)) {
      errBox.innerHTML = `<div class="error-box">Repo must be in owner/repo format.</div>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Connecting…';

    try {
      await verifyRepo(pat, repo);
      await metaStore.set('pat', pat);
      await metaStore.set('repo', repo);

      // Pull existing data or initialise
      const { data, sha } = await fetchBooksJson(pat, repo);
      if (sha) await metaStore.set('sha', sha);
      if (data?.books) {
        await bookStore.clear();
        for (const b of data.books) await bookStore.put(b);
      }

      go('home');
    } catch (err) {
      errBox.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Connect →';
    }
  });
}

// ── Screen: Home ─────────────────────────────────────────────────────────────

async function renderHome(app) {
  const allBooks = await bookStore.getAll();
  const pending  = await metaStore.get('pending');
  if (pending && !S.syncing) { S.syncing = true; }

  // Apply filters
  const q = S.filter.query.toLowerCase();
  const filtered = allBooks.filter(b => {
    if (S.filter.lang !== 'all' && b.language !== S.filter.lang) return false;
    if (q && !b.title.toLowerCase().includes(q) && !(b.author || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const byStatus = s => filtered.filter(b => b.status === s)
    .sort((a, b) => (b.date_added || '') > (a.date_added || '') ? 1 : -1);

  const want    = byStatus('want_to_read');
  const reading = byStatus('reading');
  const read    = byStatus('read');

  // Monthly goal
  const nowD       = new Date();
  const monthKey   = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,'0')}`;
  const goalTarget = (await metaStore.get('goal_count')) || 0;
  const monthDone  = allBooks.filter(b =>
    b.status === 'read' && (b.date_finished || '').startsWith(monthKey)
  ).length;
  const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth()+1, 0).getDate();
  const daysLeft    = daysInMonth - nowD.getDate();
  const elapsedFrac = nowD.getDate() / daysInMonth;
  const onTrack     = goalTarget === 0 || monthDone >= Math.floor(elapsedFrac * goalTarget);
  const goalPct     = goalTarget > 0 ? Math.min(monthDone / goalTarget, 1) : 0;
  const r = 28, circ = +(2 * Math.PI * r).toFixed(2);
  const ringColor   = goalPct >= 1 ? '#16a34a' : onTrack ? '#7c3aed' : '#d97706';
  const ringOffset  = +(circ * (1 - goalPct)).toFixed(2);

  // Quote of the day (deterministic per day)
  const booksWithQuotes = allBooks.filter(b => b.quotes?.length);
  let quoteHTML = '';
  if (booksWithQuotes.length) {
    const day = Math.floor(Date.now() / 86400000);
    const book = booksWithQuotes[day % booksWithQuotes.length];
    const quote = book.quotes[day % book.quotes.length];
    quoteHTML = `<div class="quote-widget">
      <span class="quote-mark">❝</span>
      <div class="quote-inner">
        <p class="quote-text">${esc(quote)}</p>
        <p class="quote-source">— ${esc(book.title)}</p>
      </div>
    </div>`;
  }

  const sections = [
    { key: 'want_to_read', icon: '📚', label: 'Want to Read', items: want    },
    { key: 'reading',      icon: '📖', label: 'Reading',      items: reading },
    { key: 'read',         icon: '✅', label: 'Read',          items: read   },
  ];

  app.innerHTML = `
  <div class="screen">
    <header class="app-header">
      <h1 class="header-title">Book<span>Kit</span></h1>
      <span id="sync-badge">${syncBadgeHTML()}</span>
      <button class="icon-btn" id="stats-btn"    title="Stats">📊</button>
      <button class="icon-btn" id="discover-btn" title="Discover books">🔍</button>
      <button class="icon-btn" id="settings-btn" title="Settings">⚙️</button>
    </header>
    <div class="home-body">
      <!-- Monthly goal ring -->
      <div class="goal-widget">
        <svg class="goal-ring" viewBox="0 0 70 70">
          <circle cx="35" cy="35" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="6"/>
          <circle cx="35" cy="35" r="${r}" fill="none" stroke="${ringColor}" stroke-width="6"
            stroke-dasharray="${circ}" stroke-dashoffset="${ringOffset}"
            stroke-linecap="round" transform="rotate(-90 35 35)"
            style="transition:stroke-dashoffset 0.6s ease"/>
          <text x="35" y="32" text-anchor="middle" font-size="14" font-weight="800"
            fill="#1c1917">${monthDone}</text>
          <text x="35" y="44" text-anchor="middle" font-size="9" fill="#a8a29e">
            of ${goalTarget || '?'}
          </text>
        </svg>
        <div class="goal-info">
          <div class="goal-title">
            ${nowD.toLocaleDateString('en',{month:'long'})} Goal
          </div>
          <div class="goal-sub">
            ${goalTarget > 0
              ? `${daysLeft}d left · <span class="${onTrack?'goal-ok':'goal-behind'}">${onTrack?'On track ✓':'Behind'}</span>`
              : '<span class="goal-unset">Tap ✏️ to set a goal</span>'}
          </div>
        </div>
        <button class="goal-edit-btn" id="goal-edit-btn" title="Edit goal">✏️</button>
      </div>
      <!-- Goal edit panel (hidden by default) -->
      <div class="goal-edit-panel" id="goal-edit-panel" hidden>
        <label class="form-label">Monthly goal (books)</label>
        <div class="input-row" style="margin-top:6px">
          <input id="goal-input" class="form-input" type="number" min="1" max="99"
            placeholder="e.g. 4" value="${goalTarget || ''}">
          <button class="primary-btn" id="goal-save-btn" style="flex-shrink:0;padding:11px 16px">Save</button>
        </div>
      </div>
      ${quoteHTML}
      <div class="filter-bar">
        <input class="search-input" id="search-input" type="search"
          placeholder="Search title or author…" value="${esc(S.filter.query)}">
        <div class="lang-pills">
          <button class="lang-pill ${S.filter.lang==='all'?'active':''}" data-lang="all">All</button>
          <button class="lang-pill ${S.filter.lang==='en'?'active':''}"  data-lang="en">🇬🇧 EN</button>
          <button class="lang-pill ${S.filter.lang==='ja'?'active':''}"  data-lang="ja">🇯🇵 JA</button>
        </div>
      </div>
      <div class="kanban">
        ${sections.map(sec => `
        <div class="status-section ${S.collapsed[sec.key]?'collapsed':''}" data-status="${sec.key}">
          <div class="status-header" data-collapse="${sec.key}">
            <span class="status-icon">${sec.icon}</span>
            <span class="status-label">${sec.label}</span>
            <span class="status-count">${sec.items.length}</span>
            <span class="status-chevron">▾</span>
          </div>
          <div class="status-cards">
            ${sec.items.length ? sec.items.map(b => bookCardHTML(b)).join('') :
              `<p class="empty-section">No books here.</p>`}
          </div>
        </div>`).join('')}
      </div>
    </div>
    <button class="fab" id="add-btn">+</button>
  </div>`;

  // Events
  document.getElementById('add-btn').addEventListener('click', () => go('add'));
  document.getElementById('discover-btn').addEventListener('click', () => go('discover'));
  document.getElementById('stats-btn').addEventListener('click', () => go('stats'));
  document.getElementById('settings-btn').addEventListener('click', () => go('settings'));

  // Goal ring edit
  document.getElementById('goal-edit-btn').addEventListener('click', () => {
    const panel = document.getElementById('goal-edit-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) document.getElementById('goal-input').focus();
  });
  document.getElementById('goal-save-btn').addEventListener('click', async () => {
    const val = parseInt(document.getElementById('goal-input').value, 10);
    if (val > 0) {
      await metaStore.set('goal_count', val);
      renderHome(app);
    }
  });

  document.getElementById('search-input').addEventListener('input', e => {
    S.filter.query = e.target.value;
    renderHome(app);
  });

  document.querySelectorAll('.lang-pill').forEach(btn =>
    btn.addEventListener('click', () => {
      S.filter.lang = btn.dataset.lang;
      renderHome(app);
    })
  );

  document.querySelectorAll('[data-collapse]').forEach(btn =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.collapse;
      S.collapsed[key] = !S.collapsed[key];
      renderHome(app);
    })
  );

  document.querySelectorAll('.book-card').forEach(card =>
    card.addEventListener('click', () => go('detail', { detailId: card.dataset.id }))
  );
}

function bookCardHTML(book) {
  const colors = { want_to_read: '#7c3aed', reading: '#d97706', read: '#16a34a' };
  const bg = colors[book.status] || '#7c3aed';
  const letter = esc((book.title || '?')[0].toUpperCase());

  const coverHTML = book.cover_url
    ? `<img class="book-cover" src="${esc(book.cover_url)}" alt="" loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
       <div class="book-cover-placeholder" style="background:${bg};display:none">${letter}</div>`
    : `<div class="book-cover-placeholder" style="background:${bg}">${letter}</div>`;

  return `<div class="book-card" data-id="${esc(book.id)}">
    <div class="book-cover-wrap">${coverHTML}</div>
    <div class="book-card-body">
      <div class="book-title">${esc(book.title)}</div>
      <div class="book-author">${esc(book.author || '—')}</div>
      ${book.memo ? `<div class="book-memo">${esc(book.memo)}</div>` : ''}
      <div class="book-meta">
        <span class="lang-badge">${book.language === 'ja' ? '🇯🇵' : '🇬🇧'}</span>
        ${book.rating ? `<span class="star-rating">${stars(book.rating)}</span>` : ''}
      </div>
    </div>
  </div>`;
}

// ── Screen: Add Book ─────────────────────────────────────────────────────────

let addState = { results: [], selected: null, status: 'want_to_read', lang: 'en',
                 manualTitle: '', manualAuthor: '' };

function renderAdd() {
  const { results, selected, status, lang } = addState;

  const statusBtns = [
    ['want_to_read', '📚 Want', 'want'],
    ['reading',      '📖 Reading', 'reading'],
    ['read',         '✅ Read', 'read'],
  ].map(([val, lbl, cls]) =>
    `<button class="option-btn ${status===val?'active '+cls:''}" data-status="${val}">${lbl}</button>`
  ).join('');

  const langBtns = [
    ['en', '🇬🇧 English', 'en'],
    ['ja', '🇯🇵 日本語',  'ja'],
  ].map(([val, lbl, cls]) =>
    `<button class="option-btn ${lang===val?'active '+cls:''}" data-lang="${val}">${lbl}</button>`
  ).join('');

  const resultsHTML = results.length ? `
    <p class="add-hint">Tap a result to select it:</p>
    <div class="search-results">
      ${results.map((r, i) => `
        <div class="result-card ${selected===i?'selected':''}" data-idx="${i}">
          ${r.cover_url ? `<img class="result-thumb" src="${esc(r.cover_url)}" alt="" loading="lazy"
            onerror="this.style.display='none'">` : `<div class="result-thumb"></div>`}
          <div class="result-info">
            <div class="result-title">${esc(r.title)}</div>
            <div class="result-author">${esc(r.author || '—')}</div>
            ${r.isbn ? `<div style="font-size:.7rem;color:#a8a29e">ISBN ${esc(r.isbn)}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>` : '';

  const showManual = results.length === 0;

  return `<div class="screen">
    <header class="app-header">
      <button class="back-btn" id="back-btn">← Back</button>
      <h1 class="header-title" style="font-size:.95rem">Add a Book</h1>
    </header>
    <div class="add-body">
      <p class="add-hint">Paste an ISBN, Amazon JP link, or type a title to search.</p>
      <div class="input-row">
        <input id="add-input" class="form-input" type="text"
          placeholder="ISBN, URL, or title…" autocapitalize="none" autocorrect="off">
        <button id="lookup-btn" class="secondary-btn">Look up</button>
      </div>
      <div id="results-area">${resultsHTML}</div>
      ${showManual ? `
      <div class="divider">or enter manually</div>
      <div class="form-group">
        <label class="form-label">Title</label>
        <input id="manual-title" class="form-input" type="text" value="${esc(addState.manualTitle)}">
      </div>
      <div class="form-group">
        <label class="form-label">Author</label>
        <input id="manual-author" class="form-input" type="text" value="${esc(addState.manualAuthor)}">
      </div>` : ''}
      <div class="form-group">
        <div class="form-label">Add to</div>
        <div class="option-group" id="status-btns">${statusBtns}</div>
      </div>
      <div class="form-group">
        <div class="form-label">Language</div>
        <div class="option-group" id="lang-btns">${langBtns}</div>
      </div>
      <div id="add-error"></div>
      <button id="confirm-add-btn" class="primary-btn">Add Book</button>
    </div>
  </div>`;
}

function bindAdd() {
  document.getElementById('back-btn').addEventListener('click', () => {
    addState = { results: [], selected: null, status: 'want_to_read', lang: 'en',
                 manualTitle: '', manualAuthor: '' };
    go('home');
  });

  const lookupBtn = document.getElementById('lookup-btn');
  lookupBtn.addEventListener('click', async () => {
    const raw = document.getElementById('add-input').value.trim();
    if (!raw) return;
    lookupBtn.disabled = true;
    lookupBtn.textContent = '…';

    const isbn = extractISBN(raw);
    let results = [];
    if (isbn) {
      const hit = await lookupISBN(isbn);
      if (hit) results = [hit];
    }
    if (!results.length) {
      results = await searchTitle(raw);
    }

    addState.results  = results;
    addState.selected = results.length === 1 ? 0 : null;
    if (results.length === 1) addState.lang = results[0].language;

    document.getElementById('app').innerHTML = renderAdd();
    bindAdd();
  });

  document.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => {
      addState.selected = parseInt(card.dataset.idx, 10);
      addState.lang = addState.results[addState.selected].language;
      document.getElementById('app').innerHTML = renderAdd();
      bindAdd();
    });
  });

  document.querySelectorAll('[data-status]').forEach(btn =>
    btn.addEventListener('click', () => {
      addState.status = btn.dataset.status;
      document.getElementById('app').innerHTML = renderAdd();
      bindAdd();
    })
  );

  document.querySelectorAll('[data-lang]').forEach(btn =>
    btn.addEventListener('click', () => {
      addState.lang = btn.dataset.lang;
      document.getElementById('app').innerHTML = renderAdd();
      bindAdd();
    })
  );

  // Track manual fields
  const mt = document.getElementById('manual-title');
  const ma = document.getElementById('manual-author');
  if (mt) mt.addEventListener('input', e => { addState.manualTitle  = e.target.value; });
  if (ma) ma.addEventListener('input', e => { addState.manualAuthor = e.target.value; });

  document.getElementById('confirm-add-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('add-error');
    let book;

    if (addState.results.length && addState.selected !== null) {
      const r = addState.results[addState.selected];
      book = { ...r };
    } else {
      const title  = (mt?.value || addState.manualTitle).trim();
      const author = (ma?.value || addState.manualAuthor).trim();
      if (!title) { errEl.innerHTML = `<div class="error-box">Title is required.</div>`; return; }
      book = { title, author, isbn: null, cover_url: null };
    }

    const now_ = now();
    const id   = uuid();
    const finalBook = {
      id,
      title:        book.title,
      author:       book.author || '',
      isbn:         book.isbn   || null,
      cover_url:    book.cover_url || null,
      language:     addState.lang,
      status:       addState.status,
      date_added:   now_,
      date_started: addState.status === 'reading' || addState.status === 'read' ? now_ : null,
      date_finished: addState.status === 'read' ? now_ : null,
      rating:       null,
      memo:         '',
      tags:         [],
    };

    await bookStore.put(finalBook);
    await metaStore.set('pending', true);
    scheduleSync();

    addState = { results: [], selected: null, status: 'want_to_read', lang: 'en',
                 manualTitle: '', manualAuthor: '' };
    go('detail', { detailId: id });
  });
}

// ── Screen: Detail ────────────────────────────────────────────────────────────

async function renderDetail(app) {
  const book = await bookStore.get(S.detailId);
  if (!book) { go('home'); return; }

  const statusBtns = [
    ['want_to_read', '📚 Want'],
    ['reading',      '📖 Reading'],
    ['read',         '✅ Read'],
  ].map(([s, lbl]) =>
    `<button class="status-btn ${book.status===s?'active':''}" data-s="${s}">${lbl}</button>`
  ).join('');

  const starsHTML = Array.from({length:5}, (_, i) =>
    `<span class="star ${(book.rating||0) > i ? 'filled' : ''}" data-star="${i+1}">★</span>`
  ).join('');

  const tagsHTML = (book.tags || []).map(t =>
    `<span class="tag-chip">${esc(t)}<button class="tag-remove" data-tag="${esc(t)}">×</button></span>`
  ).join('');

  const coverHTML = book.cover_url
    ? `${coverImg(book.cover_url, 'detail-cover')}
       <div class="detail-cover-placeholder" style="background:${book.status==='reading'?'#d97706':book.status==='read'?'#16a34a':'#7c3aed'};display:none">
         ${esc((book.title||'?')[0].toUpperCase())}
       </div>`
    : `<div class="detail-cover-placeholder" style="background:${book.status==='reading'?'#d97706':book.status==='read'?'#16a34a':'#7c3aed'}">
         ${esc((book.title||'?')[0].toUpperCase())}
       </div>`;

  app.innerHTML = `<div class="screen">
    <header class="app-header">
      <button class="back-btn" id="back-btn">← Back</button>
      <span id="sync-badge">${syncBadgeHTML()}</span>
    </header>
    <div class="detail-body">
      <div class="detail-hero">
        ${coverHTML}
        <div class="detail-meta">
          <div class="detail-title">${esc(book.title)}</div>
          <div class="detail-author">${esc(book.author || '—')}</div>
          ${book.isbn ? `<div class="detail-isbn">ISBN ${esc(book.isbn)}</div>` : ''}
          <span class="lang-badge">${book.language==='ja'?'🇯🇵 Japanese':'🇬🇧 English'}</span>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">Status</div>
        <div class="status-btns">${statusBtns}</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">Rating</div>
        <div class="stars">${starsHTML}</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">Tags</div>
        <div class="tags-area" id="tags-area">
          ${tagsHTML}
          <input class="tag-input" id="tag-input" placeholder="Add tag…" type="text">
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">Memo</div>
        <textarea class="memo-area" id="memo-area" placeholder="Short note…">${esc(book.memo||'')}</textarea>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">Quotes ❝</div>
        <div class="quotes-list" id="quotes-list">
          ${(book.quotes||[]).map((q,i) => `
            <div class="quote-item" data-idx="${i}">
              <p class="quote-item-text">${esc(q)}</p>
              <button class="quote-delete-btn" data-idx="${i}">×</button>
            </div>`).join('')}
        </div>
        <textarea class="quote-input" id="quote-input"
          placeholder="Paste a memorable quote… (Enter to save)"></textarea>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">Dates</div>
        <div class="dates-grid">
          <div class="date-row">
            <span class="date-label">Added</span>
            <span>${fmtDate(book.date_added)}</span>
          </div>
          <div class="date-row">
            <span class="date-label">Started</span>
            <input class="date-input" id="date-started" type="date"
              value="${(book.date_started||'').slice(0,10)}">
          </div>
          <div class="date-row">
            <span class="date-label">Finished</span>
            <input class="date-input" id="date-finished" type="date"
              value="${(book.date_finished||'').slice(0,10)}">
          </div>
        </div>
      </div>

      <button class="delete-btn" id="delete-btn">Delete book</button>
    </div>
  </div>`;

  // ── Detail event handlers ──────────────────────────────────────────────────

  document.getElementById('back-btn').addEventListener('click', () => go('home'));

  // Auto-save helper
  async function save(patch) {
    const updated = { ...(await bookStore.get(book.id)), ...patch };
    await bookStore.put(updated);
    await metaStore.set('pending', true);
    scheduleSync();
  }

  // Status
  document.querySelectorAll('.status-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      const newStatus = btn.dataset.s;
      const cur = await bookStore.get(book.id);
      const patch = { status: newStatus };
      if (newStatus === 'reading' && !cur.date_started) patch.date_started = now();
      if (newStatus === 'read')    { if (!cur.date_started) patch.date_started = now(); patch.date_finished = patch.date_finished || cur.date_finished || now(); }
      if (newStatus === 'want_to_read') { patch.date_started = null; patch.date_finished = null; }
      await save(patch);
      renderDetail(app);
    })
  );

  // Stars — click to rate, hover to preview
  const starEls = [...document.querySelectorAll('.star')];
  starEls.forEach(star => {
    star.addEventListener('click', async () => {
      const r = parseInt(star.dataset.star, 10);
      await save({ rating: r });
      starEls.forEach((s, i) => s.classList.toggle('filled', i < r));
    });
    star.addEventListener('mouseenter', () => {
      const r = parseInt(star.dataset.star, 10);
      starEls.forEach((s, i) => s.classList.toggle('filled', i < r));
    });
    star.addEventListener('mouseleave', async () => {
      const cur = await bookStore.get(book.id);
      starEls.forEach((s, i) => s.classList.toggle('filled', i < (cur.rating || 0)));
    });
  });

  // Tags
  document.querySelectorAll('.tag-remove').forEach(btn =>
    btn.addEventListener('click', async () => {
      const cur = await bookStore.get(book.id);
      const tags = (cur.tags||[]).filter(t => t !== btn.dataset.tag);
      await save({ tags });
      renderDetail(app);
    })
  );

  const tagInput = document.getElementById('tag-input');
  tagInput.addEventListener('keydown', async e => {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.value.trim()) {
      e.preventDefault();
      const cur = await bookStore.get(book.id);
      const tag = tagInput.value.trim().replace(/,/g,'');
      if (!tag) return;
      const tags = [...new Set([...(cur.tags||[]), tag])];
      await save({ tags });
      renderDetail(app);
    }
  });

  // Memo (debounced)
  let memoTimer = null;
  document.getElementById('memo-area').addEventListener('input', e => {
    clearTimeout(memoTimer);
    memoTimer = setTimeout(() => save({ memo: e.target.value }), 800);
  });

  // Quotes — Ctrl/Cmd+Enter or Shift+Enter to save; × to delete
  const quoteInput = document.getElementById('quote-input');
  quoteInput.addEventListener('keydown', async e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      const text = quoteInput.value.trim();
      if (!text) return;
      const cur = await bookStore.get(book.id);
      await save({ quotes: [...(cur.quotes || []), text] });
      quoteInput.value = '';
      renderDetail(app);
    }
  });

  document.querySelectorAll('.quote-delete-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const cur = await bookStore.get(book.id);
      const quotes = (cur.quotes || []).filter((_, i) => i !== idx);
      await save({ quotes });
      renderDetail(app);
    })
  );

  // Dates
  document.getElementById('date-started').addEventListener('change', e =>
    save({ date_started: e.target.value ? e.target.value + 'T00:00:00.000Z' : null })
  );
  document.getElementById('date-finished').addEventListener('change', e =>
    save({ date_finished: e.target.value ? e.target.value + 'T00:00:00.000Z' : null })
  );

  // Delete
  document.getElementById('delete-btn').addEventListener('click', async () => {
    if (!confirm(`Delete "${book.title}"? This cannot be undone.`)) return;
    await bookStore.delete(book.id);
    await metaStore.set('pending', true);
    await flush();
    go('home');
  });
}

// ── Screen: Stats ────────────────────────────────────────────────────────────

async function launchStats(app) {
  const allBooks = await bookStore.getAll();
  renderStats(app, go, allBooks);
}

// ── Screen: Discover ─────────────────────────────────────────────────────────

async function launchDiscover(app) {
  const allBooks = await bookStore.getAll();
  const existingTitles = new Set(allBooks.map(b => b.title.toLowerCase().trim()));

  async function addBookFn(rec) {
    const id = uuid();
    const book = {
      id,
      title:         rec.title,
      author:        rec.author || '',
      isbn:          rec.isbn   || null,
      cover_url:     rec.cover_url || null,
      language:      rec.language,
      status:        'want_to_read',
      date_added:    now(),
      date_started:  null,
      date_finished: null,
      rating:        null,
      memo:          '',
      tags:          [],
    };
    await bookStore.put(book);
    await metaStore.set('pending', true);
    scheduleSync();
  }

  await renderDiscover(app, go, addBookFn, existingTitles);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  render(); // show loading spinner

  const pat  = await metaStore.get('pat');
  const repo = await metaStore.get('repo');

  if (!pat || !repo) { go('settings'); return; }

  // Pull latest from GitHub (non-blocking on failure → show local data)
  if (navigator.onLine) {
    try { await pullAndMerge(); }
    catch (err) { console.warn('Pull failed, using local data:', err); }
  }

  go('home');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(e => {
      console.warn('SW registration failed:', e);
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
