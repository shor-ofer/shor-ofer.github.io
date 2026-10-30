// ---------- objects ----------
// One object per sprite the game spawns. Its frames are a single strip and a
// part is a named run of that strip, which is what `object:part` picks.

const fcan = new Map();           // frame id -> rendered canvas, rebuilt on demand
let current = null;               // the object being edited
let selFrames = new Set();

const decoding = new Set();      // frame ids whose data: URL is being read back

function frameCanvas(o, f) {
  let c = fcan.get(f.id);
  if (c && c.width === o.fw && c.height === o.fh) return c;
  c = blankCanvas(o.fw, o.fh);
  const img = f.img;
  if (img) c.getContext('2d').drawImage(img, 0, 0, o.fw, o.fh);
  else if (f.src) {
    // Not read back yet — after an undo or a resize the preview asks before
    // warmFrames gets here. It draws empty this once, but the blank is not
    // kept, or warmFrames would take it for the frame and skip it for good.
    if (!decoding.has(f.id)) {
      decoding.add(f.id);
      attachFrame(o, f).finally(() => decoding.delete(f.id));
    }
    return c;
  }
  fcan.set(f.id, c);
  return c;
}
function setFrameCanvas(o, f, canvas) { fcan.set(f.id, cloneCanvas(canvas)); f.img = null; }
function dropFrameCanvas(id) { fcan.delete(id); }

// Frames arrive as data: URLs — from a file, a slice of a strip, or the paint
// editor — so each one is decoded once and kept as a canvas.
async function attachFrame(o, f) {
  try {
    const img = await loadImg(f.src);
    f.img = img;
    fcan.delete(f.id);
    frameCanvas(o, f);
    f.img = null;
  } catch {
    // a frame that won't decode just draws empty, and is not tried again
    fcan.set(f.id, blankCanvas(o.fw, o.fh));
  }
}

function insertFrame(o, partId, afterId, canvas) {
  const f = { id: uid(), src: canvas.toDataURL(), partId };
  fcan.set(f.id, cloneCanvas(canvas));
  let at = afterId ? o.frames.findIndex(x => x.id === afterId) + 1 : 0;
  if (at <= 0) {
    const idx = o.frames.map((x, i) => x.partId === partId ? i : -1).filter(i => i >= 0);
    at = idx.length ? idx[idx.length - 1] + 1 : o.frames.length;
  }
  o.frames.splice(at, 0, f);
  return f;
}

// ---------- icons ----------
// A sprite at a glance, for lists and pickers: its first frame of its own (not
// its glow), fitted into a small square. Markup first, painted once in the page.
const ICON = 24;
const spriteIcon = name => `<canvas class="ico" width="${ICON}" height="${ICON}" data-ico="${esc(name)}" aria-hidden="true"></canvas>`;
// One part of a sprite, by its first frame.
// An object's icon: its sprite's, or — for a particle system wearing none —
// a still of the effect itself (ParticleSystem.snapshotOf), drawn by paintIcons.
const objectIcon = o => o.cls === 'ParticleSystem' && !spriteByName(refName(o.props.sprite))
  ? `<canvas class="ico" width="${ICON}" height="${ICON}" data-pico="${esc(o.id)}" aria-hidden="true"></canvas>`
  : spriteIcon(refName(o.props.sprite));
const partIcon = (name, part) => `<canvas class="ico" width="${ICON}" height="${ICON}" data-ico="${esc(name)}" data-part="${esc(part)}" aria-hidden="true"></canvas>`;

