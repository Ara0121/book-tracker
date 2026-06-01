'use strict';

const DB_NAME = 'booktracker';
const DB_VERSION = 1;
let _db = null;

async function getDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ({ target: { result: db } }) => {
      if (!db.objectStoreNames.contains('books'))
        db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta');
    };
    req.onsuccess = ({ target: { result: db } }) => { _db = db; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function run(storeName, mode, fn) {
  return getDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const s  = tx.objectStore(storeName);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

export const bookStore = {
  getAll: ()     => run('books', 'readonly',  s => s.getAll()),
  get:    id     => run('books', 'readonly',  s => s.get(id)),
  put:    book   => run('books', 'readwrite', s => s.put(book)),
  delete: id     => run('books', 'readwrite', s => s.delete(id)),
  clear:  ()     => run('books', 'readwrite', s => s.clear()),
};

export const metaStore = {
  get: key        => run('meta', 'readonly',  s => s.get(key)),
  set: (key, val) => run('meta', 'readwrite', s => s.put(val, key)),
};
