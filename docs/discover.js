'use strict';

// ── Genre definitions ─────────────────────────────────────────────────────────
// olSubject: Open Library subject slug  (EN trending + loved)
// gEn / gJa: Google Books query string  (EN supplement + all JA)

export const GENRES = [
  { id: 'fiction',   enLabel: 'Fiction',    jaLabel: '小説',     olSubject: 'fiction',                       gEn: 'fiction novel',          gJa: '小説' },
  { id: 'mystery',   enLabel: 'Mystery',    jaLabel: 'ミステリー', olSubject: 'mystery_and_detective_stories', gEn: 'mystery thriller',       gJa: 'ミステリー 推理小説' },
  { id: 'scifi',     enLabel: 'Sci-Fi',     jaLabel: 'SF',       olSubject: 'science_fiction',               gEn: 'science fiction',        gJa: 'SF小説' },
  { id: 'fantasy',   enLabel: 'Fantasy',    jaLabel: 'ファンタジー', olSubject: 'fantasy_fiction',             gEn: 'fantasy',                gJa: 'ファンタジー 異世界' },
  { id: 'biography', enLabel: 'Biography',  jaLabel: '伝記・自伝', olSubject: 'biography',                   gEn: 'biography memoir',       gJa: '伝記 自伝' },
  { id: 'history',   enLabel: 'History',    jaLabel: '歴史',     olSubject: 'history',                       gEn: 'history nonfiction',     gJa: '歴史 歴史小説' },
  { id: 'business',  enLabel: 'Business',   jaLabel: 'ビジネス', olSubject: 'business_economics',            gEn: 'business management',    gJa: 'ビジネス 仕事術' },
  { id: 'selfhelp',  enLabel: 'Self-help',  jaLabel: '自己啓発', olSubject: 'self-help',                     gEn: 'self help personal development', gJa: '自己啓発' },
  { id: 'manga',     enLabel: 'Manga',      jaLabel: '漫画',     olSubject: 'manga',                         gEn: 'manga graphic novel',    gJa: '漫画 コミック' },
  { id: 'philosophy',enLabel: 'Philosophy', jaLabel: '哲学・思想', olSubject: 'philosophy',                  gEn: 'philosophy',             gJa: '哲学 思想' },
];

// ── Session-level cache ───────────────────────────────────────────────────────
// Avoids re-fetching on every screen visit. Key: `${lang}:${genreId}`
const _cache = new Map();

// ── API: Open Library ─────────────────────────────────────────────────────────
// Reliability: Internet Archive (non-profit), runs since 2006.
//   /trending/weekly.json → real borrowing/reading activity on OpenLibrary.org
//   /subjects/{subject}.json?sort=edition_count → edition_count = global reprints
//     across publishers over decades. High count = beloved worldwide.

const OL   = 'https://openlibrary.org';
const OL_C = 'https://covers.openlibrary.org';

async function olTrending() {
  const r = await fetch(`${OL}/trending/weekly.json?limit=10`,
    { signal: AbortSignal.timeout(7000) });
  if (!r.ok) return [];
  const { works = [] } = await r.json();
  return works.map(w => ({
    title:     w.title || '',
    author:    (w.author_name || []).slice(0, 2).join(', '),
    cover_url: w.cover_id ? `${OL_C}/b/id/${w.cover_id}-M.jpg` : null,
    url:       `${OL}${w.key}`,
    language:  'en',
    source:    'Open Library',
    source_url:'https://openlibrary.org',
  }));
}

async function olLovedBySubject(subject) {
  const r = await fetch(
    `${OL}/subjects/${encodeURIComponent(subject)}.json?sort=edition_count&limit=10`,
    { signal: AbortSignal.timeout(7000) }
  );
  if (!r.ok) return [];
  const { works = [] } = await r.json();
  return works.map(w => ({
    title:     w.title || '',
    author:    (w.authors || []).map(a => a.name).slice(0, 2).join(', '),
    cover_url: w.cover_id ? `${OL_C}/b/id/${w.cover_id}-M.jpg` : null,
    url:       `${OL}${w.key}`,
    language:  'en',
    source:    'Open Library',
    source_url:'https://openlibrary.org',
    editions:  w.edition_count,
  }));
}

// ── API: Google Books ─────────────────────────────────────────────────────────
// Reliability: Google's index of 40M+ titles. Publisher-submitted metadata.
//   langRestrict=ja gives reliable Japanese-language filtering.
//   orderBy=newest  → recent releases (used as "new releases" signal for JA).
//   orderBy=relevance → most relevant/popular results for a genre.
//   No API key needed at personal-app scale (<1 000 requests/day).

const GB = 'https://www.googleapis.com/books/v1/volumes';