// The smallest box round a canvas's opaque pixels, or null if it has none.
function drawnBox(cv) {
  const { width: W, height: H } = cv;
  if (!W || !H) return null;
  const d = cv.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!d[(y * W + x) * 4 + 3]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

function paintIcons(root) {
  // a particle system's: its best moment, on a dark square so a glow shows
  root.querySelectorAll('canvas[data-pico]').forEach(cv => {
    const o = pack.objects.find(x => x.id === cv.dataset.pico);
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ICON, ICON);
    if (!o) return;
    g.fillStyle = '#0f0b1d';
    g.fillRect(0, 0, ICON, ICON);
    const shot = ParticleSystem.snapshotOf(o.props);
    const k = (ICON / 2 - 1) / shot.reach;
    g.translate(ICON / 2, ICON / 2);
    g.scale(k, k);
    shot.cloud.paint(g, null, 2 / k);          // at least 2 pixels, or a faint one is lost
    g.setTransform(1, 0, 0, 1, 0, 0);
  });
  root.querySelectorAll('canvas[data-ico]').forEach(cv => {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, ICON, ICON);
    const s = spriteByName(cv.dataset.ico);
    const part = s && cv.dataset.part !== undefined ? s.parts.find(p => p.name === cv.dataset.part) : null;
    const f = s && (cv.dataset.part !== undefined
      ? part && s.frames.find(x => x.partId === part.id)
      : bodyFrames(s)[0] || s.frames[0]);
    if (!f) return;
    // a part is often a small piece of a big frame, so its icon is cut to
    // what it draws; a sprite's shows the whole frame
    const src = frameCanvas(s, f);
    const box = part ? drawnBox(src) : null;
    const [sx, sy, sw, sh] = box || [0, 0, s.fw, s.fh];
    const k = Math.min(ICON / sw, ICON / sh);
    const w = sw * k, h = sh * k;
    g.imageSmoothingEnabled = k < 1;       // shrinking wants smoothing; growing stays crisp
    g.drawImage(src, sx, sy, sw, sh, (ICON - w) / 2, (ICON - h) / 2, w, h);
  });
}

// ---------- the object list ----------
function renderObjectList() {
  $('#objList').innerHTML = pack.sprites.map(o => `
    <button class="item ${current && o.id === current.id ? 'on' : ''}" data-oid="${o.id}">
      <b>${spriteIcon(o.name)}${esc(o.name)}${warnBadge(spriteProblems(o))}</b><small>${o.frames.length} fr${usersOf(o).length ? ' · ' + usersOf(o).length + ' obj' : ''}</small>
    </button>`).join('') || '<p class="empty">No sprites yet.</p>';
  paintIcons($('#objList'));
}

function renderObjects() {
  renderObjectList();
  renderObjectFrames();
  renderProps();
  renderShape();
}

$('#objList').addEventListener('click', e => {
  const b = e.target.closest('[data-oid]');
  if (!b) return;
  current = spriteById(b.dataset.oid);
  selFrames.clear();
  renderObjects();
  savePack();
});

// A new sprite's name, frame size and template, asked for once. Blank is one
// empty part, drawn a game pixel to an art pixel to begin with; a template
// (sprite-templates.js) brings the parts the game reads by name, a blank
// frame in each, and its own size — drawn two art pixels to a game unit, as
// the shipped sprites are. null if the dialog was let go.
async function askNewSprite(name) {
  const BLANK = 'Blank';
  const tpls = spriteTemplates();
  const tplNote = t => t ? `${t.label}: ${t.parts.map(p => p.frames > 1 ? `${p.name} ×${p.frames}` : p.name).join(', ')}. ${t.note || ''}`
    : 'One empty part. It is drawn a game pixel to a pixel at first — a tile is 32 — and Tiles wide changes that after.';
  const asking = ask('New sprite', [
    { key: 'tpl', label: 'Start from', type: 'select', options: [BLANK, ...tpls.map(t => t.label)], value: BLANK },
    { key: 'name', label: 'Name', value: name },
    { key: 'w', label: 'Width of a frame (pixels)', type: 'number', value: 32 },
    { key: 'h', label: 'Height of a frame (pixels)', type: 'number', value: 32 },
    { type: 'note', label: tplNote(null) }
  ], 'Make it');
  // picking a template fills in its name and size, and says what it brings
  const field = k => $(`#askBody [data-k="${k}"]`);
  let named = false;
  field('name').addEventListener('input', () => { named = true; });
  field('tpl').addEventListener('change', e => {
    const t = tpls.find(x => x.label === e.target.value);
    field('w').value = t ? t.fw : 32;
    field('h').value = t ? t.fh : 32;
    if (!named) field('name').value = t ? freeSpriteName(t.name) : name;
    $('#askBody .hint').textContent = tplNote(t);
  });
  const got = await asking;
  if (!got) return null;
  const tpl = tpls.find(x => x.label === got.tpl) || null;
  const w = parseInt(got.w, 10), h = parseInt(got.h, 10);
  if (!(w >= 1 && w <= 512 && h >= 1 && h <= 512)) { toast('Pick a size from 1 to 512 pixels', true); return null; }
  const base = String(got.name).trim().replace(/[^A-Za-z0-9_-]+/g, '') || name;
  const s = newSprite(freeSpriteName(base));
  s.fw = w;
  s.fh = h;
  s.tiles = num(w / (tpl ? TEMPLATE_ART_SCALE : 1) / TILE, 6);
  if (tpl) {
    s.pivot = [...tpl.pivot];
    s.parts = tpl.parts.map((p, i) => ({ id: uid(), name: p.name, color: PART_COLORS[i % PART_COLORS.length] }));
    s.active = s.parts[0].id;
    const blank = blankCanvas(w, h), src = blank.toDataURL();
    s.parts.forEach((part, i) => {
      for (let k = 0; k < (tpl.parts[i].frames || 1); k++) {
        const f = { id: uid(), src, partId: part.id };
        fcan.set(f.id, cloneCanvas(blank));
        s.frames.push(f);
      }
    });
  }
  return s;
}

