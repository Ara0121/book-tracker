'use strict';

const API = 'https://api.github.com';

function hdrs(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function fetchBooksJson(pat, repo) {
  const r = await fetch(`${API}/repos/${repo}/contents/books.json`, {
    headers: hdrs(pat),
  });
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `GitHub HTTP ${r.status}`);
  }
  const json = await r.json();
  const text = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))));
  return { data: JSON.parse(text), sha: json.sha };
}

export async function saveBooksJson(pat, repo, data, sha) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + '\n')));
  const body = { message: 'chore: sync books', content };
  if (sha) body.sha = sha;

  const r = await fetch(`${API}/repos/${repo}/contents/books.json`, {
    method: 'PUT',
    headers: { ...hdrs(pat), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `GitHub HTTP ${r.status}`);
  }
  const json = await r.json();
  return json.content.sha;
}

export async function verifyRepo(pat, repo) {
  const r = await fetch(`${API}/repos/${repo}`, { headers: hdrs(pat) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `Cannot access repo (HTTP ${r.status})`);
  }
}
