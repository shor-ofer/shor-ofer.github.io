// share/commands.js — every command of the share page, in one table. A
// command's name is its URL parameter and its word on share/cli.html's
// command line; its options are parameters too, each a -flag there:
//
//   share/?del=garden             share del garden
//   share/?get=x&from=wtw-…&diff  share get x -from wtw-… -diff
//
// so the two never drift apart: cli.html knows no command of its own — it
// turns a command line into the page's address (toQuery), runs it there with
// &text (or &json), and prints what comes back. A command added here works
// on both.
//
// Each command: name, `value` (what the parameter holds; a trailing ? if it
// may be left out), `options` ({ name: what it holds — a trailing ! if it must
// be given — or '' for a bare flag }),
// `about`, and run(params, io) → plain data, where io is
//   progress(data)   how it is going
//   event(data)      something that happened, for a command that goes on
//   stay()           it goes on (sharing) until its page is closed
//   confirm(text)    → Promise<boolean>: asks the one running it
//   save(blob, filename)   hands a file to the one running it, to keep
//   pick(accept, text)     → Promise<File|null>: asks them for a file
// and, for &text, `text(result)` and `eventText(event)` — without them the
// data is laid out as it comes (plain()): a list of records as a table, a
// record as aligned lines. The share page also has views of its own for some
// (share/index.html).
const ShareCommands = (() => {
  const C = ShareCore, K = ShareCards;
  const needs = (value, what) => { if (!value) throw Object.assign(new Error(`It needs ${what}.`), { code: 'usage' }); return value; };

  const fmt = C.fmt;
  // A pack here by name, or the error of there being none.
  const packNamed = async name => {
    const src = await C.sourceNamed(name);
    if (!src) throw Object.assign(new Error(`There is no level pack called ${name} here.`), { code: 'missing' });
    return src;
  };
  const offNote = r => r.sharing === false ? '\nSharing is off in this browser: nobody can fetch anything until `share sharing on`.' : '';
  const statusText = r => ({
    off: 'Sharing is off in this browser.',
    sharing: `Sharing is on: this browser answers friends, through ${r.page || 'one of its pages'} (${r.pages} page${r.pages === 1 ? '' : 's'} open).`,
    connecting: `Sharing is on, and connecting through ${r.page || 'one of its pages'}…${r.trouble ? ` ${r.trouble}` : ''}`,
    nopage: 'Sharing is on, but no page of the game or its tools is open to answer.'
  }[r.state] || r.state);
  const day = iso => iso ? iso.slice(0, 16).replace('T', ' ') : '';

  const COMMANDS = [
    { name: 'help', about: 'every command — this list',
      run: () => COMMANDS.map(describe),
      text: rows => rows.map(d => `${d.command}\n    ${d.about}\n    ${d.url}`).join('\n\n') },
    { name: 'del', value: 'name?', options: { all: '' },
      about: 'delete a level pack kept in this browser, or with -all every one; asks first',
      run: async (p, io) => {
        const name = p.del;
        let list = await C.listPacks();
        if (name) list = list.filter(x => x.name === C.clean(name));
        else if (!('all' in p)) {
          const names = list.map(x => x.name);
          throw Object.assign(new Error(`Name a level pack, or -all for every one${names.length ? ` — here: ${names.join(', ')}` : ' (there are none here)'}.`), { code: 'usage' });
        }
        if (name && !list.length) throw Object.assign(new Error(`There is no level pack called ${name} in this browser.`), { code: 'missing' });
        if (!list.length) return { deleted: [] };
        const what = list.length === 1 ? `“${list[0].title}”` : `all ${list.length} level packs`;
        if (!await io.confirm(`Delete ${what} from this browser? ${list.length === 1 ? 'The game in it goes' : 'The games in them go'} too.`)) return { deleted: [], cancelled: true };
        return { deleted: await C.deletePacks(list.map(x => x.name)) };
      },
      text: r => r.cancelled ? 'Nothing deleted.' : r.deleted.length ? `Deleted ${r.deleted.join(', ')}.` : 'There are no level packs in this browser.' },
    { name: 'list', about: 'the level packs kept in this browser',
      run: () => C.listPacks(),
      text: rows => !rows.length ? 'There are no level packs in this browser.'
        : (C.sharingOn() ? '' : 'Sharing is off in this browser: nobody can fetch these.\n\n')
          + table(rows, [['NAME', r => r.name], ['TITLE', r => r.title], ['STATE', r => r.public ? 'public' : 'private'], ['FILES', r => r.files, true],
          ['SIZE', r => r.size == null ? '' : fmt(r.size), true], ['VERSION', r => r.v || ''], ['CARD', r => r.id ? `${r.id} #${r.seq}` : ''], ['UPDATED', r => day(r.updated)]]) },
    { name: 'store', about: 'what this browser keeps for this address: its packs, their files, and the bytes kept — each file once, however many packs hold it',
      run: async () => {
        const s = await packStore.stats();
        let est = null;
        try { est = navigator.storage && await navigator.storage.estimate(); } catch { /* not told */ }
        return { ...s, usage: est ? est.usage : null, quota: est ? est.quota : null };
      },
      text: r => [
        `packs    ${Object.entries(r.packs).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`,
        `files    ${r.files}, ${fmt(r.bytes)} in all`,
        `kept     ${r.blobs} distinct, ${fmt(r.kept)}${r.unmoved ? ` — ${r.unmoved} old files still being moved` : ''}`,
        `saved    ${fmt(r.saved)}${r.bytes ? ` (${Math.round(100 * r.saved / r.bytes)}%)` : ''}`,
        r.usage != null ? `browser  ${fmt(r.usage)} used here, of ${fmt(r.quota)} allowed` : null
      ].filter(Boolean).join('\n') },
    { name: 'sharing', value: 'on|off?', options: { watch: '' },
      about: "how this browser's sharing stands, or switch it on or off for the whole browser. While it is on and any page of the game or its tools is open here, friends can fetch its public packs. -watch goes on telling what friends fetch",
      run: async (p, io) => {
        const say = p.sharing;
        if (say && say !== 'on' && say !== 'off') throw Object.assign(new Error('Sharing is on or off.'), { code: 'usage' });
        if (say) C.setSharing(say === 'on');
        const now = await C.sharingStatus(say === 'on' ? 6000 : 2500);
        if (!('watch' in p)) return now;
        io.event({ event: 'status', ...now });
        C.watchSharing(m => io.event(m.t === 'friend' ? { event: 'friend', ...m } : { event: m.t, ...m }));
        io.stay();
        return new Promise(() => {});
      },
      text: statusText,
      eventText: e => e.event === 'status' ? statusText(e)
        : e.event === 'friend' ? (e.state || e.progress == null ? `friend ${e.friend}${e.title ? ` — ${e.title}` : ''}: ${e.text}` : null)
        : e.event === 'state' ? `${e.state}${e.page ? ` — ${e.page}` : ''}${e.trouble ? ` — ${e.trouble}` : ''}` : null },
    { name: 'public', value: 'name?', options: { all: '' }, about: 'make a level pack public, as every pack is unless made private — or, with -all, every one',
      run: async p => {
        if ('all' in p && !p.public) { C.setAllPublic(); return { public: 'all', sharing: C.sharingOn() }; }
        const src = await packNamed(needs(p.public, 'a level pack name, or -all'));
        C.setPublic(src.name, true);
        return { public: src.name, title: src.title, sharing: C.sharingOn() };
      },
      text: r => (r.public === 'all' ? 'Every level pack here is public.' : `${r.title} is public.`) + offNote(r) },
    { name: 'private', value: 'name?', options: { all: '' }, about: 'make a level pack private: friends asking for it get nothing, as if it were not here — or, with -all, every one here now',
      run: async p => {
        if ('all' in p && !p.private) {
          const names = [...new Set((await C.sources()).map(x => x.name))];
          for (const n of names) C.setPublic(n, false);
          return { private: names };
        }
        const src = await packNamed(needs(p.private, 'a level pack name, or -all'));
        C.setPublic(src.name, false);
        return { private: [src.name], title: src.title };
      },
      text: r => r.title ? `${r.title} is private.` : r.private.length ? `Private now: ${r.private.join(', ')}.` : 'There are no level packs here.' },
    { name: 'info', value: 'name', about: "a level pack's version and every file in it — one kept here, or on disk",
      run: p => C.packInfo(needs(p.info, 'a level pack name')),
      text: r => `${r.title} (${r.name}) — ${r.public ? 'public' : 'private'}, ${r.where === 'disk' ? 'on disk' : 'in this browser'}, ${r.url}\n`
        + `version ${r.v}, ${r.files.length} files, ${fmt(r.size)}\n\n`
        + table(r.files, [['PATH', f => f.path], ['SIZE', f => fmt(f.size), true], ['HASH', f => f.hash]]) },
    { name: 'id', about: "this browser's share id — the from= of the links it makes",
      run: () => ({ id: C.shareId() }),
      text: r => r.id },
    { name: 'link', value: 'name', about: 'the link a level pack here is shared by — sharing nothing yet',
      run: async p => {
        const info = await C.packInfo(needs(p.link, 'a level pack name'));
        return { name: info.name, title: info.title, v: info.v, link: C.linkFor(info.name, info.v), play: C.linkFor(info.name, info.v, true) };
      },
      text: r => `${r.title} (version ${r.v})\n${r.link}\nto fetch it and start playing at once:\n${r.play}` },
    { name: 'download', value: 'name', about: 'a level pack — kept here or on disk — saved to this computer as a .zip',
      run: async (p, io) => {
        const z = await C.zipPack(needs(p.download, 'a level pack name'));
        await io.save(z.blob, z.filename);
        return { name: z.name, title: z.title, files: z.files, size: z.blob.size, saved: z.filename };
      },
      text: r => `Saved ${r.title} as ${r.saved} — ${r.files} files, ${fmt(r.size)}.` },
    { name: 'upload', value: 'name?', about: "a level pack's .zip from this computer, kept in this browser — under its own name, or the one given; asks before replacing one",
      run: async (p, io) => {
        const file = await io.pick('.zip,application/zip', 'Choose a level pack .zip');
        if (!file) return { cancelled: true };
        const z = await C.readPackZip(file, p.upload);
        const replaced = (await C.listPacks()).some(x => x.name === z.name);
        if (replaced && !await io.confirm(`Replace “${z.name}” in this browser with ${file.name}?`)) return { cancelled: true };
        await packStore.put('levels', z.name, z.files, z.title);
        const m = await packStore.manifest('levels', z.name);
        // its card, if the zip has a good one of these files
        const card = z.card ? await K.arrived(z.name, z.card, null, m.v).catch(() => null) : null;
        return { name: z.name, title: z.title, files: z.files.length, size: m.files.reduce((n, f) => n + f.size, 0), v: m.v, id: card ? card.id : null, seq: card ? card.seq : null,
          replaced, from: file.name, url: packStore.url('levels', z.name) };
      },
      text: r => r.cancelled ? 'Nothing kept.' : `${r.replaced ? 'Replaced' : 'Kept'} ${r.title} (${r.name}) in this browser from ${r.from} — ${r.files} files, ${fmt(r.size)}, version ${r.v}.`
        + (r.id ? `\nIts card: ${r.id}, version ${r.seq}.` : '') },
    { name: 'author', value: 'name?', options: { export: '', import: '' },
      about: "this browser as an author: its id, which every pack made here is named under. With a value, the name it signs with; -export saves its key to a file — keep it: without it, nobody can sign new versions of those packs — and -import takes one back; asks first",
      run: async (p, io) => {
        if ('import' in p) {
          const file = await io.pick('.json,application/json', 'Choose an author key file');
          if (!file) return { cancelled: true };
          let obj;
          try { obj = JSON.parse(await file.text()); } catch { throw Object.assign(new Error(`${file.name} is no author key file.`), { code: 'notauthor' }); }
          const now = await K.whoAmI();
          if (obj.id !== now.id && !await io.confirm(`Sign as ${obj.name || obj.id} from now on, instead of ${now.name || now.id}? Export this one first if you'll want it again.`)) return { cancelled: true };
          return { ...await K.importAuthor(obj), imported: file.name };
        }
        const me = p.author ? await K.setName(p.author) : await K.whoAmI();
        if ('export' in p) {
          const key = await K.exportAuthor();
          const filename = `wtw-author-${key.id}.json`;
          await io.save(new Blob([JSON.stringify(key, null, 1)], { type: 'application/json' }), filename);
          return { ...me, saved: filename };
        }
        return me;
      },
      text: r => r.cancelled ? 'Nothing changed.' : `author ${r.id}${r.name ? ` — ${r.name}` : ''}`
        + (r.saved ? `\nSaved its key as ${r.saved}. Keep it safe: whoever has it can sign as you.` : '')
        + (r.imported ? `\nSigning with the key from ${r.imported} now.` : '') },
    { name: 'card', value: 'name', options: { web: 'url', noweb: '' },
      about: "a level pack's signed card: who made it, its version, every file, and where it is to be found — made (and signed) here for a pack of yours. -web <url> adds a folder it is put up in (download it, unzip it there: card.json goes with it); -noweb takes them all off",
      run: async p => {
        const name = needs(p.card, 'a level pack name');
        const now = K.stored(name);
        let web;
        if ('noweb' in p) web = [];
        else if (p.web) web = [...new Set([...(now ? now.card.web : []), p.web.endsWith('/') ? p.web : p.web + '/'])];
        const card = await K.cardFor(name, { web });
        const me = await K.whoAmI();
        return { ...card, mine: card.id.startsWith(me.id + '/'), peers: (K.stored(name) || { peers: [] }).peers };
      },
      text: r => [
        `${r.title} — ${r.id}, version ${r.seq} (${r.v}), ${r.files.length} files`,
        `author   ${r.author.name || r.id.split('/')[0]}${r.mine ? ' (you)' : ''}`,
        `origin   ${r.origin}`,
        `web      ${r.web.length ? r.web.join(' ') : '—'}`,
        `came via ${r.peers.length ? r.peers.join(' ') : '—'}`,
        `made     ${day(r.made)}`
      ].join('\n') },
    { name: 'latest', value: 'name', options: { get: '' },
      about: "whether there is a newer version of a level pack kept here: asks its author's browser, the browsers it came from, and its web folders — each answer checked against the author's key. -get fetches it: only the files not here",
      run: async (p, io) => {
        const r = await K.latest(needs(p.latest, 'a level pack name'));
        if (!r.newest || !('get' in p)) return { ...r, newest: r.newest && { seq: r.newest.card.seq, v: r.newest.card.v, from: r.newest.from.peer || r.newest.from.web } };
        io.progress({ text: `Fetching version ${r.newest.card.seq} from ${r.newest.from.peer || r.newest.from.web}…` });
        const got = await K.update(r.name, r.newest, io.progress);
        return { ...r, newest: { seq: r.newest.card.seq, v: r.newest.card.v, from: r.newest.from.peer || r.newest.from.web }, got };
      },
      text: r => (r.got ? `${r.title} is at version ${r.newest.seq} now (was ${r.seq}): ${r.got.fetched} files fetched, ${fmt(r.got.bytes)}.`
          : r.newest ? `${r.title}: version ${r.newest.seq} is out (here: ${r.seq}), at ${r.newest.from}. share latest ${r.name} -get fetches it.`
          : `${r.title}: version ${r.seq} here is the newest found.`)
        + (r.tried.length ? '\n\n' + table(r.tried, [['ASKED', t => t.from], ['ANSWER', t => t.answer]]) : '\n(nowhere to ask: no author browser, none it came from, no web folder)') },
    // a friend's link (?from=<id>&get=<name>&v=<version>) is this command
    { name: 'get', value: 'name', options: { from: 'id!', v: 'version', diff: '', check: '', play: '' },
      about: "fetch a level pack from another browser — a friend's link; only the files not here, and nothing at all if this one has its version. -diff only lists them; -check asks even so; -play (on the page) goes straight on into the game",
      run: async (p, io) => {
        const r = await C.fetchPack({ from: needs(p.from, '-from <id>'), name: needs(p.get, 'a level pack name'), v: p.v, diff: 'diff' in p, check: 'check' in p }, io.progress);
        return 'play' in p && r.status !== 'diff' ? { ...r, start: new URL(await C.startUrl(r.key), location.origin).href } : r;
      },
      text: r => ({
        own: () => `That is this browser's own link — ${r.title} is here.`,
        have: () => `${r.title} is here already at version ${r.v} — nothing asked of the other browser. (-check asks even so.)`,
        same: () => `${r.title}: the copy here is the other browser's version, ${r.v} — nothing to fetch.`,
        diff: () => `${r.title}, version ${r.v}${r.update ? ' — an update to the copy here' : ''}: it would fetch ${r.fetch.length} of ${r.fetch.length + r.here.length} files, ${fmt(r.bytes)} of ${fmt(r.whole)}.`
          + (r.fetch.length ? '\n\n' + table(r.fetch, [['FETCH', f => f.path], ['SIZE', f => fmt(f.size), true]]) : '')
          + (r.here.length ? '\n\n' + table(r.here, [['HERE', f => f.path], ['IN', f => f.pack === r.name && f.as === f.path ? '' : f.pack]]) : ''),
        kept: () => `${r.title}, version ${r.v}, is in this browser now: ${r.fetched} files fetched (${fmt(r.bytes)}), ${r.fromHere} from packs here.\nplay it: ${new URL(r.play, location.origin).href}`
      }[r.status] || (() => plain(r)))() + (r.start ? `\nstart it: ${r.start}` : '') },
    { name: 'pack', value: 'name',
      about: "a level pack here, to send to a friend: its link, and how sharing stands. If it is private, asks whether to make it public; it doesn't switch sharing on",
      run: async (p, io) => {
        const src = await packNamed(needs(p.pack, 'a level pack name'));
        if (!C.isPublic(src.name)) {
          if (!await io.confirm(`Make “${src.title}” public? Anyone with your share link can fetch it while a page of the game is open in this browser.`)) return { name: src.name, title: src.title, public: false };
          C.setPublic(src.name, true);
        }
        const v = await src.version();
        return { name: src.name, title: src.title, public: true, v, link: C.linkFor(src.name, v), play: C.linkFor(src.name, v, true), sharing: await C.sharingStatus() };
      },
      text: r => !r.public ? `${r.title} stays private.` : `${r.title} (version ${r.v})\n${r.link}\nto fetch it and start playing at once:\n${r.play}\n${statusText(r.sharing)}` }
  ];

  // ---------- text ----------
  // Rows as columns: cols are [heading, value of a row, right-aligned?].
  function table(rows, cols) {
    const cells = rows.map(r => cols.map(([, get]) => String(get(r) ?? '')));
    const widths = cols.map(([head], i) => Math.max(head.length, ...cells.map(c => c[i].length)));
    const line = vals => vals.map((v, i) => cols[i][2] ? v.padStart(widths[i]) : v.padEnd(widths[i])).join('  ').trimEnd();
    return [line(cols.map(([head]) => head)), ...cells.map(line)].join('\n');
  }

  // Any data, laid out for reading: a list of records as a table (their
  // plain values as columns), a record as aligned `key  value` lines, what is
  // inside one indented under its key.
  function plain(data, indent = '') {
    const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
    const flat = x => x === null || typeof x !== 'object';
    if (Array.isArray(data)) {
      if (!data.length) return indent + '(none)';
      if (data.every(isObj)) {
        const keys = [...new Set(data.flatMap(Object.keys))].filter(k => data.every(r => flat(r[k])));
        return table(data, keys.map(k => [k.toUpperCase(), r => r[k], data.every(r => typeof r[k] === 'number')]))
          .split('\n').map(l => indent + l).join('\n');
      }
      return data.map(x => flat(x) ? indent + x : plain(x, indent)).join('\n');
    }
    if (isObj(data)) {
      const w = Math.max(0, ...Object.keys(data).map(k => k.length));
      return Object.entries(data).map(([k, v]) => flat(v) ? `${indent}${k.padEnd(w)}  ${v}` : `${indent}${k}:\n${plain(v, indent + '  ')}`).join('\n');
    }
    return indent + String(data);
  }

  // What a command's output is as text: its result, an event, or progress —
  // null for nothing worth a line.
  function text(c, kind, data) {
    if (kind === 'result') return c && c.text ? c.text(data) : plain(data);
    if (kind === 'event') return c && c.eventText ? c.eventText(data) : plain(data);
    if (kind === 'progress') return data.note || data.text || null;
    if (kind === 'error') return data.message;
    if (kind === 'confirm' || kind === 'pick') return data.text;
    if (kind === 'save') return `saving ${data.filename}`;
    return null;
  }

  // A command as help shows it: its command line and its address.
  function describe(c) {
    const value = c.value ? (c.value.endsWith('?') ? ` [<${c.value.slice(0, -1)}>]` : ` <${c.value}>`) : '';
    const urlValue = c.value ? (c.value.endsWith('?') ? `[=<${c.value.slice(0, -1)}>]` : `=<${c.value}>`) : '';
    const opts = Object.entries(c.options || {});
    return {
      command: `share ${c.name}${value}` + opts.map(([k, v]) => v.endsWith('!') ? ` -${k} <${v.slice(0, -1)}>` : ` [-${k}${v ? ` <${v}>` : ''}]`).join(''),
      url: `share/?${c.name}${urlValue}` + opts.map(([k, v]) => v.endsWith('!') ? `&${k}=<${v.slice(0, -1)}>` : `[&${k}${v ? `=<${v}>` : ''}]`).join(''),
      about: c.about
    };
  }

  // The address's parameters as { name: value }, a bare one as ''.
  const params = search => Object.fromEntries(new URLSearchParams(search));

  // The command an address names: the first in the table it has.
  const find = p => COMMANDS.find(c => c.name in p) || null;

  // Runs the command an address names; none named, help.
  async function run(p, io) {
    const c = find(p) || COMMANDS[0];
    return c.run(p, io);
  }

  // A command line — `share del garden`, `share get x -from wtw-… -diff` — as
  // the address's query: the first word is the command and a word after it
  // its value; each -option after that a parameter too, a word after it its
  // value. Quotes keep a value with spaces in one word.
  function toQuery(line) {
    const words = (line.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(w => /^(["']).*\1$/.test(w) ? w.slice(1, -1) : w);
    if (words[0] === 'share') words.shift();
    const q = new URLSearchParams();
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (i === 0 ? w.startsWith('-') : !w.startsWith('-'))
        throw Object.assign(new Error(i === 0 ? `The command comes first, without a dash: share ${w.replace(/^-+/, '')}` : `“${w}” — an option needs a dash in front: -${w}`), { code: 'usage' });
      const value = words[i + 1] !== undefined && !words[i + 1].startsWith('-') ? words[++i] : '';
      q.append(w.replace(/^-+/, ''), value);
    }
    return q.toString().replace(/=(&|$)/g, '$1');     // bare ones without =
  }

  return { COMMANDS, describe, params, find, run, toQuery, text, plain, table };
})();
