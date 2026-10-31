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
  const C = ShareCore;
  const needs = (value, what) => { if (!value) throw Object.assign(new Error(`It needs ${what}.`), { code: 'usage' }); return value; };

  const fmt = C.fmt;
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
        : table(rows, [['NAME', r => r.name], ['TITLE', r => r.title], ['SHARED', r => r.shared ? 'yes' : ''], ['FILES', r => r.files, true],
          ['SIZE', r => r.size == null ? '' : fmt(r.size), true], ['VERSION', r => r.v || ''], ['UPDATED', r => day(r.updated)]]) },
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
    { name: 'open', value: 'name', about: 'share a level pack: friends with your share link may fetch it whenever a share page is open here; asks first',
      run: async (p, io) => {
        const src = await C.sourceNamed(needs(p.open, 'a level pack name'));
        if (!src) throw Object.assign(new Error(`There is no level pack called ${p.open} here.`), { code: 'missing' });
        const info = await C.packInfo(src.key);
        const result = { name: src.name, title: src.title, shared: true, link: C.linkFor(src.name, info.v) };
        if (C.isShared(src.name)) return { ...result, already: true };
        if (!await io.confirm(`Share “${src.title}”? Anyone with your share link can fetch it while a share page is open in this browser.`)) return { name: src.name, title: src.title, shared: false, cancelled: true };
        C.setShared(src.name, true);
        return result;
      },
      text: r => r.cancelled ? `${r.title} is not shared.` : `${r.title} is ${r.already ? 'shared already' : 'shared now'}. Its link:\n${r.link}` },
    { name: 'close', value: 'name?', options: { all: '' }, about: 'stop sharing a level pack — or, with -all, every one; friends asking for it get nothing',
      run: p => {
        const names = 'all' in p && !p.close ? [...C.sharedNames()] : [C.clean(needs(p.close, 'a level pack name, or -all'))];
        for (const n of names) C.setShared(n, false);
        return { closed: names };
      },
      text: r => r.closed.length ? `Not shared any more: ${r.closed.join(', ')}.` : 'No pack was shared.' },
    { name: 'info', value: 'name', about: "a level pack's version and every file in it — one kept here, or on disk",
      run: p => C.packInfo(needs(p.info, 'a level pack name')),
      text: r => `${r.title} (${r.name}) — ${r.where === 'disk' ? 'on disk' : 'in this browser'}, ${r.url}\n`
        + `version ${r.v}, ${r.files.length} files, ${fmt(r.size)}\n\n`
        + table(r.files, [['PATH', f => f.path], ['SIZE', f => fmt(f.size), true], ['HASH', f => f.hash]]) },
    { name: 'id', about: "this browser's share id — the from= of the links it makes",
      run: () => ({ id: C.shareId() }),
      text: r => r.id },
    { name: 'link', value: 'name', about: 'the link a level pack here is shared by — sharing nothing yet',
      run: async p => {
        const info = await C.packInfo(needs(p.link, 'a level pack name'));
        return { name: info.name, title: info.title, v: info.v, link: C.linkFor(info.name, info.v) };
      },
      text: r => `${r.title} (version ${r.v})\n${r.link}` },
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
        return { name: z.name, title: z.title, files: z.files.length, size: m.files.reduce((n, f) => n + f.size, 0), v: m.v, replaced, from: file.name, url: packStore.url('levels', z.name) };
      },
      text: r => r.cancelled ? 'Nothing kept.' : `${r.replaced ? 'Replaced' : 'Kept'} ${r.title} (${r.name}) in this browser from ${r.from} — ${r.files} files, ${fmt(r.size)}, version ${r.v}.` },
    // a friend's link (?from=<id>&get=<name>&v=<version>) is this command
    { name: 'get', value: 'name', options: { from: 'id!', v: 'version', diff: '', check: '' },
      about: "fetch a level pack from another browser — a friend's link; only the files not here, and nothing at all if this one has its version. -diff only lists them; -check asks even so",
      run: (p, io) => C.fetchPack({ from: needs(p.from, '-from <id>'), name: needs(p.get, 'a level pack name'), v: p.v, diff: 'diff' in p, check: 'check' in p }, io.progress),
      text: r => ({
        own: () => `That is this browser's own link — ${r.title} is here.`,
        have: () => `${r.title} is here already at version ${r.v} — nothing asked of the other browser. (-check asks even so.)`,
        same: () => `${r.title}: the copy here is the other browser's version, ${r.v} — nothing to fetch.`,
        diff: () => `${r.title}, version ${r.v}${r.update ? ' — an update to the copy here' : ''}: it would fetch ${r.fetch.length} of ${r.fetch.length + r.here.length} files, ${fmt(r.bytes)} of ${fmt(r.whole)}.`
          + (r.fetch.length ? '\n\n' + table(r.fetch, [['FETCH', f => f.path], ['SIZE', f => fmt(f.size), true]]) : '')
          + (r.here.length ? '\n\n' + table(r.here, [['HERE', f => f.path], ['IN', f => f.pack === r.name && f.as === f.path ? '' : f.pack]]) : ''),
        kept: () => `${r.title}, version ${r.v}, is in this browser now: ${r.fetched} files fetched (${fmt(r.bytes)}), ${r.fromHere} from packs here.\nplay it: ${new URL(r.play, location.origin).href}`
      }[r.status] || (() => plain(r)))() },
    { name: 'pack', value: 'name', options: { go: '' },
      about: 'share a level pack (idb:<name> for one kept here when one on disk has the same name): goes on, serving each friend, until stopped; asks first if it isn\'t shared yet. On the page, -go starts at once — for a pack shared already',
      run: async (p, io) => {
        const src = await C.sourceNamed(needs(p.pack, 'a level pack name'));
        if (!src) throw Object.assign(new Error(`There is no level pack called ${p.pack} here.`), { code: 'missing' });
        if (!C.isShared(src.name)) {
          if (!await io.confirm(`Share “${src.title}”? Anyone with your share link can fetch it while a share page is open in this browser.`)) return { name: src.name, cancelled: true };
          C.setShared(src.name, true);
        }
        return new Promise((resolve, reject) => C.share(src.key, {
          ready: d => { io.event({ event: 'ready', ...d }); io.stay(); },
          friend: (n, r) => io.event({ event: 'friend', friend: n, ...r }),
          trouble: (text, final) => final ? reject(new Error(text)) : io.event({ event: 'trouble', text })
        }).catch(reject));
      },
      text: r => r.cancelled ? 'Not shared.' : plain(r),
      // a friend's file-by-file progress only on the page; here, how each ends
      eventText: e => e.event === 'ready' ? `Sharing ${e.title} — ${e.files} files, ${fmt(e.size)}, version ${e.v}. The link:\n${e.link}`
        : e.event === 'friend' ? (e.state || e.progress == null ? `friend ${e.friend}${e.title ? ` — ${e.title}` : ''}: ${e.text}` : null)
        : e.text }
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
