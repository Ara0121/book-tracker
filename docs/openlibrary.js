'use strict';

const OL      = 'https://openlibrary.org';
const COVERS  = 'https://covers.openlibrary.org';
const CJK_RE  = /[　-鿿぀-ヿ豈-﫿]/;

export const hasCJK = str => CJK_RE.test(str);

export function extractISBN(raw) {
  if (!raw) return null;
  raw = raw.trim();
  const amz = raw.match(/\/(?:dp|gp\/product)\/([0-9X]{10}|97[89]\d{10})/i);
  if (amz) return toISBN13(amz[1]);
  const bare = raw.replace(/[-\s]/g, '').match(/^(97[89]\d{10}|\d{9}[\dX])$/i);
  if (bare) return toISBN13(bare[0]);
  return null;
}

function toISBN13(raw) {
  raw = raw.replace(/[-\s]/g, '').toUpperCase();
  if (raw.length === 13) return raw;
  if (raw.length === 10) {
    const d = '978' + raw.slice(0, 9);
    let s = 0;
    for (let i = 0; i < 12; i++) s += +d[i] * (i % 2 ? 3 : 1);
    return d + (10 - s % 10) % 10;
  }
  return raw;
}

function pickLanguage(book) {
  const langs = (book.languages || []).map(l => l.key || '').join('');
  if (langs.includes('jpn') || hasCJK(book.title || '')) return 'ja';
  return 'en';
}

export async function lookupISBN(isbn) {
  try {
    const r = await fetch(
      `${OL}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const json = await r.json();
    const book = json[`ISBN:${isbn}`];
    if (!book) return null;
    return {
      title:     book.title || '',
      author:    (book.authors || []).map(a => a.name).join(', '),
      isbn,
      cover_url: book.cover?.large || book.cover?.medium || `${COVERS}/b/isbn/${isbn}-M.jpg`,
      language:  pickLanguage(book),
    };
  } catch { return null; }
}

export async function searchTitle(query) {
  try {
    const r = await fetch(
      `${OL}/search.json?q=${encodeURIComponent(query)}&limit=6&fields=title,author_name,isbn,language,cover_i`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return [];
    const { docs = [] } = await r.json();
    return docs.slice(0, 6).map(d => {
      const raw  = (d.isbn || []).find(i => i.length === 13) || (d.isbn || [])[0] || null;
      const isbn = raw ? toISBN13(raw) : null;
      return {
        title:     d.title || '',
        author:    (d.author_name || []).join(', '),
        isbn,
        cover_url: d.cover_i ? `${COVERS}/b/id/${d.cover_i}-M.jpg` : (isbn ? `${COVERS}/b/isbn/${isbn}-M.jpg` : null),
        language:  (d.language || []).includes('jpn') || hasCJK(d.title || '') ? 'ja' : 'en',
      };
    });
  } catch { return []; }
}
