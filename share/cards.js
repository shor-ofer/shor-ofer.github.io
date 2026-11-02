// share/cards.js — who made a level pack, and where its newest version is,
// with no server. Over share/core.js.
//
// Each browser is an author: a signing key made once (ECDSA P-256), kept in
// its localStorage, and an author id, 12 hex of its public key's SHA-256.
// A pack it makes is <author id>/<name> — the same name from two authors is
// two packs — and goes about with a card the author signs:
//
//   { wtw: 'card', id: 'k3f9a2c01b7e/garden', name, title,
//     seq,                    1, 2, 3… — each new version the author signs
//     v, files: [{ path, size, hash }],   the version and every file in it
//     origin,                 the author's share id: the browser to ask first
//     web: [url, …],          folders the pack is put up in, each with this
//                             card as card.json beside the files
//     author: { name, key: { x, y } }, made, sig }
//
// Nobody but the author can sign a card for its id, and a card's files are
// signed with it, so a copy passed on by anyone is as good as the author's:
// files whose hash isn't the card's aren't kept. The highest seq wins, so an
// older copy can't pass for the newest.
//
// This browser keeps, for each pack it has, the card it came with (or made
// here) and the browsers it came from — those it can ask again. latest()
// asks the author's browser, those, and the card's web folders for a newer
// card; update() fetches it from whichever had it: only the files not here.
//
// Signing and checking need crypto.subtle — https, or localhost.
const ShareCards = (() => {
  const C = ShareCore;
  const subtle = crypto.subtle;
  const error = (code, message) => Object.assign(new Error(message), { code });
  const need = () => { if (!subtle) throw error('insecure', 'Signing needs https (or localhost) — this page is plain http.'); };
  const enc = s => new TextEncoder().encode(s);
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIGN = { name: 'ECDSA', hash: 'SHA-256' };
  const isUrl = u => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
  const folder = u => u.endsWith('/') ? u : u + '/';

  // ---------- the author ----------
  const AUTHOR_KEY = 'wtwAuthor';
  const authorIdOf = async key => hex(await subtle.digest('SHA-256', enc(key.x + '.' + key.y))).slice(0, 12);
  function readAuthor() {
    try { const a = JSON.parse(localStorage.getItem(AUTHOR_KEY) || 'null'); return a && a.key && a.d ? a : null; } catch { return null; }
  }
  function keepAuthor(a) {
    try { localStorage.setItem(AUTHOR_KEY, JSON.stringify({ name: a.name || '', key: a.key, d: a.d, made: a.made })); }
    catch { throw error('store', "This browser won't keep an author key (its storage is off)."); }
  }
  // This browser's author — made the first time it is asked for.
  async function author() {
    need();
    let a = readAuthor();
    if (!a) {
      const pair = await subtle.generateKey(ALG, true, ['sign', 'verify']);
      const jwk = await subtle.exportKey('jwk', pair.privateKey);
      a = { name: '', key: { x: jwk.x, y: jwk.y }, d: jwk.d, made: new Date().toISOString() };
      keepAuthor(a);
    }
    return { ...a, id: await authorIdOf(a.key) };
  }
  const whoAmI = async () => { const a = await author(); return { id: a.id, name: a.name, made: a.made }; };
  async function setName(name) { const a = await author(); a.name = String(name).trim().slice(0, 60); keepAuthor(a); return whoAmI(); }
  // The key as a file to keep: whoever has it can sign new versions of every
  // pack made here — and nobody can without it, this browser included once
  // its storage is cleared.
  async function exportAuthor() { const a = await author(); return { wtw: 'author', id: a.id, name: a.name, key: a.key, d: a.d, made: a.made }; }
  async function importAuthor(obj) {
    need();
    if (!obj || obj.wtw !== 'author' || !obj.key || !obj.d) throw error('notauthor', 'That is no author key file.');
    try { await privKey(obj); } catch { throw error('notauthor', "That author key file's key is broken."); }
    keepAuthor(obj);
    return whoAmI();
  }
  const privKey = a => subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: a.key.x, y: a.key.y, d: a.d, ext: true }, ALG, false, ['sign']);
  const pubKey = k => subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: k.x, y: k.y, ext: true }, ALG, false, ['verify']);

  // ---------- cards ----------
  // What is signed: a card's fields in this order, whatever order they came in.
  const body = c => JSON.stringify({ wtw: 'card', id: c.id, name: c.name, title: c.title, seq: c.seq, v: c.v,
    files: c.files.map(f => ({ path: f.path, size: f.size, hash: f.hash })), origin: c.origin, web: c.web,
    author: { name: c.author.name, key: { x: c.author.key.x, y: c.author.key.y } }, made: c.made });

  async function sign(fields) {
    const a = await author();
    const c = { wtw: 'card', ...fields, origin: C.shareId(), author: { name: a.name, key: a.key }, made: new Date().toISOString() };
    c.sig = b64(await subtle.sign(SIGN, await privKey(a), enc(body(c))));
    return { ...JSON.parse(body(c)), sig: c.sig };
  }

  // Whether a card is whole and its author's: the id is that key's, the
  // signature is good, and its version is its files'.
  async function verify(c) {
    try {
      if (!subtle || !c || c.wtw !== 'card' || typeof c.id !== 'string' || !Number.isInteger(c.seq) || c.seq < 1
        || !Array.isArray(c.files) || !Array.isArray(c.web) || !c.web.every(isUrl) || !c.author || !c.author.key || typeof c.sig !== 'string') return false;
      const [aid, name, more] = c.id.split('/');
      if (more !== undefined || name !== C.clean(c.name) || aid !== await authorIdOf(c.author.key)) return false;
      if ((await packStore.manifestFrom(c.files)).v !== c.v) return false;
      return await subtle.verify(SIGN, await pubKey(c.author.key), unb64(c.sig), enc(body(c)));
    } catch { return false; }
  }
  // A card as it came, checked: only its own fields, or null.
  const checked = async c => c && await verify(c) ? { ...JSON.parse(body(c)), sig: c.sig } : null;

  // ---------- the cards kept here ----------
  // name -> { card, peers: [share ids it came from] }
  const CARDS_KEY = 'wtwCards';
  function kept() { try { return JSON.parse(localStorage.getItem(CARDS_KEY) || '{}') || {}; } catch { return {}; } }
  function save(all) {
    try { localStorage.setItem(CARDS_KEY, JSON.stringify(all)); }
    catch { throw error('store', "This browser won't keep pack cards (its storage is off or full)."); }
  }
  const stored = name => kept()[C.clean(String(name).replace(/^idb:/, ''))] || null;
  // Keeps a pack's card, and the browser it came from with those before — of
  // that same pack id; another id starts afresh.
  function remember(name, card, from) {
    const all = kept(), key = C.clean(name), old = all[key];
    const before = old && old.card.id === card.id ? old.peers : [];
    const peers = [...new Set([from, ...before])].filter(p => p && p !== card.origin && p !== C.shareId()).slice(0, 8);
    all[key] = { card, peers };
    save(all);
  }
  function forget(name) { const all = kept(); delete all[C.clean(name)]; save(all); }
  // The pack kept here under a card id, if any.
  const nameOf = id => Object.entries(kept()).find(([, e]) => e.card.id === id)?.[0] || null;

  // The card for a pack here at its version now: the one it came with, or
  // one signed here — the next of this author's if the pack is this
  // browser's, a pack of its own if it changed someone else's. `web` sets
  // the folders it is put up in (this browser's packs only).
  async function cardFor(name, { web } = {}) {
    const info = await C.packInfo(name);
    const old = stored(info.name);
    const me = await author();
    const mine = old && old.card.id === `${me.id}/${C.clean(info.name)}`;
    if (web !== undefined) {
      if (old && !mine && old.card.v === info.v) throw error('notyours', `${info.title} is ${old.card.author.name || old.card.id.split('/')[0]}'s — only its author can say where it is put up.`);
      if (!web.every(isUrl)) throw error('usage', 'A web folder is an http(s) address.');
      web = web.map(folder);
    }
    const sameWeb = web === undefined || JSON.stringify(web) === JSON.stringify(old ? old.card.web : []);
    if (old && old.card.v === info.v && sameWeb) return old.card;
    const card = await sign({ id: `${me.id}/${C.clean(info.name)}`, name: C.clean(info.name), title: info.title,
      seq: mine ? old.card.seq + 1 : 1, v: info.v, files: info.files,
      web: web !== undefined ? web : mine ? old.card.web : [] });
    remember(info.name, card, null);
    return card;
  }
  // ... or null where cards can't be (plain http) or the pack can't be read.
  const cardOrNull = name => subtle ? cardFor(name).catch(() => null) : Promise.resolve(null);

  // A card come with a pack from `from` (a share id, or null): kept if it is
  // good and is the version the pack's files are.
  async function arrived(name, card, from, v) {
    const c = await checked(card);
    if (c && (!v || c.v === v)) { remember(name, c, from); return c; }
    return null;
  }

  // ---------- the newest version ----------
  // Asks the browsers it may be at — the author's, then those it came from —
  // and the card's web folders, for the newest card of the pack kept here as
  // `name`. Each answer is checked. { name, id, seq, v, newest, tried }:
  // newest is { card, from: { peer } | { web } } if any is newer than here.
  async function latest(name, { timeout = 8000 } = {}) {
    need();
    const entry = stored(name);
    if (!entry) throw error('nocard', `${name} has no card here — it came without one. (share card ${name} makes one for a pack of yours.)`);
    const here = entry.card, found = [], tried = [];
    const take = async (card, from, what) => {
      const c = await checked(card);
      if (!c || c.id !== here.id) { tried.push({ from: what, answer: c ? 'another pack' : 'a card that is not good' }); return; }
      tried.push({ from: what, answer: `version ${c.seq} (${c.v})` });
      found.push({ card: c, from });
    };
    const fromWeb = here.web.map(async url => {
      try {
        const res = await fetch(new URL('card.json', url), { cache: 'no-store' });
        if (!res.ok) { tried.push({ from: url, answer: `${res.status}` }); return; }
        await take(await res.json(), { web: url }, url);
      } catch (err) { tried.push({ from: url, answer: 'not reachable' }); }
    });
    const peers = [...new Set([here.origin, ...entry.peers])].filter(p => p && p !== C.shareId());
    await Promise.all([...fromWeb, askPeers(peers, here.id, timeout, take, tried)]);
    const best = found.reduce((b, x) => !b || x.card.seq > b.card.seq ? x : b, null);
    return { name: C.clean(name), title: here.title, id: here.id, seq: here.seq, v: here.v,
      newest: best && best.card.seq > here.seq ? best : null, tried };
  }

  // Each browser asked { t: 'latest', id } at once, over one line to the
  // broker; those that don't answer by `timeout` aren't there now.
  function askPeers(ids, id, timeout, take, tried) {
    if (!ids.length) return Promise.resolve();
    if (typeof Peer === 'undefined') { ids.forEach(p => tried.push({ from: p, answer: 'no PeerJS here' })); return Promise.resolve(); }
    return new Promise(resolve => {
      const peer = new Peer(), left = new Set(ids), waits = [];
      const done = (p, answer) => { if (!left.delete(p)) return; if (answer) tried.push({ from: p, answer }); if (!left.size) end(); };
      const end = () => { clearTimeout(timer); try { peer.destroy(); } catch { /* gone */ } Promise.all(waits).then(resolve); };
      const timer = setTimeout(() => [...left].forEach(p => done(p, 'not there now')), timeout);
      peer.on('open', () => ids.forEach(p => {
        const conn = peer.connect(p, { reliable: true });
        conn.on('open', () => conn.send({ t: 'latest', id }));
        conn.on('data', msg => {
          if (!msg || !left.has(p)) return;
          if (msg.t === 'card') { const w = take(msg.card, { peer: p }, p); waits.push(w); w.then(() => done(p)); }
          else done(p, msg.t === 'none' ? 'not sharing it' : 'an answer it should not give');
          conn.close();
        });
      }));
      peer.on('error', err => {
        const p = ids.find(x => String(err.message).includes(x));
        if (p) done(p, 'not there now');
        else if (err.type !== 'peer-unavailable') [...left].forEach(x => done(x, 'connection trouble: ' + (err.type || err.message)));
      });
    });
  }

  // Fetches the newest card latest() found: from that browser (only the
  // files not here) or that web folder (the same). Resolves with the
  // version now here.
  async function update(name, newest, progress = () => {}) {
    const card = newest.card;
    if (newest.from.peer) {
      const r = await C.fetchPack({ from: newest.from.peer, name: card.name, check: true }, progress);
      const now = await packStore.manifest('levels', r.name);
      if (!now || now.v !== card.v) throw error('changed', `${newest.from.peer} sent another version than its card said — try again.`);
      return { ...r, seq: card.seq };
    }
    const url = newest.from.web;
    const held = await C.heldFiles(card.name);
    const files = [];
    let bytes = 0, got = 0;
    const need = card.files.filter(f => !held.has(f.hash));
    const total = need.reduce((n, f) => n + f.size, 0);
    for (const f of card.files) {
      const h = held.get(f.hash);
      if (h) { const rec = await packStore.get('levels', h.pack, h.path); if (rec) { files.push({ name: f.path, data: rec.data }); continue; } }
      const res = await fetch(new URL(f.path, url), { cache: 'no-store' });
      if (!res.ok) throw error('web', `${url}${f.path}: ${res.status}`);
      const data = await res.arrayBuffer();
      if (await packStore.hash(new Uint8Array(data)) !== f.hash) throw error('changed', `${url}${f.path} isn't the file its card names — not kept.`);
      files.push({ name: f.path, data });
      bytes += data.byteLength; got++;
      progress({ text: `${C.fmt(bytes)} of ${C.fmt(total)} — ${f.path}`, got: bytes, total });
    }
    await packStore.put('levels', card.name, files, card.title);
    remember(card.name, card, null);
    return { status: 'kept', name: card.name, title: card.title, v: card.v, seq: card.seq, key: 'idb:' + card.name,
      url: packStore.url('levels', card.name) + 'levelpack.json', play: C.playUrl(card.name, files), fetched: got, fromHere: files.length - got, bytes };
  }

  return { author, whoAmI, setName, exportAuthor, importAuthor, verify, checked, stored, remember, forget, nameOf, cardFor, cardOrNull, arrived, latest, update };
})();
