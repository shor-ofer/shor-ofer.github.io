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
// A file's bytes are kept once, however many packs hold them: under their
// hash (SHA-256) in BLOBS, each pack's file only naming it. Level packs carry
// their asset pack's art and sounds, so most of their megabytes are the same
// few files. Bytes no file names any more are swept away after a pack is put
// again or removed.
//
// The same file runs in the pages and in the worker, so it touches nothing
// but indexedDB (and crypto, for hashing).
const packStore = (() => {
  const DB = 'warm-worm-packs';
  const VERSION = 2;
  const FILES = 'files';     // `${kind}/${name}/${path}` -> { type, hash, size }
                             //   (version 1 kept { type, data: Blob } here; such
                             //   records are moved to BLOBS soon after opening)
  const BLOBS = 'blobs';     // hash -> { data: Blob, size }
  const PACKS = 'packs';     // `${kind}/${name}` -> { kind, name, title, updated, count, manifest }
  const MOVED = '~moved';    // in PACKS: there since every file of version 1 is in BLOBS
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
        const req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = e => {
          const db = req.result;
          if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
          if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS);
          if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
          if (e.oldVersion === 0) req.transaction.objectStore(PACKS).put({ moved: true }, MOVED);
          // version 1's manifests hashed with FNV: worked out again, by SHA-256
          if (e.oldVersion > 0 && e.oldVersion < 2) {
            req.transaction.objectStore(PACKS).openCursor().onsuccess = ev => {
              const c = ev.target.result;
              if (!c) return;
              if (c.value.manifest) { const { manifest, ...rest } = c.value; c.update(rest); }
              c.continue();
            };
          }
        };
        req.onsuccess = async () => {
          const db = req.result;
          // another tab opening a newer version: let it
          db.onversionchange = () => { db.close(); opening = null; };
          // version 1's files moved before anything else reads them — once,
          // by whichever page or worker opens the store first
          try {
            if (!await result(db.transaction(PACKS, 'readonly').objectStore(PACKS).get(MOVED))) await moveOld(db);
          } catch (err) { console.warn('packStore: could not move the old files yet:', err.message); }
          ok(db);
        };
        req.onblocked = () => console.warn('packStore: waiting for another tab, or the old service worker, to let go of the store');
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

  // ---------- hashing ----------
  // SHA-256, as hex: by the browser's crypto where it has it (https,
  // localhost), by the plain version below where it hasn't (a page on plain
  // http by IP, which can still send a pack from disk) — the same either way.
  const SHA_K = [], SHA_H = [];
  (() => {
    const frac = x => (x - Math.floor(x)) * 4294967296 >>> 0;
    for (let n = 2; SHA_K.length < 64; n++) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (!prime) continue;
      if (SHA_H.length < 8) SHA_H.push(frac(Math.pow(n, 1 / 2)));
      SHA_K.push(frac(Math.pow(n, 1 / 3)));
    }
  })();
  function sha256Plain(bytes) {
    const l = bytes.length;
    const words = new Uint32Array(((l + 9 + 63) >> 6) << 4);
    for (let i = 0; i < l; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
    words[l >> 2] |= 0x80 << (24 - (l & 3) * 8);
    words[words.length - 2] = Math.floor(l / 536870912);
    words[words.length - 1] = l * 8;
    const h = SHA_H.slice(), w = new Uint32Array(64);
    for (let j = 0; j < words.length; j += 16) {
      for (let i = 0; i < 16; i++) w[i] = words[j + i];
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        w[i] = w[i - 16] + ((x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ (x >>> 3)) + w[i - 7] + ((y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ (y >>> 10));
      }
      let [a, b, c, d, e, f, g, k] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (k + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
        const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, k].forEach((v, i) => { h[i] = (h[i] + v) >>> 0; });
    }
    return h.map(v => v.toString(16).padStart(8, '0')).join('');
  }
  async function sha256(bytes) {
    const subtle = typeof crypto !== 'undefined' && crypto.subtle;
    if (!subtle) return sha256Plain(bytes);
    return [...new Uint8Array(await subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // A file's hash: 128 bits of its SHA-256, as 32 hex digits — what its bytes
  // are kept under, and what manifests compare.
  const hashBytes = async bytes => (await sha256(bytes)).slice(0, 32);

  const bytesOf = async data => data instanceof Uint8Array ? data
    : data instanceof ArrayBuffer ? new Uint8Array(data)
    : data instanceof Blob ? new Uint8Array(await data.arrayBuffer())
    : new TextEncoder().encode(String(data));
  const asBlob = (data, path) => data instanceof Blob ? data
    : new Blob([typeof data === 'string' ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : data], { type: typeOf(path) });
  const byPath = (x, y) => x.path < y.path ? -1 : x.path > y.path ? 1 : 0;

  // A pack's manifest from its files' paths, sizes and hashes, by path — and
  // its version, a hash of that list: two browsers holding the same pack agree
  // on both, and comparing two manifests says which files differ.
  async function manifestFrom(list) {
    const files = list.map(f => ({ path: f.path, size: f.size, hash: f.hash })).sort(byPath);
    const v = (await sha256(new TextEncoder().encode(files.map(f => `${f.path}\0${f.hash}`).join('\n')))).slice(0, 16);
    return { v, files };
  }
  // ... from the files themselves: [{ path or name, data: ArrayBuffer, bytes,
  // Blob or text }].
  async function manifestOf(files) {
    return manifestFrom(await Promise.all(files.map(async f => {
      const bytes = await bytesOf(f.data);
      return { path: f.path || f.name, size: bytes.length, hash: await hashBytes(bytes) };
    })));
  }

  // Every key of a pack's files, for replacing or removing it.
  async function keysOf(db, kind, name) {
    const tx = db.transaction(FILES, 'readonly');
    const range = IDBKeyRange.bound(`${kind}/${name}/`, `${kind}/${name}/￿`);
    return result(tx.objectStore(FILES).getAllKeys(range));
  }

  // Bytes no file names any more, gone. In one transaction over both, so a
  // pack being put meanwhile is either all in or not yet.
  async function sweep(db) {
    const tx = db.transaction([FILES, BLOBS], 'readwrite');
    const files = tx.objectStore(FILES), blobs = tx.objectStore(BLOBS);
    const used = new Set();
    files.openCursor().onsuccess = e => {
      const c = e.target.result;
      if (c) { if (c.value.hash) used.add(c.value.hash); c.continue(); return; }
      blobs.getAllKeys().onsuccess = ev => { for (const h of ev.target.result) if (!used.has(h)) blobs.delete(h); };
    };
    await done(tx);
  }

  // Version 1's files, kept with their bytes, moved into BLOBS one by one,
  // and MOVED put once they all are; reading takes both kinds of record, for
  // a store whose moving was cut short.
  let moving = null;
  function moveOld(db) {
    if (moving) return moving;
    moving = (async () => {
      const keys = await new Promise((ok, fail) => {
        const out = [];
        const req = db.transaction(FILES, 'readonly').objectStore(FILES).openCursor();
        req.onsuccess = () => { const c = req.result; if (!c) { ok(out); return; } if (c.value && c.value.data) out.push(c.key); c.continue(); };
        req.onerror = () => fail(req.error);
      });
      for (const key of keys) {
        const rec = await result(db.transaction(FILES, 'readonly').objectStore(FILES).get(key));
        if (!rec || !rec.data) continue;
        const bytes = await bytesOf(rec.data);
        const hash = await hashBytes(bytes);
        const tx = db.transaction([FILES, BLOBS], 'readwrite');
        const files = tx.objectStore(FILES), blobs = tx.objectStore(BLOBS);
        files.get(key).onsuccess = e => {
          const now = e.target.result;
          if (!now || !now.data) return;     // put again meanwhile
          blobs.getKey(hash).onsuccess = ev => {
            if (ev.target.result === undefined) blobs.put({ data: now.data, size: bytes.length }, hash);
            files.put({ type: now.type, hash, size: bytes.length }, key);
          };
        };
        await done(tx);
      }
      const tx = db.transaction(PACKS, 'readwrite');
      tx.objectStore(PACKS).put({ moved: true }, MOVED);
      await done(tx);
    })().catch(err => { moving = null; throw err; });
    return moving;
  }

  // One file's record and its bytes, in a transaction over FILES and BLOBS.
  function fileIn(tx, key) {
    return new Promise((ok, fail) => {
      const req = tx.objectStore(FILES).get(key);
      req.onerror = () => fail(req.error);
      req.onsuccess = () => {
        const rec = req.result;
        if (!rec) { ok(null); return; }
        if (rec.data) { ok({ type: rec.type, data: rec.data }); return; }     // version 1's
        const b = tx.objectStore(BLOBS).get(rec.hash);
        b.onerror = () => fail(b.error);
        b.onsuccess = () => ok(b.result ? { type: rec.type, data: b.result.data } : null);
      };
    });
  }

  return {
    PREFIX,
    clean,

    // A pack's folder, as a URL any page here can read it by.
    url(kind, name) { return `${PREFIX}${kind}/${clean(name)}/`; },

    // Stores a pack whole — [{ name: 'path/in/pack', data }] — in place of any
    // pack of that kind and name. data is a string, bytes or a Blob. Bytes
    // already kept (by this pack or any other) aren't kept again.
    async put(kind, name, files, title) {
      name = clean(name);
      // hashed first: a transaction can't wait for anything but itself
      const items = await Promise.all(files.map(async f => {
        const path = f.name.replace(/^\/+/, '');
        const blob = asBlob(f.data, path);
        const bytes = await bytesOf(blob);
        return { path, type: typeOf(path), blob, size: bytes.length, hash: await hashBytes(bytes) };
      }));
      const updated = Date.now();
      const manifest = { ...await manifestFrom(items), updated };
      const db = await open();
      const old = await keysOf(db, kind, name);
      const tx = db.transaction([FILES, BLOBS, PACKS], 'readwrite');
      const store = tx.objectStore(FILES), blobs = tx.objectStore(BLOBS);
      for (const k of old) store.delete(k);
      for (const it of items) {
        blobs.getKey(it.hash).onsuccess = e => { if (e.target.result === undefined) blobs.put({ data: it.blob, size: it.size }, it.hash); };
        store.put({ type: it.type, hash: it.hash, size: it.size }, `${kind}/${name}/${it.path}`);
      }
      tx.objectStore(PACKS).put({ kind, name, title: title || name, updated, count: items.length, manifest }, `${kind}/${name}`);
      await done(tx);
      if (old.length) await sweep(db);
      return this.url(kind, name);
    },

    // The packs of a kind, newest first.
    async list(kind) {
      const db = await open();
      const all = await result(db.transaction(PACKS, 'readonly').objectStore(PACKS).getAll());
      return all.filter(p => p.kind === kind).sort((a, b) => b.updated - a.updated);
    },

    // One file — { type, data: Blob } — or null.
    async get(kind, name, path) {
      const db = await open();
      return fileIn(db.transaction([FILES, BLOBS], 'readonly'), `${kind}/${name}/${path}`);
    },

    manifestOf,
    hash: hashBytes,

    // A stored pack's manifest (manifestFrom), or null if there is no such
    // pack. Kept with the pack's entry when it is put; worked out from its
    // files' records otherwise (version 1's packs), and kept then.
    async manifest(kind, name) {
      const db = await open();
      const key = `${kind}/${name}`;
      const meta = await result(db.transaction(PACKS, 'readonly').objectStore(PACKS).get(key));
      if (!meta) return null;
      if (meta.manifest && meta.manifest.updated === meta.updated) return meta.manifest;
      const keys = await keysOf(db, kind, name);
      const tx = db.transaction(FILES, 'readonly');
      const recs = await Promise.all(keys.map(k => result(tx.objectStore(FILES).get(k))));
      const at = `${kind}/${name}/`.length;
      const list = await Promise.all(recs.map(async (rec, i) => rec.hash ? { path: keys[i].slice(at), size: rec.size, hash: rec.hash }
        : (async () => { const bytes = await bytesOf(rec.data); return { path: keys[i].slice(at), size: bytes.length, hash: await hashBytes(bytes) }; })()));
      const m = { ...await manifestFrom(list), updated: meta.updated };
      const wtx = db.transaction(PACKS, 'readwrite');
      const store = wtx.objectStore(PACKS);
      // only if the pack wasn't put again meanwhile
      store.get(key).onsuccess = e => { const now = e.target.result; if (now && now.updated === meta.updated) store.put({ ...now, manifest: m }, key); };
      await done(wtx);
      return m;
    },

    // Every file of a pack, as put() takes them: [{ name, data: Blob }].
    async files(kind, name) {
      const db = await open();
      const keys = await keysOf(db, kind, name);
      const tx = db.transaction([FILES, BLOBS], 'readonly');
      const recs = await Promise.all(keys.map(k => fileIn(tx, k)));
      const at = `${kind}/${name}/`.length;
      return keys.map((k, i) => ({ name: k.slice(at), data: recs[i] ? recs[i].data : new Blob([]) }));
    },

    async remove(kind, name) {
      const db = await open();
      const old = await keysOf(db, kind, name);
      const tx = db.transaction([FILES, PACKS], 'readwrite');
      for (const k of old) tx.objectStore(FILES).delete(k);
      tx.objectStore(PACKS).delete(`${kind}/${name}`);
      await done(tx);
      await sweep(db);
    },

    // What the store holds: its packs (by kind), their files, the bytes those
    // add up to, and the bytes actually kept — each once.
    async stats() {
      const db = await open();
      const tx = db.transaction([FILES, BLOBS, PACKS], 'readonly');
      const [files, blobs, packs] = await Promise.all([
        result(tx.objectStore(FILES).getAll()), result(tx.objectStore(BLOBS).getAll()), result(tx.objectStore(PACKS).getAll())]);
      let bytes = 0, old = 0, oldBytes = 0;
      for (const f of files) {
        if (f.hash) bytes += f.size || 0;
        else { old++; oldBytes += f.data.size; bytes += f.data.size; }
      }
      const kept = blobs.reduce((n, b) => n + (b.size || 0), 0) + oldBytes;
      const kinds = {};
      for (const p of packs) if (p.kind) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
      return { packs: kinds, files: files.length, blobs: blobs.length, bytes, kept, saved: bytes - kept, unmoved: old };
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
