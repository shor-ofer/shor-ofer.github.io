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
//   friend -> sharer  { t: 'ask', p: 2, name, v }   the pack its link names, and
//                                            the version of its own copy, if any
//   sharer -> friend  { t: 'same', name, title, v, card }   that is this
//                                                 version: nothing more is sent
//                     or { t: 'pack', name, title, v, card, files: [{ path, size, hash }] }
//                     or { t: 'none', name }  if this browser doesn't offer it
//   friend -> sharer  { t: 'want', paths, at }   the files whose hash no level
//                                            pack in this browser has — all of
//                                            them if it has none; at: { path:
//                                            bytes it has of one cut short }
//   sharer -> friend  { t: 'file', path, at, size, data: ArrayBuffer }   a piece,
//   friend -> sharer  { t: 'got', path, at }   every WINDOW pieces, and at a file's end
//   sharer -> friend  { t: 'end' }
// card is the pack's signed card (share/cards.js), or null where there can
// be none (plain http). Instead of 'ask', a friend may only ask what the
// newest version is:
//   friend -> sharer  { t: 'latest', id }       a card's pack id
//   sharer -> friend  { t: 'card', card }  or { t: 'none' }
// That is all a friend can say: nothing on this line writes or deletes. It
// gets answers only for public packs (isPublic); any other name is 'none', as
// if it weren't there.
//
// Files go in small pieces, each sent with room for the page to get on with
// things, as a browser's data channel can't take a large message and copying
// one holds up the page's thread — the game's, if it is the one playing. The
// friend's new copy is the files sent and, for the rest, the same bytes from
// whichever pack here has them; files the pack no longer has go. If the line
// drops, the friend asks again (another page of that browser takes over
// within moments) and fetches only what it still lacks. Everything is checked
// against the version it asked for before any of it is kept.
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
  // The link a pack here is fetched by; with `play`, the friend's browser
  // goes straight on into the game once it has it.
  const linkFor = (name, v, play) => `${pageUrl}?from=${encodeURIComponent(shareId())}&get=${encodeURIComponent(clean(name))}&v=${v}${play ? '&play' : ''}`;

  // Where a stored pack is played: its own index.html, the whole game, or the
  // engine's page on it if it came without one.
  const playUrl = (name, files) => {
    const dir = packStore.url('levels', name);
    return files.some(f => (f.path || f.name) === 'index.html') ? dir + 'index.html' : `/src/index.html?pack=${encodeURIComponent(dir + 'levelpack.json')}`;
  };
  const readStored = async name => Promise.all((await packStore.files('levels', name)).map(async f => ({ path: f.name, data: await f.data.arrayBuffer() })));

  // ---------- which packs are public, and whether this browser shares ----------
  // A pack is public unless it is marked private, here in this browser's
  // localStorage; the editor's passing copies (__) never are. Sharing as a
  // whole is on unless switched off: both belong to the browser, not to a page.
  const PRIVATE_KEY = 'wtwPrivatePacks', SHARING_KEY = 'wtwSharing', CHANNEL = 'wtw-share';
  const keyOf = name => clean(String(name).replace(/^idb:/, ''));
  function privateNames() {
    try { return new Set(JSON.parse(localStorage.getItem(PRIVATE_KEY) || '[]')); } catch { return new Set(); }
  }
  const isPublic = name => { const key = keyOf(name); return !key.startsWith('__') && !privateNames().has(key); };
  function setPublic(name, on) {
    const names = privateNames(), key = keyOf(name);
    if (on) names.delete(key); else names.add(key);
    try { localStorage.setItem(PRIVATE_KEY, JSON.stringify([...names].sort())); }
    catch { throw error('store', "This browser won't keep which packs are private (its storage is off)."); }
    return on;
  }
  // Every pack public again.
  function setAllPublic() {
    try { localStorage.removeItem(PRIVATE_KEY); } catch { /* none kept, then */ }
  }
  const sharingOn = () => { try { return localStorage.getItem(SHARING_KEY) !== 'off'; } catch { return false; } };
  function setSharing(on) {
    try { localStorage.setItem(SHARING_KEY, on ? 'on' : 'off'); }
    catch { throw error('store', "This browser won't keep that (its storage is off)."); }
    const room = new BroadcastChannel(CHANNEL);
    room.postMessage({ t: 'switch' });
    room.close();
    return on;
  }

  // How sharing stands, from the pages of this browser (src/js/sharehost.js):
  //   { enabled, state, id, page, pages, served, trouble }
  // state: 'off', 'sharing', 'connecting', or 'nopage' if no page answered.
  // Asks again until one is sharing, or `wait` ms have gone.
  function sharingStatus(wait = 2500) {
    if (!sharingOn()) return Promise.resolve({ enabled: false, state: 'off', id: shareId(), page: '', pages: 0, served: 0, trouble: '' });
    return new Promise(resolve => {
      const room = new BroadcastChannel(CHANNEL), from = 'ask-' + Math.random().toString(36).slice(2);
      const answers = new Map();
      room.onmessage = e => { if (e.data && e.data.t === 'here' && e.data.to === from) answers.set(e.data.page + answers.size, e.data); };
      const started = Date.now();
      const round = () => {
        answers.clear();
        room.postMessage({ t: 'who', from });
        setTimeout(() => {
          const all = [...answers.values()];
          const master = all.find(a => a.state === 'sharing') || all.find(a => a.state === 'connecting');
          if (!(master && master.state === 'sharing') && Date.now() - started < wait) { round(); return; }
          room.close();
          resolve({ enabled: true, state: master ? master.state : 'nopage', id: shareId(), page: master ? master.page : '', pages: all.length,
            served: master ? master.served : 0, trouble: master ? master.trouble : '' });
        }, 250);
      };
      round();
    });
  }
  // Calls fn with what happens in the room: { t: 'state', state, trouble, page },
  // { t: 'friend', friend, title, text, state, progress }, { t: 'switch' }.
  // Returns what stops it.
  function watchSharing(fn) {
    const room = new BroadcastChannel(CHANNEL);
    room.onmessage = e => { if (e.data && ['state', 'friend', 'switch'].includes(e.data.t)) fn(e.data); };
    return () => room.close();
  }

  // Where a pack here starts playing at its first level, its menu skipped
  // (?play=1): its own page — unless that page is from before ?play, when it
  // would open at its menu, and this engine plays the pack instead.
  async function startUrl(key) {
    const src = await sourceNamed(key);
    if (!src) throw error('missing', `There is no level pack called ${key} here.`);
    const files = (await src.manifest()).files;
    let page = src.play(files);
    if (/\/index\.html$/.test(page) && !new TextDecoder().decode(await src.read('index.html')).includes('wtw:play')) {
      page = `/src/index.html?pack=${encodeURIComponent(page.replace(/index\.html$/, 'levelpack.json'))}`;
    }
    return page + (page.includes('?') ? '&' : '?') + 'play=1';
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
          version: async function () { return (await this.manifest()).v; },
          manifest: async function () { return packStore.manifestOf(await this.load()); },
          read: async path => {
            const r = await fetch(p.dir + path, { cache: 'no-store' });
            if (!r.ok) throw new Error(`${p.dir}${path}: ${r.status}`);
            return r.arrayBuffer();
          },
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
          manifest: () => packStore.manifest('levels', p.name),
          read: async path => {
            const rec = await packStore.get('levels', p.name, path);
            if (!rec) throw new Error(`${path} isn't in ${p.name}`);
            return new Response(rec.data).arrayBuffer();
          },
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
      const e = typeof ShareCards !== 'undefined' && ShareCards.stored(p.name);
      const card = e && m && e.card.v === m.v ? e.card : null;
      out.push({ name: p.name, title: p.title || p.name, files: p.count, size: m ? m.files.reduce((n, f) => n + f.size, 0) : null,
        v: m ? m.v : null, id: card ? card.id : null, seq: card ? card.seq : null, public: isPublic(p.name), updated: new Date(p.updated).toISOString(), url: packStore.url('levels', p.name) });
    }
    return out;
  }

  // One pack's version and every file in it, from this browser or from disk.
  async function packInfo(name) {
    const src = await sourceNamed(name);
    if (!src) throw error('missing', `There is no level pack called ${name} here.`);
    // one kept here has its manifest saved with it; one on disk is read
    const m = src.key.startsWith('idb:') ? await packStore.manifest('levels', src.name) : await packStore.manifestOf(await src.load());
    return { name: src.name, title: src.title, key: src.key, where: src.key.startsWith('idb:') ? 'browser' : 'disk', url: src.dir,
      public: isPublic(src.name), v: m.v, size: m.files.reduce((n, f) => n + f.size, 0), files: m.files };
  }

  // A pack — kept here or on disk — as a .zip of its files at their paths,
  // as levelpacks/<name>/ holds them.
  async function zipPack(name) {
    const src = await sourceNamed(name);
    if (!src) throw error('missing', `There is no level pack called ${name} here.`);
    const files = (await src.load()).filter(f => f.path !== 'card.json');
    // its card beside its files, as a web folder it is put up in has it
    const card = typeof ShareCards !== 'undefined' ? await ShareCards.cardOrNull(src.key) : null;
    const blob = zipBlob([...files.map(f => ({ name: f.path, data: new Uint8Array(f.data) })),
      ...card ? [{ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(card, null, 1)) }] : []]);
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
    const files = [...all].filter(([k]) => k.startsWith(root) && k !== root + 'card.json').map(([k, data]) => ({ name: k.slice(root.length), data }));
    let card = null;
    try { card = all.has(root + 'card.json') ? JSON.parse(new TextDecoder().decode(all.get(root + 'card.json'))) : null; } catch { /* none, then */ }
    const here = clean(name || root.split('/').filter(Boolean).pop() || file.name.replace(/\.zip$/i, ''));
    let title = here;
    try { title = JSON.parse(new TextDecoder().decode(all.get(lib))).name || here; } catch { /* its name, then */ }
    return { name: here, title, files, card };
  }

  // Deletes from this browser's store one pack, or every one; the names gone.
  async function deletePacks(names) {
    const gone = [];
    for (const name of names) {
      await packStore.remove('levels', name);
      try { setPublic(name, true); } catch { /* not kept anyway */ }
      try { if (typeof ShareCards !== 'undefined') ShareCards.forget(name); } catch { /* as above */ }
      gone.push(name);
    }
    return gone;
  }

  // ---------- sharing ----------
  // The size of a file's pieces, in bytes, just under PeerJS's own (16300), so
  // it has no whole file to pack and cut up; and how many go between answers.
  const PIECE = 16000, WINDOW = 16;
  const later = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Room for the page to do something else. Not a timer: a tab in the
  // background runs those about once a second at best.
  const breath = () => new Promise(resolve => {
    const c = new MessageChannel();
    c.port1.onmessage = () => { c.port1.close(); resolve(); };
    c.port2.postMessage(0);
  });

  // The master's line to friends (src/js/sharehost.js holds one in one page
  // of this browser), until close(): under this browser's id, answering each
  // friend for this browser's public packs. It keeps trying — the id may be
  // the last master's for a moment. `on` gets: ready(id), friend(n, { title,
  // text, state, progress }), idle() when the last friend goes, trouble(text).
  // pause() is how long to wait between a file's pieces just now, in ms.
  function host(on, { pause = () => 0 } = {}) {
    let peer = null, closed = false, friends = 0, again = 0, open = 0;
    const retry = ms => { if (!closed && !again) again = setTimeout(() => { again = 0; start(); }, ms); };
    const start = () => {
      if (closed) return;
      peer = new Peer(shareId());
      const mine = peer;
      mine.on('open', id => on.ready(id));
      mine.on('connection', conn => {
        const n = ++friends;
        open++;
        let gone = false;
        const left = () => { if (gone) return; gone = true; if (--open === 0 && on.idle) on.idle(); };
        conn.on('close', left);
        conn.on('error', left);
        serve(conn, report => on.friend(n, report), pause);
      });
      mine.on('disconnected', () => {
        if (closed || mine.destroyed) return;
        on.trouble('Lost the broker — reconnecting…');
        setTimeout(() => { if (!closed && !mine.destroyed && mine.disconnected) mine.reconnect(); }, 3000);
      });
      mine.on('close', () => retry(2000 + Math.random() * 1000));
      mine.on('error', err => {
        if (err.type === 'unavailable-id') { on.trouble("This browser's id is still taken — waiting for it…"); mine.destroy(); return; }
        on.trouble('Connection trouble: ' + (err.type || err.message));
        if (mine.destroyed) retry(10000);
      });
    };
    start();
    return { busy: () => open > 0, close() { closed = true; clearTimeout(again); if (peer) peer.destroy(); } };
  }

  // One friend: the public pack it asks for, its manifest, then the files it
  // wants, piece by piece. Reports { title, text, state: ''|'ok'|'err',
  // progress: 0..1 } as it goes.
  function serve(conn, report, pause = () => 0) {
    let pack = null, list = [], title = '', wanted = false, finished = false, answered = null;
    const tell = (text, state = '', progress) => report({ title, text, state, progress });
    tell('connecting…');
    const fail = text => { finished = true; tell(text, 'err'); if (answered) answered(); };
    const cardOf = name => typeof ShareCards !== 'undefined' ? ShareCards.cardOrNull(name) : null;

    async function send(paths, at) {
      const files = list.filter(f => paths.has(f.path));
      const from = f => { const n = at && at[f.path]; return Number.isInteger(n) && n > 0 ? Math.min(n, f.size) : 0; };
      const size = files.reduce((t, f) => t + f.size - from(f), 0);
      let sent = 0;
      for (const f of files) {
        const bytes = new Uint8Array(await pack.read(f.path));
        let i = from(f), since = 0;
        do {
          if (finished) return;
          const piece = bytes.slice(i, i + PIECE);
          conn.send({ t: 'file', path: f.path, at: i, size: bytes.length, data: piece.buffer });
          i += piece.length;
          sent += piece.length;
          if (i >= bytes.length || ++since >= WINDOW) {
            since = 0;
            await new Promise(resolve => { answered = resolve; });
            answered = null;
            if (finished) return;
            tell(`${fmt(sent)} of ${fmt(size)}`, '', sent / (size || 1));
          } else await breath();
          const ms = pause();
          if (ms) await later(ms);
        } while (i < bytes.length);
      }
      finished = true;
      conn.send({ t: 'end' });
      tell(files.length === list.length ? `sent, ${fmt(size)}` : files.length ? `sent ${files.length} changed of ${list.length} files, ${fmt(size)}` : 'had it all already', 'ok', 1);
    }

    conn.on('data', async msg => {
      if (msg && msg.t === 'latest') {
        // the newest card here of a pack id: a public pack's only
        const name = typeof ShareCards !== 'undefined' && ShareCards.nameOf(String(msg.id));
        const card = name && isPublic(name) ? await cardOf('idb:' + name) : null;
        conn.send(card && card.id === msg.id ? { t: 'card', card } : { t: 'none' });
        finished = true;
        tell(card ? `asked for the newest ${card.title}: version ${card.seq}` : `asked for the newest ${msg.id}, which isn't offered`, card ? 'ok' : 'err', 1);
        return;
      }
      if (msg && msg.t === 'ask') {
        const name = String(msg.name || '');
        // a page from before files went in pieces wouldn't understand them
        if (msg.p !== 2) { conn.send({ t: 'none', name }); fail('its page is out of date: it has to reload'); return; }
        // only a public pack, any other as if it weren't here
        const src = isPublic(name) ? await sourceNamed(name) : null;
        if (!src) { conn.send({ t: 'none', name }); fail(`asked for ${name}, which isn't offered`); return; }
        let manifest;
        try { manifest = await src.manifest(); }
        catch (err) { conn.send({ t: 'none', name }); fail('could not read it: ' + err.message); return; }
        pack = src;
        list = manifest.files;
        title = src.title;
        if (msg.v && msg.v === manifest.v) {
          conn.send({ t: 'same', name: src.name, title: src.title, v: manifest.v, card: await cardOf(src.key) });
          finished = true;
          tell('had this version already', 'ok', 1);
          return;
        }
        conn.send({ t: 'pack', name: src.name, title: src.title, v: manifest.v, card: await cardOf(src.key), files: manifest.files });
        tell('reading its list of files…');
        return;
      }
      if (msg && msg.t === 'want' && Array.isArray(msg.paths) && pack) {
        wanted = true;
        send(new Set(msg.paths), msg.at).catch(err => fail('could not send it: ' + err.message));
        return;
      }
      if (msg && msg.t === 'got' && answered) answered();
    });
    conn.on('close', () => {
      if (finished) return;
      // &diff: it read the list and fetched nothing
      if (list.length && !wanted) { finished = true; tell('only looked at what it would fetch'); return; }
      fail('left before the end');
    });
    conn.on('error', err => fail('failed: ' + err.message));
  }

  // Every file this browser holds, by hash, in any level pack here, `own`'s
  // looked in first: hash -> { pack, path }; .packs, the packs looked in.
  async function heldFiles(own) {
    let names = [];
    try { names = (await packStore.list('levels')).map(p => p.name).filter(n => !n.startsWith('__')); } catch { /* none */ }
    names.sort((a, b) => (b === own) - (a === own));
    const held = new Map();
    for (const pack of names) {
      let m = null;
      try { m = await packStore.manifest('levels', pack); } catch { /* unreadable: skip it */ }
      for (const f of m ? m.files : []) if (!held.has(f.hash)) held.set(f.hash, { pack, path: f.path });
    }
    held.packs = names;
    return held;
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
      // Tries left: a browser just changing master answers within moments, and
      // one cut off mid-way is worth waiting for longer.
      const TRIES_BEFORE = 1, TRIES_DURING = 10, GAP = 2500, SILENCE = 8000;
      let meta = null, need = [], kept = [], got = 0, total = 0, done = false, ending = false;
      let conn = null, tries = 0, silence = 0, since = 0;
      const have = new Map();     // path -> { hash, data }: whole files here
      let part = null;            // { path, hash, parts, at }: the file under way
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(silence);
        try { peer.destroy(); } catch { /* gone */ }
        fn(value);
      };
      const fail = (code, message) => finish(reject, error(code, message));
      const stored = (here, title, extra) => ({ status: 'kept', name: here, title, key: 'idb:' + here, url: packStore.url('levels', here) + 'levelpack.json', ...extra });

      // The line is gone or quiet: ask again, for what is still wanted.
      const dropped = () => {
        if (done || ending) return;
        clearTimeout(silence);
        const was = conn;
        conn = null;
        try { if (was) was.close(); } catch { /* gone */ }
        if (++tries > (meta ? TRIES_DURING : TRIES_BEFORE)) {
          if (meta) fail('closed', 'Your friend closed their browser before it was all here. Ask them to open any page of the game again.');
          else fail('unavailable', "Your friend's browser isn't sharing right now — the link works whenever a page of the game is open there.");
          return;
        }
        if (meta) progress({ text: 'The line dropped — asking again…' });
        setTimeout(() => { if (!done && !conn && !peer.destroyed) connect(); }, GAP);
      };
      const heard = () => { clearTimeout(silence); silence = setTimeout(dropped, SILENCE); };

      async function onPack(msg) {
        meta = msg;
        // every file this browser already holds, by hash, in any level pack
        // here, its own older copy of this one looked in first
        const own = clean(msg.name);
        const held = await heldFiles(own);
        const update = held.packs.includes(own);
        need = msg.files.filter(f => !held.has(f.hash));
        kept = msg.files.filter(f => held.has(f.hash)).map(f => ({ to: f.path, from: held.get(f.hash) }));
        total = need.reduce((n, f) => n + f.size, 0);
        const whole = msg.files.reduce((n, f) => n + f.size, 0);
        if (diff) {
          finish(resolve, { ...stored(own, msg.title), status: 'diff', v: msg.v, update, bytes: total, whole,
            fetch: need.map(f => ({ path: f.path, size: f.size })),
            here: kept.map(k => ({ path: k.to, pack: k.from.pack, as: k.from.path })) });
          return;
        }
        // asked again after a drop: what came is good if it is still that file
        for (const [path, h] of have) if (!need.some(f => f.path === path && f.hash === h.hash)) have.delete(path);
        if (part && !need.some(f => f.path === part.path && f.hash === part.hash)) part = null;
        const left = need.filter(f => !have.has(f.path));
        got = [...have.values()].reduce((n, h) => n + h.data.length, 0) + (part ? part.at : 0);
        since = 0;
        progress({ title: msg.title, got, total,
          note: !kept.length ? `A level pack, ${msg.files.length} files, ${fmt(whole)}.`
            : `${update ? 'An update to the copy you have' : 'Some of it is here already'}: fetching ${need.length} of ${msg.files.length} files, ${fmt(total)} of ${fmt(whole)}.` });
        conn.send({ t: 'want', paths: left.map(f => f.path), at: part ? { [part.path]: part.at } : {} });
      }

      function onPiece(msg) {
        if (msg.at === undefined) { fail('old', "Your friend's page is out of date — ask them to reload it."); return; }
        if (!part || part.path !== msg.path) {
          const f = need.find(x => x.path === msg.path);
          if (!f) return;
          part = { path: msg.path, hash: f.hash, parts: [], at: 0 };
        }
        if (msg.at !== part.at) { dropped(); return; }    // out of step: ask again from here
        const bytes = new Uint8Array(msg.data);
        part.parts.push(bytes);
        part.at += bytes.length;
        got += bytes.length;
        progress({ text: `${fmt(got)} of ${fmt(total)} — ${msg.path}`, got, total });
        const whole = part.at >= msg.size;
        if (whole || ++since >= WINDOW) {
          since = 0;
          conn.send({ t: 'got', path: msg.path, at: part.at });
        }
        if (!whole) return;
        const data = new Uint8Array(part.at);
        let i = 0;
        for (const b of part.parts) { data.set(b, i); i += b.length; }
        have.set(part.path, { hash: part.hash, data });
        part = null;
      }

      async function onEnd() {
        ending = true;
        clearTimeout(silence);
        const files = need.map(f => ({ name: f.path, data: have.get(f.path)?.data }));
        if (files.some(f => !f.data)) { ending = false; dropped(); return; }
        const fetched = files.length;
        // the rest, from whichever pack here has the same bytes
        for (const k of kept) {
          const rec = await packStore.get('levels', k.from.pack, k.from.path).catch(() => null);
          if (!rec) { fail('gone', `${k.to} was taken out of this browser meanwhile — open the link again.`); return; }
          files.push({ name: k.to, data: rec.data });
        }
        progress({ text: 'Checking it…' });
        // what came is the version asked for, or none of it is kept
        if ((await packStore.manifestOf(files)).v !== meta.v) { fail('changed', "What came isn't the version your friend's browser named — nothing was kept."); return; }
        progress({ text: 'Keeping it in this browser…' });
        try { await packStore.put('levels', meta.name, files, meta.title); }
        catch (err) { fail('store', 'Could not keep it: ' + err.message); return; }
        const here = clean(meta.name);
        // its card, if good and this version's, and that it came from `from`
        if (meta.card && typeof ShareCards !== 'undefined') await ShareCards.arrived(here, meta.card, from, meta.v).catch(() => null);
        finish(resolve, { ...stored(here, meta.title), v: meta.v, play: playUrl(here, files), fetched, fromHere: kept.length, bytes: total });
      }

      function connect() {
        const line = peer.connect(from, { reliable: true });
        conn = line;
        heard();
        line.on('open', () => {
          if (line !== conn) return;
          progress({ text: diff ? 'Connected — reading the list of files…' : 'Connected — fetching…' });
          line.send({ t: 'ask', p: 2, name, v: mine || '' });
        });
        line.on('data', async msg => {
          if (!msg || done || line !== conn) return;
          heard();
          if (msg.t === 'none') fail('none', `Your friend's browser isn't sharing ${msg.name || 'that pack'}.`);
          else if (msg.t === 'same') {
            const here = clean(msg.name);
            if (msg.card && typeof ShareCards !== 'undefined') await ShareCards.arrived(here, msg.card, from, msg.v).catch(() => null);
            finish(resolve, { ...stored(here, msg.title), status: 'same', v: msg.v });
          }
          else if (msg.t === 'pack') await onPack(msg);
          else if (msg.t === 'file') onPiece(msg);
          else if (msg.t === 'end') await onEnd();
        });
        line.on('close', () => { if (line === conn) dropped(); });
      }

      peer.on('open', connect);
      peer.on('error', err => err.type === 'peer-unavailable' ? dropped() : fail('peer', 'Connection trouble: ' + (err.type || err.message)));
    });
  }

  return { fmt, pageUrl, clean, shareId, linkFor, playUrl, startUrl, CHANNEL, privateNames, isPublic, setPublic, setAllPublic, sharingOn, setSharing, sharingStatus, watchSharing, sources, sourceNamed, haveHere, listPacks, packInfo, deletePacks, zipPack, readPackZip, host, heldFiles, fetchPack };
})();
