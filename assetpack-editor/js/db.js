// The packs are far too big for localStorage once there is art in them, so
// they live in IndexedDB: each pack one record, written back on a debounce,
// beside an index of them all — { id, name, dirty, updated } — that the pack
// picker reads without loading any pack, and the id of the one open.
//
// A pack is `dirty` from its first change until it is exported as a .zip;
// the picker marks it with *.
const DB_NAME = 'assetpack-editor';
const DB_STORE = 'packs';
const DB_INDEX = 'index';
const DB_OPEN = 'open';
const DB_LEGACY = 'current';       // the one pack an earlier version kept
const packKey = id => 'pack:' + id;
// A pack as it was when its * last went — imported, or exported — which
// Revert puts back: kept beside it, whole, until the next such moment.
const baseKey = id => 'base:' + id;

function openDB() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

// One transaction over the store: `fn(store)` queues its requests, and what
// it returns (a request, or a function of nothing) is the result.
async function dbTx(mode, fn) {
  const db = await openDB();
  return new Promise((ok, fail) => {
    const tx = db.transaction(DB_STORE, mode);
    const out = fn(tx.objectStore(DB_STORE));
    tx.oncomplete = () => { db.close(); ok(out && 'result' in out ? out.result : typeof out === 'function' ? out() : out); };
    tx.onerror = () => { db.close(); fail(tx.error); };
    tx.onabort = () => { db.close(); fail(tx.error || new Error('the write was abandoned')); };
  });
}

const dbRead = key => dbTx('readonly', s => s.get(key)).then(v => v === undefined ? null : v);

async function dbList() { return (await dbRead(DB_INDEX)) || []; }
async function dbOpenId() { return dbRead(DB_OPEN); }
async function dbLoad(id) { return dbRead(packKey(id)); }
async function dbSetOpen(id) { return dbTx('readwrite', s => { s.put(id, DB_OPEN); }); }

// The index is read and written back inside the one transaction, which
// IndexedDB runs alone: two saves close together can't each write back a
// list that is missing the other's pack.
function editIndex(s, change) {
  const req = s.get(DB_INDEX);
  req.onsuccess = () => s.put(change(req.result || []), DB_INDEX);
}

// The pack, and its line in the index, in one go.
async function dbSave(p) {
  const line = { id: p.id, name: p.name, dirty: !!p.dirty, origin: p.origin || '', updated: Date.now() };
  return dbTx('readwrite', s => {
    s.put(p, packKey(p.id));
    editIndex(s, list => [...list.filter(x => x.id !== p.id), line]);
  });
}

async function dbSaveBase(id, p) { return dbTx('readwrite', s => { s.put(p, baseKey(id)); }); }
async function dbLoadBase(id) { return dbRead(baseKey(id)); }

async function dbDelete(id) {
  return dbTx('readwrite', s => {
    s.delete(packKey(id));
    s.delete(baseKey(id));
    editIndex(s, list => list.filter(x => x.id !== id));
    const open = s.get(DB_OPEN);
    open.onsuccess = () => { if (open.result === id) s.delete(DB_OPEN); };
  });
}

// The one pack an earlier version kept becomes the first of many. Nothing is
// lost: it is written under its new key before the old one goes. And any
// pack stored but missing from the index — which a version that wrote the
// index in two steps could leave — is listed again.
async function dbMigrate() {
  const keys = await dbTx('readonly', s => s.getAllKeys());
  const listed = new Set((await dbList()).map(x => x.id));
  for (const k of keys) {
    if (typeof k !== 'string' || !k.startsWith('pack:') || listed.has(k.slice(5))) continue;
    const lost = await dbRead(k);
    if (lost && lost.id) await dbSave(lost);
  }
  const old = await dbRead(DB_LEGACY);
  if (!old) return;
  if (!old.id) old.id = uid();
  if (old.dirty === undefined) old.dirty = true;     // not known to be exported
  await dbSave(old);
  await dbTx('readwrite', s => { s.put(old.id, DB_OPEN); s.delete(DB_LEGACY); });
}
