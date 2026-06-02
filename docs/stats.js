'use strict';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Calculations ──────────────────────────────────────────────────────────────

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en', { month: 'short' });
}

function last6Months() {
  const result = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(monthKey(d));
  }
  return result;
}

function calcMonthly(books) {
  const months = last6Months();
  const counts = Object.fromEntries(months.map(m => [m, 0]));
  for (const b of books) {
    if (b.status === 'read' && b.date_finished) {
      const k = b.date_finished.slice(0, 7);
      if (k in counts) counts[k]++;
    }
  }
  return months.map(k => ({ key: k, label: monthLabel(k), count: counts[k] }));
}

function calcStreak(books) {
  // Consecutive months ending this month with ≥1 book finished
  const finished = new Set(
    books.filter(b => b.status === 'read' && b.date_finished)
         .map(b => b.date_finished.slice(0, 7))
  );
  let streak = 0;
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();
  while (true) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    if (!finished.has(key)) break;
    streak++;
    m--;
    if (m < 0) { m = 11; y--; }
    if (streak > 36) break; // safety cap
  }
  return streak;
}

function calcRecords(books) {
  const read = books.filter(b => b.status === 'read');
  if (!read.length) return null;

  // Fastest finish (days between date_started and date_finished)
  let fastest = null, fastestBook = null;
  for (const b of read) {
    if (b.date_started && b.date_finished) {
      const days = Math.max(1, Math.round(
        (new Date(b.date_finished) - new Date(b.date_started)) / 86400000
      ));
      if (fastest === null || days < fastest) { fastest = days; fastestBook = b; }
    }
  }

  // Most productive month (all time)
  const allMonths = {};
  for (const b of read) {
    if (b.date_finished) {
      const k = b.date_finished.slice(0, 7);
      allMonths[k] = (allMonths[k] || 0) + 1;
    }
  }
  let bestMonth = null, bestMonthCount = 0;
  for (const [k, v] of Object.entries(allMonths)) {
    if (v > bestMonthCount) { bestMonthCount = v; bestMonth = k; }
  }

  return { total: read.length, fastest, fastestBook, bestMonth, bestMonthCount };
}

function calcGenres(books) {
  const counts = {};
  for (const b of books) {
    for (const tag of (b.tags || [])) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
}

function calcLang(books) {
  const read = books.filter(b => b.status === 'read');
  const en = read.filter(b => b.language === 'en').length;
  const ja = read.filter(b => b.language === 'ja').length;
  return { en, ja, total: read.length };
}

// ── Bar chart (CSS flex — responsive, no SVG maths) ──────────────────────────

function barChartHTML(monthly) {
  const max = Math.max(...monthly.map(m => m.count), 1);
  const bars = monthly.map(m => {
    const pct = Math.round((m.count / max) * 100);
    const isCurrent = m.key === monthKey(new Date());
    return `<div class="bar-col">
      <div class="bar-count-label">${m.count > 0 ? m.count : ''}</div>
      <div class="bar-track">
        <div class="bar-fill ${isCurrent ? 'current' : ''}"
          style="height:${pct}%"></div>
      </div>
      <div class="bar-month-label">${esc(m.label)}</div>
    </div>`;
  }).join('');
  return `<div class="bar-chart">${bars}</div>`;
}

// ── Section helpers ───────────────────────────────────────────────────────────

function statCard(icon, label, value, sub = '') {
  return `<div class="stat-card">
    <div class="stat-icon">${icon}</div>
    <div class="stat-body">
      <div class="stat-value">${esc(String(value))}</div>
      <div class="stat-label">${esc(label)}</div>
      ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}
    </div>
  </div>`;
}

function genreBarHTML(tag, count, max) {
  const pct = Math.round((count / max) * 100);
  return `<div class="genre-row">
    <span class="genre-name">${esc(tag)}</span>
    <div class="genre-bar-track">
      <div class="genre-bar-fill" style="width:${pct}%"></div>
    </div>
    <span class="genre-count">${count}</span>
  </div>`;
}

// ── Main render export ────────────────────────────────────────────────────────

export function renderStats(container, navigate, allBooks) {
  const monthly  = calcMonthly(allBooks);
  const streak   = calcStreak(allBooks);
  const records  = calcRecords(allBooks);
  const genres   = calcGenres(allBooks);
  const lang     = calcLang(allBooks);

  const hasData  = allBooks.some(b => b.status === 'read');
  const genreMax = genres[0]?.[1] || 1;

  const bestMonthStr = records?.bestMonth
    ? (() => {
        const [y, m] = records.bestMonth.split('-');
        return new Date(+y, +m - 1, 1)
          .toLocaleDateString('en', { month: 'long', year: 'numeric' });
      })()
    : '—';

  container.innerHTML = `<div class="screen">
    <header class="app-header">
      <button class="back-btn" id="stats-back">← Back</button>
      <h1 class="header-title">Book<span>Kit</span> Stats</h1>
    </header>
    <div class="stats-body">

      ${!hasData ? `<p class="stats-empty">
        No finished books yet. Start reading and your stats will appear here!
      </p>` : ''}

      <!-- Last 6 months bar chart -->
      <div class="stats-section">
        <h2 class="stats-section-title">📅 Last 6 Months</h2>
        ${barChartHTML(monthly)}
      </div>

      <!-- Snapshot cards -->
      <div class="stats-section">
        <h2 class="stats-section-title">🏆 Records</h2>
        <div class="stat-cards-grid">
          ${statCard('📚', 'Total read', records?.total ?? 0)}
          ${statCard('🔥', 'Current streak', `${streak} mo`, streak > 0 ? 'consecutive months' : 'no active streak')}
          ${statCard('⚡', 'Fastest finish',
            records?.fastest ? `${records.fastest}d` : '—',
            records?.fastestBook?.title ? records.fastestBook.title : ''
          )}
          ${statCard('📈', 'Best month', bestMonthStr, records?.bestMonthCount ? `${records.bestMonthCount} books` : '')}
        </div>
      </div>

      <!-- Language split -->
      <div class="stats-section">
        <h2 class="stats-section-title">🌐 Language Split</h2>
        <div class="lang-split">
          <div class="lang-split-bar">
            <div class="lang-split-en" style="flex:${lang.en || 0}"></div>
            <div class="lang-split-ja" style="flex:${lang.ja || 0}"></div>
          </div>
          <div class="lang-split-labels">
            <span>🇬🇧 ${lang.en} EN (${lang.total ? Math.round(lang.en/lang.total*100) : 0}%)</span>
            <span>🇯🇵 ${lang.ja} JA (${lang.total ? Math.round(lang.ja/lang.total*100) : 0}%)</span>
          </div>
        </div>
      </div>

      <!-- Genre / tag breakdown -->
      ${genres.length ? `
      <div class="stats-section">
        <h2 class="stats-section-title">🏷️ Top Tags</h2>
        <div class="genre-list">
          ${genres.map(([tag, count]) => genreBarHTML(tag, count, genreMax)).join('')}
        </div>
        <p class="stats-hint">Tags you add in book detail view appear here.</p>
      </div>` : `
      <div class="stats-section">
        <h2 class="stats-section-title">🏷️ Top Tags</h2>
        <p class="stats-hint">Add tags to your books to see a breakdown here.</p>
      </div>`}

    </div>
  </div>`;

  document.getElementById('stats-back').addEventListener('click', () => navigate('home'));
}