// The name, or the name with the first number after it no sprite has.
function freeSpriteName(base) {
  let nm = base, n = 2;
  while (spriteByName(nm)) nm = base + n++;
  return nm;
}

$('#objAdd').onclick = async () => {
  let n = 1;
  while (spriteByName('sprite' + n)) n++;
  const o = await askNewSprite('sprite' + n);
  if (!o) return;
  markUndo();
  pack.sprites.push(o);
  current = o;
  renderObjects();
  savePack();
};

// ---------- frames ----------
const THUMB_CELL = 50;            // a .frame's 60px less its border and the cell's inset, in app.css
function laneHTML(o, p) {
  const L = framesOfPart(o, p.id);
  return `<section class="lane" data-lane="${p.id}" style="--pc:${p.color}">
    <div class="lane-h"><span class="dot"></span><span class="t">${esc(p.name)}</span>
      <span class="c">${L.length} frames${p.glow ? ' · the glow' : ''}</span><span class="sp"></span></div>
    <div class="strip">
      ${L.map((f, i) => `<button class="frame ${selFrames.has(f.id) ? 'sel' : ''}" draggable="true" data-fid="${f.id}" aria-label="Frame ${i + 1}"><div class="cell"></div><span class="idx">${i + 1}</span></button>`).join('')}
      <button class="add" data-paint="${p.id}"><div><span>✎</span>Draw</div></button>
    </div></section>`;
}

// The objects that wear a sprite.
const usersOf = s => pack.objects.filter(o => refName(o.props.sprite) === s.name);

// The worm is drawn by game.js itself rather than by an object, so the parts
// it reads are the one list kept here.
const WORM_PARTS = { body: 'her segments, head shade to tail shade', tail: 'the tip', headLeft: 'facing left', headRight: 'facing right' };

// The part names the game will look for on this sprite: every part property
// of every object that wears it, with what the property is for. Shown under
// the parts, so a name the game reads is not left to guesswork.
function renderPartNames(o) {
  const el = $('#partNames');
  const known = {};
  if (o && o.name === 'worm') Object.assign(known, WORM_PARTS);
  if (o) {
    for (const user of usersOf(o)) {
      for (const [k, d] of Object.entries(classDefs(user.cls))) {
        const v = user.props[k];
        if (d.type === 'part' && v) known[v] = `${user.name}'s ${d.label || k}`.toLowerCase();
      }
    }
  }
  const names = Object.keys(known);
  el.hidden = !names.length;
  if (!names.length) return;
  const have = new Set(o.parts.map(p => p.name));
  el.innerHTML = 'The game looks for: ' + names.map(n =>
    `<code>${esc(n)}</code> ${esc(known[n])}${have.has(n) ? '' : ' <em class="missing">— not here</em>'}`).join(' · ');
}

