// ---------- writing the pack out ----------
// One zip laid out exactly as assetpacks/<name>/, so unzipping it beside the
// others is all it takes for the level editor to offer it.

function packProblems() {
  const bad = [];
  if (!slug(pack.name)) bad.push('The pack needs a name.');
  if (!pack.tiles.src) bad.push('No terrain sheet — load a tiles.png on the Tiles tab.');
  const drawn = pack.sprites.filter(o => o.frames.length);
  if (!drawn.length) bad.push('No sprite has any frames yet.');
  const dupeOf = list => { const names = list.map(o => o.name); return names.find((n, i) => names.indexOf(n) !== i); };
  if (dupeOf(pack.sprites)) bad.push(`Two sprites are both called "${dupeOf(pack.sprites)}".`);
  if (dupeOf(pack.objects)) bad.push(`Two objects are both called "${dupeOf(pack.objects)}".`);
  for (const o of pack.sprites) {
    if (o.frames.length && !bodyFrames(o).length) bad.push(`The sprite ${o.name} has glow frames but none of its own to glow over.`);
  }
  for (const o of pack.objects) bad.push(...objectProblems(o).map(p => `${o.name}: ${p}`));
  const worms = pack.objects.filter(o => o.cls === 'Worm');
  if (worms.length > 1) bad.push(`${worms.map(o => o.name).join(' and ')} are both Worm objects — the game takes one, so keep one.`);
  for (const id of Object.keys(pack.sounds.defs)) bad.push(...soundProblems(id).map(p => `The sound "${id}" ${p}`));
  return bad;
}

// What is wrong with one sound, in words, or nothing.
function soundProblems(id) {
  const d = pack.sounds.defs[id];
  if (!d) return [];
  if (d.src && !pack.sounds.media[d.src]) return [`names ${d.src}, which is not in the pack.`];
  if (!d.src && d.layers && !d.layers.length) return ['has no layers left, so it would make no noise.'];
  return [];
}

// What is wrong with one sprite, in words, or nothing.
function spriteProblems(s) {
  const bad = [];
  if (!s.frames.length) bad.push('it has no frames yet.');
  else if (!bodyFrames(s).length) bad.push('it has glow frames but none of its own to glow over.');
  if (pack.sprites.some(x => x !== s && x.name === s.name)) bad.push(`another sprite is also called "${s.name}".`);
  return bad;
}

