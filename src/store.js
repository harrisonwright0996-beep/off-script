// Everything the app keeps, in IndexedDB on the phone. Nothing is ever sent anywhere.
// Stores: kv (settings, script model, audio manifest, saved sprint), items (one state per item),
// events (every answer, for the plan and for undo), audio (MP3 clips by file name).
const DB = 'off-script';
const VERSION = 1;

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });

export async function openStore(name = DB) {
  const open = indexedDB.open(name, VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('events')) {
      db.createObjectStore('events', { autoIncrement: true }).createIndex('day', 'day');
    }
    if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
  };
  const db = await req(open);

  const one = (store, mode, fn) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    return done(tx).then(() => (result && 'result' in result ? result.result : undefined));
  };

  return {
    get: (key) => one('kv', 'readonly', (s) => s.get(key)),
    set: (key, value) => one('kv', 'readwrite', (s) => s.put(value, key)),
    del: (key) => one('kv', 'readwrite', (s) => s.delete(key)),
    allStates: () => one('items', 'readonly', (s) => s.getAll()),
    putStates: async (states) => {
      const tx = db.transaction('items', 'readwrite');
      const s = tx.objectStore('items');
      for (const st of states) s.put(st);
      await done(tx);
    },
    clearStates: () => one('items', 'readwrite', (s) => s.clear()),

    // One answer: the new item state and the event, together or not at all. Returns the event key.
    async saveAnswer(event, state) {
      const tx = db.transaction(['items', 'events'], 'readwrite');
      tx.objectStore('items').put(state);
      const key = tx.objectStore('events').add(event);
      await done(tx);
      return key.result;
    },
    async undo(eventKey, prevState) {
      const tx = db.transaction(['items', 'events'], 'readwrite');
      tx.objectStore('items').put(prevState);
      tx.objectStore('events').delete(eventKey);
      await done(tx);
    },
    async eventsSince(day) {
      const tx = db.transaction('events', 'readonly');
      const out = [];
      const cursor = tx.objectStore('events').index('day').openCursor(IDBKeyRange.lowerBound(day));
      await new Promise((resolve, reject) => {
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return resolve();
          out.push({ ...c.value, key: c.primaryKey });
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
      return out.sort((a, b) => a.time - b.time);
    },
    allEvents: () => one('events', 'readonly', (s) => s.getAll()),
    async putEvents(events) {
      const tx = db.transaction('events', 'readwrite');
      const s = tx.objectStore('events');
      for (const e of events) {
        const { key, ...rest } = e;
        s.add(rest);
      }
      await done(tx);
    },
    clearEvents: () => one('events', 'readwrite', (s) => s.clear()),

    // Starting again: the states and answers of these lines (every line when ids is null) go, with
    // any sprint or practice part way. The script, the audio pack and the settings stay.
    async clearProgress(ids = null) {
      const tx = db.transaction(['items', 'events', 'kv'], 'readwrite');
      if (ids === null) {
        tx.objectStore('items').clear();
        tx.objectStore('events').clear();
      } else {
        const gone = new Set(ids);
        for (const id of gone) tx.objectStore('items').delete(id);
        const cursor = tx.objectStore('events').openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          if (gone.has(c.value.id)) c.delete();
          c.continue();
        };
      }
      for (const key of ['sprint', 'practice']) tx.objectStore('kv').delete(key);
      await done(tx);
    },

    // Audio clips, saved in batches so a big pack never needs one huge transaction.
    async putClips(clips) {
      const entries = [...clips];
      for (let i = 0; i < entries.length; i += 200) {
        const tx = db.transaction('audio', 'readwrite');
        const s = tx.objectStore('audio');
        for (const [name, bytes] of entries.slice(i, i + 200)) s.put(bytes, name);
        await done(tx);
      }
    },
    async getClips(names) {
      const tx = db.transaction('audio', 'readonly');
      const s = tx.objectStore('audio');
      const out = new Map();
      const unique = [...new Set(names)];
      const reads = unique.map((n) => req(s.get(n)).then((v) => v && out.set(n, v)));
      await Promise.all(reads);
      await done(tx);
      return out;
    },
    clearAudio: () => one('audio', 'readwrite', (s) => s.clear()),

    async removeEverything() {
      db.close();
      await req(indexedDB.deleteDatabase(name));
    },
  };
}

// Asks the phone to keep this app's storage. Installed apps on iPhone are usually granted it.
export async function askToPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {
    // not available: nothing to do
  }
  return false;
}