function renderObjectFrames() {
  const o = current;
  renderPartNames(o);
  $('#objParts').innerHTML = !o ? '' : o.parts.map(p => `
    <div class="part ${p.id === o.active ? 'active' : ''}" data-pid="${p.id}" style="--pc:${p.color}">
      <div class="row">
        <button class="swatch" data-act="color" title="Change colour" aria-label="Change colour"></button>
        <input class="pname" data-k="name" value="${esc(p.name)}" aria-label="Part name">
        <button class="glowtog ${p.glow ? 'on' : ''}" data-act="glow" title="${p.glow ? 'This is the glow — click to make it an ordinary part' : 'Use this part as the glow'}" aria-label="Glow part" aria-pressed="${!!p.glow}">✦</button>
        ${!framesOfPart(o, p.id).length && o.parts.length > 1
          ? '<button class="x" data-act="delpart" title="Delete this empty part" aria-label="Delete part">×</button>' : ''}
      </div>
      <div class="meta"><span class="mono">${framesOfPart(o, p.id).length} fr</span></div>
    </div>`).join('') + '<button class="btn sm" id="partAdd">+ Part</button>';

  $('#objLanes').innerHTML = !o ? '<p class="empty">Pick a sprite, or make one.</p>'
    : o.parts.map(p => laneHTML(o, p)).join('');

  if (o) {
    // fitted by the longer side, so a small sprite fills its cell as a big
    // one does; every cell is the same size, so one measure serves them all.
    // A page that is not showing measures nothing, so the CSS size stands in.
    const cell = $('#objLanes .frame .cell');
    const side = (cell && cell.clientWidth) || THUMB_CELL;
    const fit = Math.min(side / o.fw, side / o.fh);
    $$('#objLanes .frame').forEach(el => {
      const f = o.frames.find(x => x.id === el.dataset.fid);
      if (!f) return;
      const c = blankCanvas(o.fw, o.fh);
      c.getContext('2d').drawImage(frameCanvas(o, f), 0, 0);
      c.style.width = o.fw * fit + 'px';
      c.style.height = o.fh * fit + 'px';
      el.querySelector('.cell').appendChild(c);
    });
  }
  renderCalc();
}

function renderCalc() {
  const o = current;
  if (!o) { $('#objCalc').textContent = ''; return; }
  const scale = (o.tiles * TILE) / o.fw;
  $('#objCalc').textContent = `${o.frames.length} frames · ${o.fw}×${o.fh} · drawn at ${num(o.fw * scale)}×${num(o.fh * scale)}px`;
  // A part's frames play at the object's rate, so a still object shows only
  // the first of each — easy to miss when a part has just grown a second one.
  const warn = $('#fpsWarn');
  if (!warn) return;
  const runs = o.fps ? [] : o.parts.filter(p => !p.glow && framesOfPart(o, p.id).length > 1).map(p => `"${p.name}"`);
  warn.hidden = !runs.length;
  warn.textContent = runs.length
    ? `${runs.join(', ')} ${runs.length > 1 ? 'have' : 'has'} several frames, but a still object shows only the first — set a rate to play ${runs.length > 1 ? 'them' : 'it'}.`
    : '';
}

$('#objParts').addEventListener('click', e => {
  if (e.target.id === 'partAdd') {
    markUndo();
    const p = { id: uid(), name: 'part' + (current.parts.length + 1), color: nextPartColor(current) };
    current.parts.push(p);
    current.active = p.id;
    renderObjectFrames();
    savePack();
    return;
  }
  const card = e.target.closest('.part');
  if (!card || !current) return;
  const p = partById(current, card.dataset.pid);
  const act = e.target.dataset.act;
  if (act === 'delpart') {
    deletePart(current, p);
    return;
  }
  if (act === 'glow') {
    // one glow per object, and never the only part: it would have nothing to glow over
    if (!p.glow && current.parts.filter(x => !x.glow && x !== p).length === 0) {
      toast('Add a part for its own frames first — the glow is drawn over them', true);
      return;
    }
    markUndo();
    const was = !!p.glow;
    current.parts.forEach(x => { delete x.glow; });
    if (!was) p.glow = true;
    normalizeObject(current);
    renderObjectFrames();
    renderProps();
    savePack();
    return;
  }
  if (act === 'color') {
    markUndo();
    p.color = PART_COLORS[(PART_COLORS.indexOf(p.color) + 1) % PART_COLORS.length];
    renderObjectFrames();
    savePack();
    return;
  }
  // picking a part only moves the highlight: redrawing the cards would take
  // away the name field that was just clicked into
  if (current.active !== p.id) {
    current.active = p.id;
    $$('#objParts .part').forEach(el => el.classList.toggle('active', el.dataset.pid === p.id));
    savePack();
  }
});