// What the level editor reads to know what the pack offers.
function assetpackJson() {
  const sets = { dir: 'sounds/', default: 'default.json', items: [] };
  const doc = {
    _comment: 'An asset pack: everything the level editor draws with, in one folder. Made with the asset pack creator.',
    name: pack.name,
    // the rows as the Tiles tab set them, so the level editor and the game
    // collide each row the way it was chosen there
    tileset: {
      texture: 'tiles/tiles.png',
      size: pack.tiles.size,
      row_0: pack.tiles.row_0,
      row_1: pack.tiles.row_1,
      row_C: pack.tiles.row_C,
      row_D: pack.tiles.row_D,
      col_0: TILE_COLUMNS
    },
    objects: { manifest: 'objects/objects.json' },
    backgrounds: {
      dir: 'backgrounds/',
      items: pack.backgrounds.map(b => ({ file: b.file, name: b.name, color: b.color, scroll: num(b.scroll, 3) }))
    },
    sounds: sets
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

function soundsJson() {
  const doc = {
    _comment: 'Every noise the game can make, by id. A def is either a list of layers or a recorded file. A layer is an oscillator (wave, sweep, gain, attack, decay, delay) or a burst of noise (noise: gain, decay, and from/to for the lowpass that closes over it). A recorded file names src, with loop true for a track. `shake` is how long the phone buzzes with it.',
    sounds: pack.sounds.defs
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

// What is wrong with one object, in words: a class the game hasn't got, a
// code its class can't use, or a property naming something not in the pack.
function objectProblems(o) {
  const bad = [];
  const C = gameClass(o.cls);
  if (!C) return [`its class "${o.cls}" is not one the game has.`];
  const want = C.codes.map(c => c + variantOf(o));
  if (C.codes.length && (!variantOf(o) || o.code.join() !== want.join())) bad.push(`its codes should be ${want.join(' ')}.`);
  const sprite = spriteByName(refName(o.props.sprite));
  // a mark only the level editor shows draws without art if it has none
  if (!sprite && !((C.editorOnly || C.spriteOptional) && !o.props.sprite)) bad.push(`its sprite "${o.props.sprite || 'none'}" is not in the pack.`);
  for (const [k, d] of Object.entries(classDefs(o.cls))) {
    if (k === 'sprite') continue;
    const p = propProblem(o, k, d);
    if (p) bad.push(p);
  }
  for (const [code, names] of clashingCodes()) {
    if (names.includes(o.name)) bad.push(`${code} is also ${names.filter(n => n !== o.name).join(', ')}'s code.`);
  }
  return bad;
}

// What is wrong with one of an object's properties — the thing it names is
// not in the pack — or null.
function propProblem(o, k, d) {
  const v = o.props[k];
  if (!v) return null;
  if (d.type === 'sound' && !pack.sounds.defs[refName(v)]) return `${k} names ${v}, which is not one of the pack's sounds.`;
  if (d.type === 'sprite' && !spriteByName(refName(v))) return `${k} names ${v}, which is not one of the pack's sprites.`;
  if (d.type === 'object' && !pack.objects.some(x => x.name === refName(v) && (!d.class || x.cls === d.class)))
    return `${k} names ${v}, which is not one of the pack's ${d.class || ''} objects.`;
  const sprite = spriteByName(refName(o.props.sprite));
  if (d.type === 'part' && !d.optional && sprite && !sprite.parts.some(p => p.name === v)) return `${k} names the part "${v}", which ${sprite.name} hasn't got.`;
  return null;
}

// A small warning mark, its problems in its tooltip; nothing if there are none.
function warnBadge(problems, count) {
  if (!problems || !problems.length) return '';
  const tip = problems.map(p => '• ' + p).join('\n');
  return `<span class="wbadge" title="${esc(tip)}" aria-label="${esc(problems.length + ' problem' + (problems.length > 1 ? 's' : ''))}">${count ? problems.length : '!'}</span>`;
}

// The tabs carry a count of what is wrong on them.
function refreshTabWarnings() {
  if (!pack) return;
  const n = {
    gameobjects: pack.objects.reduce((t, o) => t + objectProblems(o).length, 0)
      + (pack.objects.filter(o => o.cls === 'Worm').length > 1 ? 1 : 0),
    objects: pack.sprites.reduce((t, s) => t + spriteProblems(s).length, 0),
    sounds: Object.keys(pack.sounds.defs).reduce((t, id) => t + soundProblems(id).length, 0),
    tiles: pack.tiles.src ? 0 : 1
  };
  $$('.tab').forEach(t => {
    const old = t.querySelector('.wbadge');
    if (old) old.remove();
    const c = n[t.dataset.tab];
    if (c) t.insertAdjacentHTML('beforeend', `<span class="wbadge" title="${c} problem${c > 1 ? 's' : ''} here — see the Pack tab">${c}</span>`);
  });
}

// Both manifests are written by hand rather than stringified, so an entry
// stays on one line: they are meant to be read, the sprites beside the sheet.
function manifestJson(head, key, map) {
  const names = Object.keys(map);
  return ['{', ...head, `  ${JSON.stringify(key)}: {`,
    ...names.map((n, i) => `    ${JSON.stringify(n)}: ${JSON.stringify(map[n])}${i < names.length - 1 ? ',' : ''}`),
    '  }', '}', ''].join('\n');
}

// Every path the zip will hold, in the order it is written. Media keys are
// relative to the sound manifest, which is what sits in sounds/.
function packFiles() {
  return [
    'assetpack.json',
    'tiles/tiles.png',
    'objects/objects.json',
    'objects/sprites.json',
    'objects/objects.png',
    ...pack.backgrounds.map(b => 'backgrounds/' + b.file),
    'sounds/default.json',
    ...Object.keys(pack.sounds.media).map(p => 'sounds/' + p)
  ];
}

// Every file of the finished pack, as the zip and the level editor both get it.
async function buildPackFiles() {
  const { sheet, manifest } = await packSprites();
  const objects = objectsManifest();
  const files = [
    { name: 'assetpack.json', data: assetpackJson() },
    { name: 'tiles/tiles.png', data: dataUrlBytes(pack.tiles.src) },
    { name: 'objects/objects.json', data: manifestJson(['  "sprites": "sprites.json",'], 'objects', objects.objects) },
    { name: 'objects/sprites.json', data: manifestJson(['  "texture": "objects.png",'], 'sprites', manifest.sprites) },
    { name: 'objects/objects.png', data: canvasBytes(sheet) },
    { name: 'sounds/default.json', data: soundsJson() }
  ];
  for (const b of pack.backgrounds) files.push({ name: 'backgrounds/' + b.file, data: dataUrlBytes(b.src) });
  for (const [path, m] of Object.entries(pack.sounds.media)) files.push({ name: 'sounds/' + path, data: m.bytes });
  return files;
}

// Where the .zip goes is asked first, in a Save dialog, straight from the
// click: a browser only opens one while the click is fresh, and a download
// started seconds later, once the pack is packed, counts as an automatic one
// that Chrome may block without a word after a few. A browser without the
// dialog (Firefox) downloads it instead. True once it is written.
async function exportPack() {
  const problems = packProblems();
  if (problems.length) { toast(problems[0], true); return false; }
  const name = (slug(pack.name) || 'pack') + '.zip';

  let handle = null;
  if (window.showSaveFilePicker) {
    try {
      handle = await showSaveFilePicker({
        suggestedName: name,
        id: 'assetpack-export',           // it opens where the last export went
        types: [{ description: 'Asset pack', accept: { 'application/zip': ['.zip'] } }]
      });
    } catch (err) {
      if (err.name === 'AbortError') return false;     // the dialog was cancelled
      handle = null;                                    // not allowed here: download it
    }
  }

  toast('Packing…');
  const files = await buildPackFiles();
  const blob = zipBlob(files);
  if (handle) {
    const out = await handle.createWritable();
    await out.write(blob);
    await out.close();
    toast(`Saved ${handle.name} — ${files.length} files; unzip into assetpacks/, or Import it in another browser`);
  } else {
    download(blob, name);
    toast(`Downloaded ${name} — ${files.length} files. Nothing in Downloads? The browser may be blocking this page's downloads (the icon at the end of the address bar).`);
  }
  return true;
}

// The pack as it stands, in the level editor, without a download: its files
// are saved in this browser's pack store (src/js/packstore.js), which the
// service worker serves under /__idb/assets/<name>/ like any pack folder.
// Nothing is written to assetpacks/, so a pack of the same name there is left
// alone; the stored one stays until it is saved over, and Import offers it.
// One tab is kept for the editor, and each click reloads it.
async function openInLevelEditor() {
  const problems = packProblems();
  if (problems.length) { toast(problems[0], true); return; }
  // opened before anything is awaited, or the browser takes it for a popup
  const tab = window.open('', 'wtw-level-editor');
  toast('Packing…');
  try {
    if (!await Promise.race([packStore.ready(), new Promise(ok => setTimeout(() => ok(false), 4000))])) {
      throw new Error('the pack store needs the page served from localhost or https, where its service worker can run');
    }
    const files = await buildPackFiles();
    // a level pack's own art is kept as that pack's (lp-<its uid>), and the
    // editor opens on that level pack (?for=)
    const base = await packStore.put('assets', pack.owner ? 'lp-' + pack.owner : slug(pack.name), files, pack.name);
    const url = `/editor/index.html?assets=${encodeURIComponent(base)}${pack.owner ? '&for=' + encodeURIComponent(pack.owner) : '&new'}`;
    if (tab) { tab.location.href = url; tab.focus(); } else window.open(url, 'wtw-level-editor');
    toast(pack.owner ? `Back in the level editor, with ${pack.name}'s new art` : `Saved in this browser as ${base} and opened in the level editor`);
  } catch (err) {
    if (tab) tab.close();
    toast('Could not open it in the level editor: ' + err.message, true);
  }
}

function renderPackTab() {
  const drawn = pack.sprites.filter(o => o.frames.length).length;
  const classes = new Set(pack.objects.map(o => o.cls)).size;
  const kinds = Object.values(pack.sounds.defs);
  const problems = packProblems();

  $('#packSummary').innerHTML = `
    <div class="insp">
      <div class="ctl"><span>Sprites</span><output>${drawn} drawn</output></div>
      <div class="ctl"><span>Objects</span><output>${pack.objects.length} of ${classes} classes</output></div>
      <div class="ctl"><span>Terrain sheet</span><output>${pack.tiles.src ? 'loaded' : 'missing'}</output></div>
      <div class="ctl"><span>Backgrounds</span><output>${pack.backgrounds.length}</output></div>
      <div class="ctl"><span>Sounds</span><output>${kinds.filter(d => defKind(d) === 'synth').length} synth · ${kinds.filter(d => defKind(d) === 'clip').length} clips · ${kinds.filter(d => defKind(d) === 'track').length} tracks</output></div>
    </div>
    ${problems.length
      ? `<p class="hint" style="color:var(--pink)">Not ready yet:</p><ul class="hint">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`
      : '<p class="hint" style="color:var(--mint)">Ready to download.</p>'}`;

  $('#packTree').textContent = [`${slug(pack.name) || 'pack'}/`, ...packFiles().map(f => '  ' + f)].join('\n');
}
