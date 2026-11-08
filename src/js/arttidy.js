// The art of level packs that are gone. Each of the level editor's level
// packs owns its art: a copy kept in the browser's store under lp-<uid>
// (src/js/packstore.js), and, once the Asset Editor has opened it, that
// editor's working copy of it (owner: <uid>, in its own IndexedDB). When the
// level pack is deleted they go with it (forPack); art left behind by
// versions that didn't do that, or by a delete that never finished, is found
// and cleared by unused() / tidy() — what the share shell's "share tidy" runs.
//
// What is in use is read from the editor's own list in localStorage, so this
// runs on any page of the site. Art made in the last minutes is let be: a
// level pack being made right now has its art before it is in the list.
const ArtTidy = (() => {
  const EDITOR_KEY = 'warmWormEditorLevel';     // editor/index.html's STORE_KEY
  const CREATOR_DB = 'assetpack-editor';        // assetpack-editor/js/db.js
  const RECENT = 5 * 60 * 1000;

  // The level editor's level packs: the ids of those it has, and the stored
  // art they read — or null if its list can't be read (nothing is cleared then).
  function inUse() {
    let raw;
    try { raw = localStorage.getItem(EDITOR_KEY); } catch { return null; }
    const uids = new Set(), names = new Set();
    if (raw == null) return { uids, names };
    let data;
    try { data = JSON.parse(raw); } catch { return null; }
    if (!data || typeof data !== 'object') return null;
    const at = packStore.PREFIX + 'assets/';
    for (const p of Array.isArray(data.packs) ? data.packs : []) {
      if (p && p.uid) uids.add(p.uid);
      if (p && typeof p.assets === 'string' && p.assets.startsWith(at)) names.add(decodeURIComponent(p.assets.slice(at.length).replace(/\/$/, '')));
    }
    return { uids, names };
  }

  // ---- the Asset Editor's working copies ----
  // Opened as that editor opens it, so a browser that never ran it gets the
  // very database it would have made.
  function creatorDb() {
    return new Promise((ok, fail) => {
      const req = indexedDB.open(CREATOR_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('packs');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
  }
  async function creatorCopies() {
    const db = await creatorDb();
    try {
      return await new Promise((ok, fail) => {
        const r = db.transaction('packs', 'readonly').objectStore('packs').get('index');
        r.onsuccess = () => ok(Array.isArray(r.result) ? r.result : []);
        r.onerror = () => fail(r.error);
      });
    } finally { db.close(); }
  }
  async function dropCopies(ids) {
    if (!ids.length) return;
    const gone = new Set(ids);
    const db = await creatorDb();
    try {
      await new Promise((ok, fail) => {
        const tx = db.transaction('packs', 'readwrite'), s = tx.objectStore('packs');
        for (const id of ids) { s.delete('pack:' + id); s.delete('base:' + id); }
        const idx = s.get('index');
        idx.onsuccess = () => s.put((idx.result || []).filter(x => !gone.has(x.id)), 'index');
        const open = s.get('open');
        open.onsuccess = () => { if (gone.has(open.result)) s.delete('open'); };
        tx.oncomplete = () => ok();
        tx.onerror = tx.onabort = () => fail(tx.error);
      });
    } finally { db.close(); }
  }

  // The art of the level pack `uid`, which is being deleted: its copy in the
  // store and the Asset Editor's working copy of it.
  async function forPack(uid) {
    if (!uid) return;
    await packStore.remove('assets', 'lp-' + uid);
    try { await dropCopies((await creatorCopies()).filter(x => x.owner === uid).map(x => x.id)); } catch { /* no such editor here */ }
  }

  // What no level pack uses: { art: [{ name, title, files }], copies: [{ id, name, owner }] },
  // or null if the level editor's list can't be read.
  async function unused() {
    const use = inUse();
    if (!use) return null;
    const now = Date.now();
    const art = (await packStore.list('assets'))
      .filter(p => /^lp-/.test(p.name) && !use.uids.has(p.name.slice(3)) && !use.names.has(p.name) && now - (p.updated || 0) > RECENT)
      .map(p => ({ name: p.name, title: p.title, files: p.count }));
    let copies = [];
    try { copies = (await creatorCopies()).filter(x => x.owner && !use.uids.has(x.owner) && now - (x.updated || 0) > RECENT); } catch { /* as above */ }
    return { art, copies: copies.map(x => ({ id: x.id, name: x.name, owner: x.owner })) };
  }

  // Clear what unused() finds; what was cleared, as it gives it.
  async function tidy(found) {
    found = found || await unused();
    if (!found) return null;
    for (const a of found.art) await packStore.remove('assets', a.name);
    try { await dropCopies(found.copies.map(x => x.id)); } catch { /* as above */ }
    return found;
  }

  return { forPack, unused, tidy };
})();