// The Glows box: on adds an empty glow part to fill, off takes it away —
// asking first, the way deleting any part does, if it has frames.
async function setGlows(o, on) {
  const g = glowPart(o);
  if (on && !g) {
    markUndo();
    const part = { id: uid(), name: 'glow', color: '#ffffff', glow: true };
    o.parts.push(part);
    o.active = part.id;
    normalizeObject(o);
    renderObjectFrames();
    toast('Draw or drag frames into "glow"');
  } else if (!on && g) {
    // the same rule as any part: an empty glow goes, one with frames stays
    deletePart(o, g);
  }
  renderProps();
  savePack();
}

// A part with frames asks what becomes of them: they go with it, or into
// another part. Quietly handing them to the first part, as this once did,
// put frames into an animation nobody had asked for.
// Only an empty part can go, so deleting one never takes frames with it: to
// get rid of a part with frames, delete them or drag them to another part
// first, and its × appears. A sprite keeps at least one part.
function deletePart(o, p) {
  if (o.parts.length === 1) { toast('A sprite needs at least one part — rename this one instead', true); return false; }
  if (framesOfPart(o, p.id).length) { toast(`"${p.name}" still has frames — delete them or drag them to another part first`, true); return false; }
  markUndo();
  o.parts = o.parts.filter(x => x !== p);
  normalizeObject(o);
  renderObjectFrames();
  savePack();
  toast('Part deleted — Ctrl+Z brings it back');
  return true;
}

$('#objParts').addEventListener('input', e => {
  const card = e.target.closest('.part');
  if (!card || !current || e.target.dataset.k !== 'name') return;
  markUndo();
  const p = partById(current, card.dataset.pid);
  p.name = e.target.value.trim() || 'part';
  const title = $(`#objLanes [data-lane="${p.id}"] .lane-h .t`);
  if (title) title.textContent = p.name;
  renderPartNames(current);
  savePack();
});

// A part's name is its key in objects.json and what a level asks for as
// object:part, so two of the same would silently become one. Settled once the
// field is left, so a name can pass through a clash while it is being typed.
$('#objParts').addEventListener('change', e => {
  const card = e.target.closest('.part');
  if (!card || !current || e.target.dataset.k !== 'name') return;
  const p = partById(current, card.dataset.pid);
  const base = p.name;
  let n = 2;
  while (current.parts.some(x => x !== p && x.name === p.name)) p.name = `${base}${n++}`;
  if (p.name !== base) toast(`There is already a part called "${base}" — this one is "${p.name}"`, true);
  e.target.value = p.name;
  const title = $(`#objLanes [data-lane="${p.id}"] .lane-h .t`);
  if (title) title.textContent = p.name;
  savePack();
});

$('#objLanes').addEventListener('click', e => {
  const pb = e.target.closest('[data-paint]');
  if (pb) {
    markUndo();
    const f = insertFrame(current, pb.dataset.paint, null, blankCanvas(current.fw, current.fh));
    renderObjectFrames();
    openPaint(current, f);
    savePack();
    return;
  }
  const fr = e.target.closest('.frame');
  if (!fr) return;
  const id = fr.dataset.fid;
  // a click picks this frame alone; Ctrl (Cmd) adds to or takes from the picks,
  // for dragging or deleting several at once
  if (e.ctrlKey || e.metaKey) {
    selFrames.has(id) ? selFrames.delete(id) : selFrames.add(id);
  } else {
    selFrames.clear();
    selFrames.add(id);
  }
  $$('#objLanes .frame').forEach(el => el.classList.toggle('sel', selFrames.has(el.dataset.fid)));
  // and shows it in the preview, held there until Play
  const f = current.frames.find(x => x.id === id);
  const lane = framesOfPart(current, f.partId);
  if (current.active !== f.partId) {
    current.active = f.partId;
    $$('#objParts .part').forEach(el => el.classList.toggle('active', el.dataset.pid === f.partId));
  }
  pv.i = lane.indexOf(f);
  setPlaying(false);
});

$('#objLanes').addEventListener('dblclick', e => {
  const fr = e.target.closest('.frame');
  if (fr) openPaint(current, current.frames.find(f => f.id === fr.dataset.fid));
});

