'use strict';

import { bookStore, metaStore } from './store.js';
import { fetchBooksJson, saveBooksJson } from './github.js';

const DEBOUNCE_MS = 5000;
let timer = null;

export function scheduleSync() {
  clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

export async function flush() {
  clearTimeout(timer);
  if (!navigator.onLine) { await metaStore.set('pending', true); return; }

  const pat  = await metaStore.get('pat');
  const repo = await metaStore.get('repo');
  if (!pat || !repo) return;

  try {
    const allBooks = await bookStore.getAll();
    const sha = await metaStore.get('sha');
    const payload = {
      version:    1,
      updated_at: new Date().toISOString(),
      books:      allBooks,
    };
    const newSha = await saveBooksJson(pat, repo, payload, sha);
    await metaStore.set('sha', newSha);
    await metaStore.set('pending', false);
    window.dispatchEvent(new CustomEvent('bt:synced'));
  } catch (err) {
    if (/422|409|sha|conflict/i.test(err.message)) {
      // SHA stale — refetch sha and retry once
      try {
        const { sha: fresh } = await fetchBooksJson(pat, repo);
        if (fresh) await metaStore.set('sha', fresh);
        await flush();
      } catch {
        await metaStore.set('pending', true);
        window.dispatchEvent(new CustomEvent('bt:sync-error', { detail: 'Conflict retry failed' }));
      }
    } else {
      await metaStore.set('pending', true);
      window.dispatchEvent(new CustomEvent('bt:sync-error', { detail: err.message }));
    }
  }
}

export async function pullAndMerge() {
  const pat  = await metaStore.get('pat');
  const repo = await metaStore.get('repo');
  if (!pat || !repo) return;

  const { data, sha } = await fetchBooksJson(pat, repo);
  if (sha) await metaStore.set('sha', sha);

  if (!data) {
    // First run — nothing on GitHub yet, local IDB is source of truth
    return;
  }

  const pending = await metaStore.get('pending');
  if (pending) {
    // Local has unsynced mutations — upload local state, don't overwrite
    await flush();
    return;
  }

  // No pending local changes — accept GitHub data
  await bookStore.clear();
  for (const b of data.books || []) await bookStore.put(b);
}

window.addEventListener('online', async () => {
  if (await metaStore.get('pending')) flush();
});