async function googleBooks(query, langRestrict, orderBy = 'relevance') {
  const url = `${GB}?q=${encodeURIComponent(query)}&langRestrict=${langRestrict}` +
    `&orderBy=${orderBy}&maxResults=10&printType=books`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return [];
    const { items = [] } = await r.json();
    return items.map(item => {
      const info = item.volumeInfo || {};
      const isbn = (info.industryIdentifiers || [])
        .find(i => i.type === 'ISBN_13')?.identifier ||
        (info.industryIdentifiers || [])
        .find(i => i.type === 'ISBN_10')?.identifier || null;
      return {
        title:     info.title || '',
        author:    (info.authors || []).slice(0, 2).join(', '),
        cover_url: info.imageLinks?.thumbnail?.replace('http:', 'https:') ||
                   info.imageLinks?.smallThumbnail?.replace('http:', 'https:') || null,
        url:       info.infoLink || `https://books.google.com/books?id=${item.id}`,
        language:  langRestrict,
        source:    'Google Books',
        source_url:'https://books.google.com',
        rating:    info.averageRating || null,
        ratings_n: info.ratingsCount  || 0,
        isbn,
      };
    });
  } catch { return []; }
}

// ── Fetch both sections for a lang+genre combination ─────────────────────────

async function fetchRecommendations(lang, genre) {
  const key = `${lang}:${genre.id}`;
  if (_cache.has(key)) return _cache.get(key);

  let trending = [], loved = [];

  if (lang === 'en') {
    // Trending: Open Library real-time data (genre-agnostic global trending,
    // filtered by subject if a non-Fiction genre is selected)
    if (genre.id === 'fiction') {
      [trending, loved] = await Promise.all([
        olTrending(),
        olLovedBySubject(genre.olSubject),
      ]);
    } else {
      // For non-fiction genres, OL trending is global so use Google "newest" for trending
      [trending, loved] = await Promise.all([
        googleBooks(`subject:${genre.gEn}`, 'en', 'newest'),
        olLovedBySubject(genre.olSubject),
      ]);
    }
  } else {
    // JA: Google Books with langRestrict=ja
    // "Trending" = newest Japanese releases in the genre
    // "Loved"    = relevance-ranked (surfaces popular/classic titles)
    [trending, loved] = await Promise.all([
      googleBooks(`subject:${genre.gJa}`, 'ja', 'newest'),
      googleBooks(`subject:${genre.gJa}`, 'ja', 'relevance'),
    ]);
    // Deduplicate loved vs trending by title
    const tTitles = new Set(trending.map(b => b.title.toLowerCase()));
    loved = loved.filter(b => !tTitles.has(b.title.toLowerCase()));
  }

  const result = { trending: trending.slice(0, 8), loved: loved.slice(0, 8) };
  _cache.set(key, result);
  return result;
}

// ── Render helpers ────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function recCardHTML(book, alreadyAdded) {
  const colors = { en: '#2563eb', ja: '#dc2626' };
  const bg     = colors[book.language] || '#64748b';
  const letter = esc((book.title || '?')[0].toUpperCase());

  const coverHTML = book.cover_url
    ? `<img class="rec-cover" src="${esc(book.cover_url)}" alt="" loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
       <div class="rec-cover-placeholder" style="background:${bg};display:none">${letter}</div>`
    : `<div class="rec-cover-placeholder" style="background:${bg}">${letter}</div>`;

  const ratingHTML = book.rating
    ? `<span class="rec-rating">★ ${book.rating.toFixed(1)}</span>` : '';

  const editionHTML = book.editions
    ? `<span class="rec-editions">${book.editions.toLocaleString()} eds</span>` : '';

  return `<div class="rec-card">
    <div class="rec-cover-wrap">
      ${coverHTML}
      <a class="rec-source-badge" href="${esc(book.source_url)}" target="_blank" rel="noopener">
        ${esc(book.source)}
      </a>
    </div>
    <div class="rec-body">
      <div class="rec-title">${esc(book.title)}</div>
      <div class="rec-author">${esc(book.author || '—')}</div>
      <div class="rec-meta">${ratingHTML}${editionHTML}</div>
      <div class="rec-actions">
        <a class="rec-link-btn" href="${esc(book.url)}" target="_blank" rel="noopener">View ↗</a>
        <button class="rec-add-btn ${alreadyAdded ? 'added' : ''}"
          data-title="${esc(book.title)}"
          data-author="${esc(book.author || '')}"
          data-cover="${esc(book.cover_url || '')}"
          data-lang="${esc(book.language)}"
          data-isbn="${esc(book.isbn || '')}"
          ${alreadyAdded ? 'disabled' : ''}>
          ${alreadyAdded ? '✓ In library' : '+ Want to read'}
        </button>
      </div>
    </div>
  </div>`;
}