// dragging frames between parts is how a run is re-cut
let dragIds = null;
$('#objLanes').addEventListener('dragstart', e => {
  const fr = e.target.closest('.frame');
  if (!fr) return;
  const id = fr.dataset.fid;
  dragIds = selFrames.has(id) ? current.frames.filter(f => selFrames.has(f.id)).map(f => f.id) : [id];
  dragIds.forEach(i => document.querySelector(`.frame[data-fid="${i}"]`)?.classList.add('dragging'));
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
});
$('#objLanes').addEventListener('dragend', () => {
  dragIds = null;
  $$('.dragging,.drop-before,.lane.drop').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop'));
});
$('#objLanes').addEventListener('dragover', e => {
  const lane = e.target.closest('.lane');
  if (!lane) return;
  e.preventDefault();
  $$('.drop-before,.lane.drop').forEach(x => x.classList.remove('drop-before', 'drop'));
  lane.classList.add('drop');
  const fr = e.target.closest('.frame');
  if (fr && dragIds && !dragIds.includes(fr.dataset.fid)) fr.classList.add('drop-before');
});
$('#objLanes').addEventListener('drop', e => {
  const lane = e.target.closest('.lane');
  if (!lane || !dragIds) return;
  e.preventDefault();
  markUndo();
  const fr = e.target.closest('.frame');
  const before = fr && !dragIds.includes(fr.dataset.fid) ? fr.dataset.fid : null;
  const moving = current.frames.filter(f => dragIds.includes(f.id));
  current.frames = current.frames.filter(f => !dragIds.includes(f.id));
  moving.forEach(f => { f.partId = lane.dataset.lane; });
  let at = before ? current.frames.findIndex(f => f.id === before) : -1;
  if (at < 0) at = current.frames.length;
  current.frames.splice(at, 0, ...moving);
  normalizeObject(current);
  dragIds = null;
  renderObjectFrames();
  savePack();
});

// ---------- copying frames ----------
// Ctrl+C copies the picked frames; Ctrl+V adds them, as new frames, to the
// part under the pointer — or the part picked — after the picked frame if it
// is in that part, else at its end. The copy is the one the pixel editor and
// the Tiles tab use: the first frame is also plain pixels there, and pixels
// copied there paste here as one new frame. A copy of another size is centred
// in the frame, never scaled.
let frameClip = null;       // { frames: [canvas…] } — frames[0] is pixelClip while it is current
let hoverLane = null;       // the part lane under the pointer
$('#objLanes').addEventListener('mousemove', e => { hoverLane = e.target.closest('.lane')?.dataset.lane || null; });
$('#objLanes').addEventListener('mouseleave', () => { hoverLane = null; });

function copyFrames() {
  const o = current;
  const picked = o ? o.frames.filter(f => selFrames.has(f.id)) : [];
  if (!picked.length) { toast('Click a frame to pick it, then Ctrl+C', true); return; }
  frameClip = { frames: picked.map(f => cloneCanvas(frameCanvas(o, f))) };
  pixelClip = frameClip.frames[0];
  $('#opPaste').disabled = false;
  toast(picked.length > 1 ? `Copied ${picked.length} frames` : 'Copied the frame — Ctrl+V pastes it into a part, or into the pixel editor');
}

function pasteFrames() {
  const o = current;
  if (!o) { toast('Pick a sprite first', true); return; }
  if (!pixelClip) { toast('Copy a frame first — click one and press Ctrl+C', true); return; }
  // the frames just copied, or pixels copied in the pixel editor or Tiles tab since
  const srcs = frameClip && frameClip.frames[0] === pixelClip ? frameClip.frames : [pixelClip];
  const partId = (hoverLane && partById(o, hoverLane) ? hoverLane : null) || o.active || o.parts[0].id;
  const picked = o.frames.filter(f => selFrames.has(f.id) && f.partId === partId);
  let after = picked.length ? picked[picked.length - 1].id : null;
  markUndo();
  const made = srcs.map(src => {
    const c = blankCanvas(o.fw, o.fh);
    c.getContext('2d').drawImage(src, Math.round((o.fw - src.width) / 2), Math.round((o.fh - src.height) / 2));
    const f = insertFrame(o, partId, after, c);
    after = f.id;
    return f;
  });
  selFrames.clear();
  made.forEach(f => selFrames.add(f.id));
  o.active = partId;
  normalizeObject(o);
  renderObjects();
  savePack();
  const part = partById(o, partId);
  const sized = srcs.some(c => c.width !== o.fw || c.height !== o.fh) ? ' (centred — the sizes differ)' : '';
  toast(`Pasted ${made.length > 1 ? made.length + ' frames' : 'a frame'} into "${part.name}"${sized}`);
}

