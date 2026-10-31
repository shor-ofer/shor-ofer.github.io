// share/core.js — how level packs go from one browser to another, with no page
// in it: what this browser has, deleting, sharing and fetching. Every call
// returns plain data or reports through the callbacks it is given, so the
// share page's views, its JSON output and share/cli.html (through that) are
// all the same code. share/commands.js is the table of commands over it.
//
// Needs packStore (src/js/packstore.js), zipBlob/readZip (src/js/zip.js) for
// .zip files, and, to share or fetch, PeerJS.
//
// What goes over the wire, in order:
//   friend -> sharer  { t: 'ask', name, v }  the pack its link names, and the
//                                            version of its own copy, if any
//   sharer -> friend  { t: 'same', name, title, v }   that is this version:
//                                                     nothing more is sent
//                     or { t: 'pack', name, title, v, files: [{ path, size, hash }] }
//                     or { t: 'none', name }  if this browser hasn't got it
//   friend -> sharer  { t: 'want', paths }   the files whose hash no level
//                                            pack in this browser has — all
//                                            of them if it has none
//   sharer -> friend  { t: 'file', path, data: ArrayBuffer }   one per file wanted,
//   friend -> sharer  { t: 'got', path }                        each answered
//   sharer -> friend  { t: 'end' }
// A sharer answers only for packs marked shared in its browser (setShared):
// any other name is 'none', as if it weren't there — one link handed on
// mustn't reach every pack this browser keeps.
//
// The friend's new copy is the files sent and, for the rest, the same bytes
// from whichever pack here has them; files the pack no longer has go. One
// file at a time, each waited for, so neither side holds the whole pack in
// the channel's buffer and both can show how far it has got.
const ShareCore = (() => {
  const fmt = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const pageUrl = new URL('/share/', location.origin).href;
  const clean = name => packStore.clean(name);
  const error = (code, message) => Object.assign(new Error(message), { code });

  // This browser's id on the broker: made once and kept, so a link made here
  // stays the same.
  function shareId() {
    let id = null;
    try { id = localStorage.getItem('wtwShareId'); } catch { /* storage off: a new one each time */ }
    if (!/^wtw-[0-9a-f]{12}$/.test(id || '')) {
      id = 'wtw-' + [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem('wtwShareId', id); } catch { /* as above */ }
    }
    return id;
  }
  const linkFor = (name, v) => `${pageUrl}?from=${encodeURIComponent(shareId())}&get=${encodeURIComponent(clean(name))}&v=${v}`;

  // Where a stored pack is played: its own index.html, the whole game, or the
  // engine's page on it if it came without one.
  const playUrl = (name, files) => {
    const dir = packStore.url('levels', name);
    return files.some(f => (f.path || f.name) === 'index.html') ? dir + 'index.html' : `/src/index.html?pack=${encodeURIComponent(dir + 'levelpack.json')}`;
  };
  const readStored = async name => Promise.all((await packStore.files('levels', name)).map(async f => ({ path: f.name, data: await f.data.arrayBuffer() })));

  // ---------- which packs are shared ----------
  // The names of the packs this browser lets friends fetch, kept in its
  // localStorage. A pack is shared on purpose — Share it, `share open`,
  // `share pack` — never by a link alone.
  const SHARED_KEY = 'wtwSharedPacks';
  function sharedNames() {
    try { return new Set(JSON.parse(localStorage.getItem(SHARED_KEY) || '[]')); } catch { return new Set(); }
  }
  const isShared = name => sharedNames().has(clean(String(name).replace(/^idb:/, '')));
  function setShared(name, on) {
    const names = sharedNames(), key = clean(String(name).replace(/^idb:/, ''));
    if (on) names.add(key); else names.delete(key);
    try { localStorage.setItem(SHARED_KEY, JSON.stringify([...names].sort())); }
    catch { throw error('store', "This browser won't keep which packs are shared (its storage is off)."); }
    return on;
  }

  // ---------- what this browser has ----------
  // The level packs this browser can send: those on disk (levelpacks/index.json
  // lists their files) and those in its pack store — the level editor's, and
  // any fetched from a friend, which can be passed on in turn. `key` is the
  // name for one on disk, idb:<name> for one in the store.
  async function sources() {
    const out = [];
    try {
      const res = await fetch('/levelpacks/index.json', { cache: 'no-store' });
      if (res.ok) for (const p of await res.json()) if (Array.isArray(p.files)) {
        out.push({ key: p.name, name: p.name, title: p.title || p.name, label: `${p.title || p.name} — levelpacks/${p.name}`, dir: p.dir,
          play: files => files.some(f => f.path === 'index.html') ? p.dir + 'index.html' : `/src/index.html?pack=${encodeURIComponent(p.dir + 'levelpack.json')}`,
          version: async function () { return packStore.manifestOf(await this.load()).v; },
          load: async () => Promise.all(p.files.map(async path => {
            const r = await fetch(p.dir + path, { cache: 'no-store' });
            if (!r.ok) throw new Error(`${p.dir}${path}: ${r.status}`);
            return { path, data: await r.arrayBuffer() };
          })) });
      }
    } catch { /* none on disk */ }
    try {
      for (const p of await packStore.list('levels')) {
        if (p.name.startsWith('__')) continue;     // the editor's passing copies
        out.push({ key: 'idb:' + p.name, name: p.name, title: p.title || p.name, label: `${p.title || p.name} — in this browser`, count: p.count,
          dir: packStore.url('levels', p.name),
          play: files => playUrl(p.name, files),
          version: async () => (await packStore.manifest('levels', p.name))?.v,
          load: () => readStored(p.name) });
      }
    } catch { /* no store */ }
    return out;
  }

  // A pack by its key (idb:<name>, or a name on disk), or by its name alone:
  // one in the pack store before one on disk of the same name.
  async function sourceNamed(name) {
    const all = await sources();
    const exact = all.find(s => s.key === name);
    if (exact) return exact;
    const list = all.filter(s => clean(s.name) === clean(String(name).replace(/^idb:/, '')));
    return list.find(s => s.key.startsWith('idb:')) || list[0] || null;
  }

  // The pack a link names, if this browser has it at that version: in its
  // pack store or on disk, wherever it came from.
  async function haveHere(name, v) {
    for (const src of await sources()) {
      if (clean(src.name) !== name) continue;
      try {
        if (await src.version() !== v) continue;
        const files = await src.load();
        if (files.length) return { src, files };
      } catch { /* unreadable: not this one */ }
    }
    return null;
  }

  // Every level pack kept in this browser — not those on disk, which aren't
  // this browser's to delete.
  async function listPacks() {
    const out = [];
    for (const p of await packStore.list('levels')) {
      if (p.name.startsWith('__')) continue;
      let m = null;
      try { m = await packStore.manifest('levels', p.name); } catch { /* unreadable */ }
      out.push({ name: p.name, title: p.title || p.name, files: p.count, size: m ? m.files.reduce((n, f) => n + f.size, 0) : null,
        v: m ? m.v : null, shared: isShared(p.name), updated: new Date(p.updated).toISOString(), url: packStore.url('levels', p.name) });
    }
    return out;
  }

  // One pack's version and every file in it, from this browser or from disk.
  async function packInfo(name) {
    const src = await sourceNamed(name);
    if (!src) throw error('missing', `There is no level pack called ${name} here.`);
    const m = packStore.manifestOf(await src.load());
    return { name: src.name, title: src.title, key: src.key, where: src.key.startsWith('idb:') ? 'browser' : 'disk', url: src.dir,
      shared: isShared(src.name), v: m.v, size: m.files.reduce((n, f) => n + f.size, 0), files: m.files };
  }

  // A pack — kept here or on disk — as a .zip of its files at their paths,
  // as levelpacks/<name>/ holds them.
  async function zipPack(name) {
    const src = await sourceNamed(name);
    if (!src) throw error('missing', `There is no level pack called ${name} here.`);
    const files = await src.load();
    const blob = zipBlob(files.map(f => ({ name: f.path, data: new Uint8Array(f.data) })));
    return { name: src.name, title: src.title, files: files.length, blob, filename: `${clean(src.name)}.zip` };
  }

  // A level pack's .zip, read: its files (those under the folder its
  // levelpack.json is in, if it is in one), its title, and the name it is kept
  // under — `name`, or that folder's, or the zip's own.
  async function readPackZip(file, name) {
    const all = await readZip(await file.arrayBuffer());
    const lib = [...all.keys()].filter(k => k === 'levelpack.json' || k.endsWith('/levelpack.json')).sort((a, b) => a.length - b.length)[0];
    if (!lib) throw error('notpack', `${file.name} is no level pack: there is no levelpack.json in it.`);
    const root = lib.slice(0, -'levelpack.json'.length);
    const files = [...all].filter(([k]) => k.startsWith(root)).map(([k, data]) => ({ name: k.slice(root.length), data }));
    const here = clean(name || root.split('/').filter(Boolean).pop() || file.name.replace(/\.zip$/i, ''));
    let title = here;
    try { title = JSON.parse(new TextDecoder().decode(all.get(lib))).name || here; } catch { /* its name, then */ }
    return { name: here, title, files };
  }

  // Deletes from this browser's store one pack, or every one; the names gone.
  async function deletePacks(names) {
    const gone = [];
    for (const name of names) {
      await packStore.remove('levels', name);
      try { setShared(name, false); } catch { /* not kept anyway */ }
      gone.push(name);
    }
    return gone;
  }

  // ---------- sharing ----------
  // Shares from this browser under its own id until close(): the pack named
  // is read at once — what a friend asks for is that one, or any other here.
  // `on` gets: ready({ id, link, name, title, v, files, size }),
  // friend(n, { title, text, state, progress }) as each friend gets on,
  // trouble(text, final).
  async function share(name, on) {
    const pack = await sourceNamed(name);
    if (!pack) throw error('missing', `There is no level pack called ${name} here.`);
    const files = await pack.load();
    const manifest = packStore.manifestOf(files);
    const size = files.reduce((n, f) => n + f.data.byteLength, 0);
    if (typeof Peer === 'undefined') throw error('nopeer', 'Could not load PeerJS from cdnjs — sharing needs the internet to find the other browser.');
    const current = () => ({ pack, files, manifest });
    let peer = null, tries = 0, closed = false, friends = 0;
    const open = () => {
      peer = new Peer(shareId());
      peer.on('open', id => on.ready({ id, link: linkFor(pack.name, manifest.v), name: pack.name, title: pack.title, key: pack.key, v: manifest.v, files: files.length, size }));
      peer.on('connection', conn => { const n = ++friends; serve(conn, current, report => on.friend(n, report)); });
      peer.on('disconnected', () => {
        if (peer.destroyed || closed) return;
        on.trouble('Lost the broker — reconnecting…', false);
        peer.reconnect();
      });
      peer.on('error', err => {
        if (err.type !== 'unavailable-id') { on.trouble('Connection trouble: ' + (err.type || err.message), false); return; }
        // another page of this browser holds the id — it sends this pack
        // too, so the link works meanwhile — or one closed only just now
        peer.destroy();
        if (closed) return;
        if (++tries > 24) { on.trouble("This browser's line is still in use. Close its other share pages and reload this one.", true); return; }
        on.trouble(`This browser's line is in use — by another share page open here (the link works through it), or one only just closed. Trying again… (${tries})`, false);
        setTimeout(open, 5000);
      });
    };
    open();
    return { link: linkFor(pack.name, manifest.v), close() { closed = true; if (peer) peer.destroy(); } };
  }

  // One friend: the pack it asks for — the one being shared, or any other this
  // browser has — its manifest, then the files it wants, one by one. Reports
  // { title, text, state: ''|'ok'|'err', progress: 0..1 } as it goes.
  function serve(conn, current, report) {
    let all = [], files = [], size = 0, wanted = false, title = '';
    let i = 0, sent = 0, waiting = null, finished = false;
    const tell = (text, state = '', progress) => report({ title, text, state, progress });
    tell('connecting…');
    const fail = text => { finished = true; tell(text, 'err'); };
    const next = () => {
      if (i >= files.length) {
        finished = true;
        conn.send({ t: 'end' });
        tell(files.length === all.length ? `sent, ${fmt(size)}` : files.length ? `sent ${files.length} changed of ${all.length} files, ${fmt(size)}` : 'had it all already', 'ok', 1);
        return;
      }
      const f = files[i++];
      waiting = f.path;
      conn.send({ t: 'file', path: f.path, data: f.data });
      sent += f.data.byteLength;
    };
    conn.on('data', async msg => {
      if (msg && msg.t === 'ask') {
        // only a pack this browser shares — any other as if it weren't here
        if (!isShared(msg.name || '')) { conn.send({ t: 'none', name: msg.name }); fail(`asked for ${msg.name}, which isn't shared`); return; }
        let { pack, files: had, manifest } = current();
        if (clean(msg.name) !== clean(pack.name)) {
          pack = await sourceNamed(msg.name);
          if (!pack) { conn.send({ t: 'none', name: msg.name }); fail(`asked for ${msg.name}, which isn't here`); return; }
          try { had = await pack.load(); }
          catch (err) { conn.send({ t: 'none', name: msg.name }); fail('could not read it: ' + err.message); return; }
          manifest = packStore.manifestOf(had);
        }
        all = had;
        title = pack.title;
        if (msg.v && msg.v === manifest.v) {
          conn.send({ t: 'same', name: pack.name, title: pack.title, v: manifest.v });
          finished = true;
          tell('had this version already', 'ok', 1);
          return;
        }
        conn.send({ t: 'pack', name: pack.name, title: pack.title, v: manifest.v, files: manifest.files });
        tell('reading its list of files…');
        return;
      }
      if (msg && msg.t === 'want' && Array.isArray(msg.paths)) {
        wanted = true;
        const paths = new Set(msg.paths);
        files = all.filter(f => paths.has(f.path));
        size = files.reduce((t, f) => t + f.data.byteLength, 0);
        next();
        return;
      }
      if (!msg || msg.t !== 'got' || msg.path !== waiting) return;
      tell(`${fmt(sent)} of ${fmt(size)}`, '', sent / (size || 1));
      next();
    });
    conn.on('close', () => {
      if (finished) return;
      // &diff: it read the list and fetched nothing
      if (all.length && !wanted) { finished = true; tell('only looked at what it would fetch'); return; }
      fail('left before the end');
    });
    conn.on('error', err => fail('failed: ' + err.message));
  }

  // ---------- fetching ----------
  // A friend's link: { from, name, v, diff, check }. Resolves with one of
  //   { status: 'own' }    this browser's own link, for a pack it has
  //   { status: 'have' }   the link's very version is here: nothing asked
  //   { status: 'same' }   the sharer has the version here: nothing sent
  //   { status: 'diff', fetch, here }   (diff) what it would fetch — nothing is
  //   { status: 'kept', fetched, fromHere, bytes }   fetched and kept here
  // each with name, title, v, key and url (its levelpack.json); rejects with
  // an Error whose code is unavailable, none, closed, gone, store, peer or
  // nopeer. progress({ text, title, note, got, total }) as it goes.
  async function fetchPack({ from, name, v, diff, check }, progress = () => {}) {
    name = name ? clean(name) : '';
    const result = (status, src, extra) => ({ status, name: src.name, title: src.title, v: extra && extra.v || v || null, key: src.key, url: src.dir + 'levelpack.json', ...extra });
    // this browser's own link
    if (name && from === shareId() && !diff) {
      const src = await sourceNamed(name);
      if (src) return result('own', src);
    }
    // the link's very version here already: no need to ask the other browser
    if (name && v && !diff && !check) {
      const have = await haveHere(name, v);
      if (have) return result('have', have.src);
    }
    if (typeof Peer === 'undefined') throw error('nopeer', 'Could not load PeerJS from cdnjs — this page needs the internet to find the other browser.');
    // the version of the copy kept here, if any: the same at the sharer's, and
    // nothing is sent
    let mine = null;
    try { mine = name && (await packStore.manifest('levels', name))?.v; } catch { /* none kept */ }
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      let meta = null, got = 0, total = 0, done = false, kept = [];
      const files = [];
      const finish = (fn, value) => { if (done) return; done = true; try { peer.destroy(); } catch { /* gone */ } fn(value); };
      const fail = (code, message) => finish(reject, error(code, message));
      const stored = (here, title, extra) => ({ status: 'kept', name: here, title, key: 'idb:' + here, url: packStore.url('levels', here) + 'levelpack.json', ...extra });
      peer.on('open', () => {
        const conn = peer.connect(from, { reliable: true });
        conn.on('open', () => {
          progress({ text: diff ? 'Connected — reading the list of files…' : 'Connected — fetching…' });
          conn.send({ t: 'ask', name, v: mine || '' });
        });
        conn.on('data', async msg => {
          if (!msg || done) return;
          if (msg.t === 'none') fail('none', `Your friend's browser isn't sharing ${msg.name || 'that pack'}.`);
          else if (msg.t === 'same') {
            const here = clean(msg.name);
            finish(resolve, { ...stored(here, msg.title), status: 'same', v: msg.v });
          } else if (msg.t === 'pack') {
            meta = msg;
            // every file this browser already holds, by hash, in any level
            // pack here — its own older copy of this one looked in first
            const own = clean(msg.name);
            let names = [];
            try { names = (await packStore.list('levels')).map(p => p.name).filter(n => !n.startsWith('__')); } catch { /* none */ }
            names.sort((a, b) => (b === own) - (a === own));
            const held = new Map();     // hash -> { pack, path }
            for (const pack of names) {
              let m = null;
              try { m = await packStore.manifest('levels', pack); } catch { /* unreadable: skip it */ }
              for (const f of m ? m.files : []) if (!held.has(f.hash)) held.set(f.hash, { pack, path: f.path });
            }
            const need = msg.files.filter(f => !held.has(f.hash));
            kept = msg.files.filter(f => held.has(f.hash)).map(f => ({ to: f.path, from: held.get(f.hash) }));
            total = need.reduce((n, f) => n + f.size, 0);
            const whole = msg.files.reduce((n, f) => n + f.size, 0);
            const update = names.includes(own);
            if (diff) {
              finish(resolve, { ...stored(own, msg.title), status: 'diff', v: msg.v, update, bytes: total, whole,
                fetch: need.map(f => ({ path: f.path, size: f.size })),
                here: kept.map(k => ({ path: k.to, pack: k.from.pack, as: k.from.path })) });
              return;
            }
            progress({ title: msg.title, got: 0, total,
              note: !kept.length ? `A level pack, ${msg.files.length} files, ${fmt(whole)}.`
                : `${update ? 'An update to the copy you have' : 'Some of it is here already'}: fetching ${need.length} of ${msg.files.length} files, ${fmt(total)} of ${fmt(whole)}.` });
            conn.send({ t: 'want', paths: need.map(f => f.path) });
          } else if (msg.t === 'file') {
            files.push({ name: msg.path, data: msg.data });
            got += msg.data.byteLength;
            progress({ text: `${fmt(got)} of ${fmt(total)} — ${msg.path}`, got, total });
            conn.send({ t: 'got', path: msg.path });
          } else if (msg.t === 'end') {
            // the rest, from whichever pack here has the same bytes
            const fetched = files.length;
            for (const k of kept) {
              const rec = await packStore.get('levels', k.from.pack, k.from.path).catch(() => null);
              if (!rec) { fail('gone', `${k.to} was taken out of this browser meanwhile — open the link again.`); return; }
              files.push({ name: k.to, data: rec.data });
            }
            progress({ text: 'Keeping it in this browser…' });
            try { await packStore.put('levels', meta.name, files, meta.title); }
            catch (err) { fail('store', 'Could not keep it: ' + err.message); return; }
            const here = clean(meta.name);
            finish(resolve, { ...stored(here, meta.title), v: meta.v, play: playUrl(here, files), fetched, fromHere: kept.length, bytes: total });
          }
        });
        conn.on('close', () => fail('closed', 'Your friend closed their page before it was all here. Ask them to share it again.'));
      });
      peer.on('error', err => err.type === 'peer-unavailable'
        ? fail('unavailable', "Your friend's share page isn't open right now — the link works whenever it is.")
        : fail('peer', 'Connection trouble: ' + (err.type || err.message)));
    });
  }

  return { fmt, pageUrl, clean, shareId, linkFor, playUrl, sharedNames, isShared, setShared, sources, sourceNamed, haveHere, listPacks, packInfo, deletePacks, zipPack, readPackZip, share, fetchPack };
})();
