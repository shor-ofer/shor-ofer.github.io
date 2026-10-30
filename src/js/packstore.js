// ---------- The pack store ----------
// One place in the browser where the three tools keep packs for each other:
// the asset pack creator saves an asset pack here, the level editor saves its
// level packs, and any of them — the game too — opens one by URL. A pack is
// its files, exactly as they would sit in a folder, under a kind ('assets' or
// 'levels') and a name.
//
// The service worker (sw.js, at the site's root) answers every request under
// /__idb/<kind>/<name>/ from here, so a stored pack is read like any folder:
// /editor/?assets=/__idb/assets/my-pack/ or /src/?pack=/__idb/levels/my-pack/
// levelpack.json, with the paths inside its manifests resolving as on disk.
// That needs only a static server — live-server, http-server, the one in
// tools/serve.mjs — on localhost or https, where service workers are allowed.
//
// The same file runs in the pages and in the worker, so it touches nothing
// but indexedDB.
const packStore = (() => {
  const DB = 'warm-worm-packs';
  const FILES = 'files';     // `${kind}/${name}/${path}` -> { type, data: Blob }
  const PACKS = 'packs';     // `${kind}/${name}` -> { kind, name, title, updated, count }
  const PREFIX = '/__idb/';

  const TYPES = {
    json: 'application/json', png: 'image/png', jpg: 'image/jpeg', html: 'text/html; charset=utf-8',
    js: 'text/javascript', css: 'text/css', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', txt: 'text/plain'
  };
  const typeOf = path => TYPES[(path.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

  let opening = null;
  function open() {
    if (!opening) {
      opening = new Promise((ok, fail) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
          if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS);
        };
        req.onsuccess = () => ok(req.result);
        req.onerror = () => { opening = null; fail(req.error); };
      });
    }
    return opening;
  }

  const done = tx => new Promise((ok, fail) => {
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => fail(tx.error);
  });
  const result = req => new Promise((ok, fail) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });

  const clean = name => String(name).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'pack';

  // A file's hash: 64 bits from two FNV-1a runs with different multipliers,
  // as 16 hex digits. Not a secure hash — enough to tell a changed file from
  // an unchanged one, the same in every browser, and on http as on https.
  function hashBytes(u8) {
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < u8.length; i++) {
      a = Math.imul(a ^ u8[i], 0x01000193);
      b = Math.imul(b ^ u8[i], 0x5bd1e995);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  const byPath = (x, y) => x.path < y.path ? -1 : x.path > y.path ? 1 : 0;

  // A pack's manifest — every file's path, size and hash, by path — and its
  // version, a hash of that list: two browsers holding the same pack agree on
  // both, and comparing two manifests says which files differ. files are
  // [{ path or name, data: ArrayBuffer or bytes }].
  function manifestOf(files) {
    const list = files.map(f => {
      const u8 = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      return { path: f.path || f.name, size: u8.length, hash: hashBytes(u8) };
    }).sort(byPath);
    const v = hashBytes(new TextEncoder().encode(list.map(f => `${f.path}\0${f.hash}`).join('\n')));
    return { v, files: list };
  }
  const asBlob = (data, path) => data instanceof Blob ? data
    : new Blob([typeof data === 'string' ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : data], { type: typeOf(path) });

  // Every key of a pack's files, for replacing or removing it.
  async function keysOf(db, kind, name) {
    const tx = db.transaction(FILES, 'readonly');
    const range = IDBKeyRange.bound(`${kind}/${name}/`, `${kind}/${name}/￿`);
    return result(tx.objectStore(FILES).getAllKeys(range));
  }

  return {
    PREFIX,
    clean,

    // A pack's folder, as a URL any page here can read it by.
    url(kind, name) { return `${PREFIX}${kind}/${clean(name)}/`; },

    // Stores a pack whole — [{ name: 'path/in/pack', data }] — in place of any
    // pack of that kind and name. data is a string, bytes or a Blob.
    async put(kind, name, files, title) {
      name = clean(name);
      const db = await open();
      const old = await keysOf(db, kind, name);
      const tx = db.transaction([FILES, PACKS], 'readwrite');
      const store = tx.objectStore(FILES);
      for (const k of old) store.delete(k);
      for (const f of files) {
        const path = f.name.replace(/^\/+/, '');
        store.put({ type: typeOf(path), data: asBlob(f.data, path) }, `${kind}/${name}/${path}`);
      }
      tx.objectStore(PACKS).put({ kind, name, title: title || name, updated: Date.now(), count: files.length }, `${kind}/${name}`);
      await done(tx);
      return this.url(kind, name);
    },

    // The packs of a kind, newest first.
    async list(kind) {
      const db = await open();
      const all = await result(db.transaction(PACKS, 'readonly').objectStore(PACKS).getAll());
      return all.filter(p => p.kind === kind).sort((a, b) => b.updated - a.updated);
    },

    // One file, or null.
    async get(kind, name, path) {
      const db = await open();
      const rec = await result(db.transaction(FILES, 'readonly').objectStore(FILES).get(`${kind}/${name}/${path}`));
      return rec || null;
    },

    manifestOf,

    // A stored pack's manifest (manifestOf), or null if there is no such
    // pack. Worked out once and kept with the pack's entry, and again only
    // once the pack has been put since.
    async manifest(kind, name) {
      const db = await open();
      const key = `${kind}/${name}`;
      const meta = await result(db.transaction(PACKS, 'readonly').objectStore(PACKS).get(key));
      if (!meta) return null;
      if (meta.manifest && meta.manifest.updated === meta.updated) return meta.manifest;
      const files = await Promise.all((await this.files(kind, name)).map(async f => ({ name: f.name, data: await f.data.arrayBuffer() })));
      const m = { ...manifestOf(files), updated: meta.updated };
      const tx = db.transaction(PACKS, 'readwrite');
      const store = tx.objectStore(PACKS);
      // only if the pack wasn't put again meanwhile
      const now = await result(store.get(key));
      if (now && now.updated === meta.updated) store.put({ ...now, manifest: m }, key);
      await done(tx);
      return m;
    },

    // Every file of a pack, as put() takes them: [{ name, data: Blob }].
    async files(kind, name) {
      const db = await open();
      const keys = await keysOf(db, kind, name);
      const store = db.transaction(FILES, 'readonly').objectStore(FILES);
      const recs = await Promise.all(keys.map(k => result(store.get(k))));
      const at = `${kind}/${name}/`.length;
      return keys.map((k, i) => ({ name: k.slice(at), data: recs[i].data }));
    },

    async remove(kind, name) {
      const db = await open();
      const old = await keysOf(db, kind, name);
      const tx = db.transaction([FILES, PACKS], 'readwrite');
      for (const k of old) tx.objectStore(FILES).delete(k);
      tx.objectStore(PACKS).delete(`${kind}/${name}`);
      await done(tx);
    },

    // What a request under /__idb/ asks for, or null for any other path.
    parse(pathname) {
      if (!pathname.startsWith(PREFIX)) return null;
      const [kind, name, ...rest] = pathname.slice(PREFIX.length).split('/').map(decodeURIComponent);
      let path = rest.join('/');
      if (!path || path.endsWith('/')) path += 'index.html';
      return kind && name ? { kind, name, path } : null;
    },

    // ---- in a page ----
    // Registers the worker that serves /__idb/. A page whose URL already
    // names a stored pack, opened before the worker was looking after it,
    // reloads once it is, since its first requests went past the worker.
    async boot() {
      if (typeof navigator === 'undefined' || !navigator.serviceWorker) return false;
      const root = new URL('/', location.href);
      try {
        await navigator.serviceWorker.register(new URL('sw.js', root).href, { scope: root.pathname });
      } catch (err) {
        console.warn('Stored packs need the service worker, which did not register:', err.message);
        return false;
      }
      const KEY = 'packstore-reloaded';
      if (navigator.serviceWorker.controller) { sessionStorage.removeItem(KEY); return true; }
      await new Promise(ok => navigator.serviceWorker.addEventListener('controllerchange', ok, { once: true }));
      const needs = decodeURIComponent(location.search).includes(PREFIX);
      if (needs && !sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        location.reload();
      } else {
        sessionStorage.removeItem(KEY);
      }
      return true;
    },

    // Resolves once /__idb/ URLs can be fetched from this page.
    ready() {
      if (typeof navigator === 'undefined' || !navigator.serviceWorker) return Promise.resolve(false);
      if (navigator.serviceWorker.controller) return Promise.resolve(true);
      return new Promise(ok => navigator.serviceWorker.addEventListener('controllerchange', () => ok(true), { once: true }));
    }
  };
})();