function sectionHTML(heading, icon, books, existingTitles) {
  if (!books.length) return '';
  const cardsHTML = books.map(b => {
    const norm = b.title.toLowerCase().trim();
    return recCardHTML(b, existingTitles.has(norm));
  }).join('');
  return `<div class="rec-section">
    <h2 class="rec-section-heading"><span>${icon}</span> ${esc(heading)}</h2>
    <div class="rec-grid">${cardsHTML}</div>
  </div>`;
}

// ── Main render export ────────────────────────────────────────────────────────

export async function renderDiscover(container, navigate, addBookFn, existingTitles) {
  // discoverState is held inside this call — genre/lang preserved via re-render args
  let lang  = 'en';
  let genre = GENRES[0];

  async function paint(loading = false) {
    const genrePills = GENRES.map(g =>
      `<button class="genre-pill ${g.id === genre.id ? 'active' : ''}" data-genre="${g.id}">
         ${lang === 'ja' ? esc(g.jaLabel) : esc(g.enLabel)}
       </button>`
    ).join('');

    const trendLabel = lang === 'ja' ? '🆕 New Releases' : '⚡ Trending This Week';
    const lovedLabel = lang === 'ja' ? '💛 Long-loved Picks' : '💛 Timeless Classics';

    container.innerHTML = `<div class="screen">
      <header class="app-header">
        <button class="back-btn" id="disc-back">← Back</button>
        <h1 class="header-title">Book<span>Kit</span> Discover</h1>
      </header>
      <div class="discover-body">
        <div class="disc-lang-row">
          <button class="disc-lang-btn ${lang==='en'?'active':''}" data-lang="en">🇬🇧 English</button>
          <button class="disc-lang-btn ${lang==='ja'?'active':''}" data-lang="ja">🇯🇵 日本語</button>
        </div>
        <div class="genre-pills-wrap">
          <div class="genre-pills">${genrePills}</div>
        </div>
        <div id="disc-content">
          ${loading ? `<div class="disc-loading"><div class="spinner"></div><span>Fetching recommendations…</span></div>` : ''}
        </div>
        <div class="disc-sources">
          <p class="disc-sources-heading">📚 Sources</p>
          <p class="disc-sources-text">
            <strong>Open Library</strong> (openlibrary.org) — run by Internet Archive (non-profit).
            Trending data reflects actual reading/borrowing activity. Edition count ranks books
            by how many times they've been reprinted globally — a reliable signal of lasting love.
          </p>
          <p class="disc-sources-text">
            <strong>Google Books</strong> — 40M+ title index with publisher metadata.
            Used for Japanese-language filtering (<em>langRestrict=ja</em>) and reader ratings.
            "New Releases" uses <em>orderBy=newest</em>; picks use <em>orderBy=relevance</em>.
          </p>
        </div>
      </div>
    </div>`;

    document.getElementById('disc-back').addEventListener('click', () => navigate('home'));

    document.querySelectorAll('.disc-lang-btn').forEach(btn =>
      btn.addEventListener('click', () => { lang = btn.dataset.lang; paint(true); load(); })
    );

    document.querySelectorAll('.genre-pill').forEach(btn =>
      btn.addEventListener('click', () => {
        genre = GENRES.find(g => g.id === btn.dataset.genre) || genre;
        paint(true);
        load();
      })
    );
  }

  async function load() {
    try {
      const { trending, loved } = await fetchRecommendations(lang, genre);
      const contentEl = document.getElementById('disc-content');
      if (!contentEl) return; // user navigated away

      const tLabel = lang === 'ja' ? '🆕 New Releases' : '⚡ Trending This Week';
      const lLabel = lang === 'ja' ? '💛 Long-loved Picks' : '💛 Timeless Classics';

      contentEl.innerHTML =
        sectionHTML(tLabel, '', trending, existingTitles) +
        sectionHTML(lLabel, '', loved,    existingTitles) +
        (!trending.length && !loved.length
          ? `<p class="disc-empty">No results found. Try a different genre.</p>` : '');

      // Wire up "Add to library" buttons
      contentEl.querySelectorAll('.rec-add-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', async () => {
          await addBookFn({
            title:     btn.dataset.title,
            author:    btn.dataset.author,
            cover_url: btn.dataset.cover || null,
            language:  btn.dataset.lang,
            isbn:      btn.dataset.isbn   || null,
          });
          existingTitles.add(btn.dataset.title.toLowerCase().trim());
          btn.textContent  = '✓ In library';
          btn.disabled     = true;
          btn.classList.add('added');
        });
      });

    } catch (err) {
      const contentEl = document.getElementById('disc-content');
      if (contentEl) contentEl.innerHTML =
        `<p class="disc-error">Could not load recommendations: ${esc(err.message)}</p>`;
    }
  }

  await paint(true);
  load(); // async, updates #disc-content when ready
}