document.addEventListener('keydown', e => {
  if ($('#paint').open || e.target.matches('input,select,textarea')) return;
  if ((e.ctrlKey || e.metaKey) && $('[data-page="objects"]').classList.contains('on')) {
    // by the key's place, so it works whatever the keyboard's language
    const key = e.code || 'Key' + (e.key || '').toUpperCase();
    if (key === 'KeyC') { e.preventDefault(); copyFrames(); return; }
    if (key === 'KeyV') { e.preventDefault(); pasteFrames(); return; }
  }
  if (e.key === 'Escape' && selFrames.size) {
    selFrames.clear();
    $$('#objLanes .frame.sel').forEach(x => x.classList.remove('sel'));
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selFrames.size && current) {
    e.preventDefault();
    markUndo();
    current.frames = current.frames.filter(f => !selFrames.has(f.id));
    selFrames.forEach(dropFrameCanvas);
    selFrames.clear();
    renderObjectFrames();
    savePack();
  }
});

// ---------- bringing art in ----------
async function addFrameFiles(files) {
  const o = current;
  if (!o) { toast('Pick an object first', true); return; }
  const imgs = [...files].filter(f => f.type.startsWith('image/'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!imgs.length) return;
  markUndo();
  const first = !o.frames.length;
  for (const file of imgs) {
    const src = await readURL(file);
    const img = await loadImg(src);
    if (first && o.frames.length === 0) { o.fw = img.naturalWidth; o.fh = img.naturalHeight; fcan.clear(); }
    const f = { id: uid(), src, partId: o.active || o.parts[0].id };
    o.frames.push(f);
    await attachFrame(o, f);
  }
  normalizeObject(o);
  renderObjects();
  savePack();
  toast(`Added ${imgs.length} frames`);
}

// A strip is one row of equal frames, which is how the generated art arrives.
async function sliceStrip(file, count) {
  const o = current;
  const src = await readURL(file);
  const img = await loadImg(src);
  markUndo();
  const fw = Math.round(img.naturalWidth / count);
  o.fw = fw;
  o.fh = img.naturalHeight;
  fcan.clear();
  o.frames = [];
  const partId = o.parts[0].id;
  for (let i = 0; i < count; i++) {
    const c = blankCanvas(fw, o.fh);
    c.getContext('2d').drawImage(img, i * fw, 0, fw, o.fh, 0, 0, fw, o.fh);
    insertFrame(o, partId, null, c);
  }
  normalizeObject(o);
  renderObjects();
  savePack();
  toast(`Sliced ${count} frames`);
}

$('#frAdd').onclick = async () => addFrameFiles(await pickFiles('image/*', true));
$('#frDraw').onclick = () => {
  if (!current) { toast('Pick an object first', true); return; }
  const f = insertFrame(current, current.active || current.parts[0].id, null, blankCanvas(current.fw, current.fh));
  renderObjectFrames();
  openPaint(current, f);
};
$('#frStrip').onclick = async () => {
  if (!current) { toast('Pick an object first', true); return; }
  const [file] = await pickFiles('image/*');
  if (!file) return;
  const got = await ask('Slice a strip', [
    { key: 'n', label: 'How many frames are in it?', type: 'number', value: 6 }
  ], 'Slice');
  const n = got && parseInt(got.n, 10);
  if (!n || n < 1) return;
  sliceStrip(file, n).catch(err => toast(err.message, true));
};

// ---------- properties ----------
function renderProps() {
  const o = current;
  const box = $('#objProps');
  if (!o) { box.innerHTML = '<p class="empty">Nothing selected.</p>'; return; }
  const users = usersOf(o);
  box.innerHTML = `
    <label class="ctl"><span>Name</span><input data-p="name" value="${esc(o.name)}"></label>
    <label class="ctl"><div class="row"><span>Frames per second</span><output>${o.fps || 'still'}</output></div>
      <input type="range" data-p="fps" min="0" max="30" step="0.5" value="${o.fps}">
      <span class="hint fpswarn" id="fpsWarn" hidden></span></label>
    <div class="ctl glowctl">
      <label class="toggle"><input type="checkbox" data-p="glowon" ${glowPart(o) ? 'checked' : ''}> Glows</label>
      ${glowPart(o) ? `<p class="hint">Its <b>${esc(glowPart(o).name)}</b> part is the glow: draw or drag frames into it, and frame by frame the game fills them with a colour over the rest.</p>
      <div class="row gap">
        <label class="toggle"><input type="checkbox" data-p="glowfix" ${o.glow ? 'checked' : ''}> Its own colour</label>
        ${o.glow ? `<input type="color" data-p="glow" value="${o.glow}" aria-label="Glow colour">` : ''}
      </div>
      <p class="hint">${o.glow ? 'Always glows this colour.' : 'Glows in the colour of whatever it is paired with.'}</p>` : ''}
    </div>
    <label class="ctl"><div class="row"><span>Slice (stretch middle)</span><output>${num(o.slice)}</output></div>
      <input type="range" data-p="slice" min="0" max="64" step="0.5" value="${o.slice}"></label>
    <div class="ctl"><span>Worn by</span><p class="hint" style="margin:0">${users.length
      ? users.map(u => `<button type="button" class="linkcode" data-goto="${u.id}" title="Open this object">${esc(u.cls)}::${esc(u.name)}</button>`).join(' ')
      : 'no object yet — make one on the Objects tab.'}</p></div>
    <div class="ctl"><span>&nbsp;</span><button class="btn sm danger" data-p="delete">Delete this sprite</button></div>`;
  renderCalc();                  // fills in the rate warning the fields above just made room for
}

$('#objProps').addEventListener('input', e => {
  const o = current;
  const key = e.target.dataset.p;
  if (!o || !key) return;
  markUndo();
  const v = e.target.value;
  if (key === 'name') o.name = v;          // tidied into a slug once the field is left
  else if (key === 'fps') o.fps = +v;
  else if (key === 'slice') o.slice = +v;
  else if (key === 'glow') o.glow = v;
  else if (key === 'glowon' || key === 'glowfix') {
    if (key === 'glowon') { setGlows(o, e.target.checked); return; }
    // the colour is kept aside, so switching it back on brings it back
    if (e.target.checked) o.glow = o.glowWas || '#ffd93a';
    else { o.glowWas = o.glow; o.glow = ''; }
    renderProps();
    savePack();
    return;
  }

  const out = e.target.parentElement.querySelector('output');
  if (out) out.textContent = key === 'fps' ? (o.fps || 'still') : num(+v);
  if (key === 'name') renderObjectList();   // the field is in this panel, so it must not be redrawn
  renderCalc();
  savePack();
});

// A name becomes a key in objects.json, so it is slugged — but only once the
// field is left, or every space would reshape what is still being typed.
// The objects that wear it name it, so a new name is carried to them.
let renameFrom = null;
$('#objProps').addEventListener('focusin', e => { if (e.target.dataset.p === 'name' && current) renameFrom = current.name; });
$('#objProps').addEventListener('change', e => {
  if (e.target.dataset.p !== 'name' || !current) return;
  current.name = slug(e.target.value) || renameFrom || current.name;
  e.target.value = current.name;
  if (renameFrom && renameFrom !== current.name) {
    for (const o of pack.objects) {
      for (const [k, d] of Object.entries(classDefs(o.cls))) {
        if (d.type === 'sprite' && refName(o.props[k]) === renameFrom) o.props[k] = 'sprite::' + current.name;
      }
    }
  }
  renameFrom = current.name;
  renderObjectList();
  renderProps();
  savePack();
});

$('#objProps').addEventListener('click', e => {
  // an object that wears this sprite, opened on the Objects tab
  const go = e.target.closest('[data-goto]');
  if (go) {
    navJump();
    currentObj = pack.objects.find(o => o.id === go.dataset.goto) || currentObj;
    showTab('gameobjects');
    renderGameObjects();
    return;
  }
  if (e.target.dataset.p !== 'delete' || !current) return;
  markUndo();
  const users = usersOf(current);
  pack.sprites = pack.sprites.filter(o => o !== current);
  current = pack.sprites[0] || null;
  renderObjects();
  savePack();
  toast(users.length
    ? `Sprite deleted — ${users.map(u => u.name).join(', ')} now ${users.length > 1 ? 'have' : 'has'} no look. Ctrl+Z brings it back`
    : 'Sprite deleted — Ctrl+Z brings it back');
});

