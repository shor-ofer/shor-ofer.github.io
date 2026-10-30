// ---------- preview: the sprite on the grid, and its collision ----------
// Two things are set here, each against its parent. The sprite sits on the
// tile grid, which never moves: drag it, or pull a corner to scale it. The
// collision belongs to the sprite: it moves and scales with it, and dragging
// it moves it within the sprite.
//
// The game holds that as three numbers. `pivot` is where the collision centre
// sits in the art (a fraction of the frame), `tiles` is the sprite's size,
// and `offset` is how far the collision centre is from the point the object's
// kind spawns at in its cell. Everything here is in game pixels from the
// cell's top-left corner; the art is in source pixels, and `scale` is what
// sits between the two.

const pv = { playing: true, i: 0, acc: 0, last: 0, zoom: 1, view: null, viewFor: null, lay: null, drag: null };
const SHAPES = [
  ['none', 'None', ''],
  ['circle', 'Circle', '<circle cx="13" cy="6" r="5"/>'],
  ['box', 'Box', '<rect x="5" y="2" width="16" height="8"/>'],
  ['tile', 'Tile', '<rect x="8" y="1" width="10" height="10"/><path d="M8 6h10M13 1v10"/>']
];
const SNAP = 0.5;                  // half a pixel, which is what a centred odd size needs

// Where in its cell a sprite is placed: as its class has it (cellAnchor) for
// the first object that wears it, or the middle for one nothing wears yet.
function spriteAnchor(o) {
  const user = pack.objects.find(x => refName(x.props.sprite) === o.name);
  const C = user && gameClass(user.cls);
  return C ? C.cellAnchor : [0.5, 0.5];
}

// The pairing colours, as src/js/atlas.js has them. A glow without a colour of
// its own takes the one of whatever it is paired with, and an object paired
// with nothing (0) has none, so the preview borrows one to show it by.
const KEY_COLORS = ['#ffffff', '#ff5a5a', '#ffa23a', '#ffd93a', '#5fe86b',
                    '#4fc9e8', '#6a8cff', '#b06aff', '#ff6ad5', '#9a7b5a'];
let pvPair = 1;
const tints = new WeakMap();      // mask frame canvas -> { hex, canvas } filled with its colour

// The glow as the game draws it: the mask's frame, filled flat with the colour.
function tinted(src, hex) {
  const had = tints.get(src);
  if (had && had.hex === hex && had.canvas.width === src.width && had.canvas.height === src.height) return had.canvas;
  const c = cloneCanvas(src);
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = hex;
  g.fillRect(0, 0, c.width, c.height);
  tints.set(src, { hex, canvas: c });
  return c;
}

function setPlaying(on) {
  pv.playing = on;
  $('#pvPlay').textContent = on ? 'Pause' : 'Play';
}
$('#pvPlay').onclick = () => setPlaying(!pv.playing);

// Everything the preview and its handles work from, for the sprite open now.
// (`art` is the sprite itself; it once could be another's, for a copy.)
function shapeOf(o = current) {
  if (!o) return null;
  const art = o;
  const scale = (art.tiles * TILE) / art.fw;
  const a = spriteAnchor(o);
  const off = art.offset || [0, 0];
  const size = { w: art.fw * scale, h: art.fh * scale };
  const C = { x: a[0] * TILE + off[0], y: a[1] * TILE + off[1] };       // collision centre
  return {
    o, art, scale, size, C,
    S: { x: a[0] * TILE, y: a[1] * TILE },                              // where its kind spawns
    T: { x: C.x - art.pivot[0] * size.w, y: C.y - art.pivot[1] * size.h },  // sprite's top-left
    col: o.collision || { shape: 'none' },
    inherited: false,
    locked: false
  };
}

// The collision to write into.
function ownCol(s) {
  if (!s.o.collision) s.o.collision = s.col;
  return s.col;
}

// Writes a sprite placement back as the three numbers the game keeps: the
// sprite's top-left T, the collision centre C, and the sprite's width.
function place(s, T, C, w) {
  const { o, art } = s;
  const h = w * art.fh / art.fw;
  o.tiles = num(w / TILE, 6);
  o.pivot = [num((C.x - T.x) / w, 6), num((C.y - T.y) / h, 6)];
  o.offset = [num(C.x - s.S.x, 4), num(C.y - s.S.y, 4)];
}

function shapeBox(s) {
  const { C, col } = s;
  if (col.shape === 'circle') return { x0: C.x - col.r, x1: C.x + col.r, y0: C.y - col.r, y1: C.y + col.r };
  if (col.shape === 'box') return { x0: C.x - col.w / 2, x1: C.x + col.w / 2, y0: C.y, y1: C.y + col.h };
  return { x0: C.x, x1: C.x, y0: C.y, y1: C.y };
}

function contentBox(s) {
  const b = shapeBox(s);
  return {
    x0: Math.min(0, s.T.x, b.x0), x1: Math.max(TILE, s.T.x + s.size.w, b.x1),
    y0: Math.min(0, s.T.y, b.y0), y1: Math.max(TILE, s.T.y + s.size.h, b.y1)
  };
}

// The cell and half a tile round it, grown to take in the sprite and its
// shape. It is only worked out again for another object, on Fit, or when
// something has been dragged out of it, so the grid holds still under
// everything else.
function viewBounds(s) {
  const c = contentBox(s), m = TILE / 2;
  return { x0: Math.min(c.x0 - 4, -m), x1: Math.max(c.x1 + 4, TILE + m), y0: Math.min(c.y0 - 4, -m), y1: Math.max(c.y1 + 4, TILE + m) };
}

function layout(s) {
  if (!pv.drag) {
    const c = contentBox(s), v = pv.view;
    if (!v || pv.viewFor !== s.o.id || c.x0 < v.x0 || c.x1 > v.x1 || c.y0 < v.y0 || c.y1 > v.y1) {
      pv.view = viewBounds(s);
      pv.viewFor = s.o.id;
    }
  }
  const v = pv.view;
  const fit = Math.min(($('#objStage').clientWidth - 22) / (v.x1 - v.x0), 340 / (v.y1 - v.y0));
  const k = Math.max(0.1, fit * pv.zoom);
  return { ...v, k, w: Math.round((v.x1 - v.x0) * k), h: Math.round((v.y1 - v.y0) * k) };
}

// Every handle on screen, in canvas pixels.
function handlesOf(s, L) {
  const { col, C, T, size } = s;
  const k = L.k;
  const X = x => (x - L.x0) * k, Y = y => (y - L.y0) * k;
  const hs = [];
  if (col.shape === 'circle') {
    hs.push({ id: 'r', x: X(C.x + col.r), y: Y(C.y) }, { id: 'r', x: X(C.x - col.r), y: Y(C.y) },
            { id: 'r', x: X(C.x), y: Y(C.y + col.r) }, { id: 'r', x: X(C.x), y: Y(C.y - col.r) });
  } else if (col.shape === 'box') {
    const hw = col.w / 2;
    hs.push({ id: 'w', x: X(C.x + hw), y: Y(C.y + col.h / 2) }, { id: 'w', x: X(C.x - hw), y: Y(C.y + col.h / 2) },
            { id: 'h', x: X(C.x), y: Y(C.y + col.h) },
            { id: 'wh', x: X(C.x + hw), y: Y(C.y + col.h) }, { id: 'wh', x: X(C.x - hw), y: Y(C.y + col.h) });
  }
  if (!s.locked) {
    // the sprite's corners scale it, about the opposite one
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([cx, cy]) =>
      hs.push({ id: 'scale', corner: [cx, cy], x: X(T.x + cx * size.w), y: Y(T.y + cy * size.h), sprite: true }));
  }
  return { hs, X, Y };
}

const CURSORS = { r: 'nwse-resize', w: 'ew-resize', h: 'ns-resize', wh: 'nwse-resize', col: 'grab', sprite: 'move' };

function hitTest(s, L, mx, my) {
  const { hs, X, Y } = handlesOf(s, L);
  for (const h of hs) if (Math.abs(mx - h.x) <= 7 && Math.abs(my - h.y) <= 7) return h;
  const { col, C, T, size } = s;
  const cx = X(C.x), cy = Y(C.y), k = L.k;
  // the outline itself is a handle too, so the shape can be sized anywhere on it
  if (col.shape === 'circle') {
    const d = Math.hypot(mx - cx, my - cy);
    if (Math.abs(d - col.r * k) <= 5) return { id: 'r' };
    if (d < col.r * k && !s.locked) return { id: 'col' };
  }
  if (col.shape === 'box') {
    const hw = col.w / 2 * k, h = col.h * k;
    const inY = my >= cy - 4 && my <= cy + h + 4, inX = mx >= cx - hw - 4 && mx <= cx + hw + 4;
    if (inY && Math.abs(Math.abs(mx - cx) - hw) <= 5) return { id: 'w' };
    if (inX && Math.abs(my - (cy + h)) <= 5) return { id: 'h' };
    if (inX && inY && !s.locked) return { id: 'col' };
  }
  if ((col.shape === 'none' || col.shape === 'tile') && !s.locked && Math.hypot(mx - cx, my - cy) <= 7) return { id: 'col' };
  if (!s.locked && mx >= X(T.x) && mx <= X(T.x + size.w) && my >= Y(T.y) && my <= Y(T.y + size.h)) return { id: 'sprite' };
  return null;
}

function cursorFor(h) {
  if (!h) return 'default';
  if (h.id === 'scale') return h.corner[0] === h.corner[1] ? 'nwse-resize' : 'nesw-resize';
  if (h.id === 'col' && pv.drag) return 'grabbing';
  return CURSORS[h.id];
}

function drawScene(g, s, L, frame) {
  const { art, col, inherited, C, T, S, size } = s;
  const { hs, X, Y } = handlesOf(s, L);
  const k = L.k;

  // the cell the object is placed in, and the grid around it
  g.fillStyle = 'rgba(255,181,71,.07)';
  g.fillRect(X(0), Y(0), TILE * k, TILE * k);
  if ($('#pvGrid').checked) {
    g.strokeStyle = 'rgba(255,181,71,.22)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = Math.ceil(L.x0 / TILE) * TILE; x <= L.x1; x += TILE) { g.moveTo(Math.round(X(x)) + .5, 0); g.lineTo(Math.round(X(x)) + .5, L.h); }
    for (let y = Math.ceil(L.y0 / TILE) * TILE; y <= L.y1; y += TILE) { g.moveTo(0, Math.round(Y(y)) + .5); g.lineTo(L.w, Math.round(Y(y)) + .5); }
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,181,71,.55)';
  g.strokeRect(Math.round(X(0)) + .5, Math.round(Y(0)) + .5, Math.round(TILE * k), Math.round(TILE * k));

  // the sprite
  const sx = X(T.x), sy = Y(T.y), sw = size.w * k, sh = size.h * k;
  if (frame) g.drawImage(frameCanvas(art, frame), sx, sy, sw, sh);
  // its glow over it: frame n of the object wears frame n of its glow part,
  // round again if the glow is shorter — the frame the game would pick
  const gp = glowPart(art);
  const glowFrames = gp ? framesOfPart(art, gp.id) : [];
  const body = bodyFrames(art);
  if (frame && glowFrames.length && frame.partId !== gp.id && $('#pvGlow').checked) {
    const gf = glowFrames[body.indexOf(frame) % glowFrames.length];
    const hex = art.glow || KEY_COLORS[pvPair];
    g.drawImage(tinted(frameCanvas(art, gf), hex), sx, sy, sw, sh);
  }
  const dragging = pv.drag && (pv.drag.id === 'sprite' || pv.drag.id === 'scale');
  g.strokeStyle = dragging ? 'rgba(255,181,71,.9)' : 'rgba(239,233,255,.35)';
  g.setLineDash([3, 3]);
  g.strokeRect(Math.round(sx) + .5, Math.round(sy) + .5, Math.round(sw) - 1, Math.round(sh) - 1);
  g.setLineDash([]);

  // where its kind spawns, which the offset is measured from
  g.strokeStyle = 'rgba(255,111,174,.8)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(X(S.x) - 4, Y(S.y) - 4); g.lineTo(X(S.x) + 4, Y(S.y) + 4);
  g.moveTo(X(S.x) + 4, Y(S.y) - 4); g.lineTo(X(S.x) - 4, Y(S.y) + 4);
  g.stroke();

  // the collision
  g.save();
  g.fillStyle = 'rgba(111,240,200,.16)';
  g.strokeStyle = '#6ff0c8';
  g.lineWidth = 1.5;
  if (inherited) g.setLineDash([5, 4]);
  g.beginPath();
  if (col.shape === 'circle') g.arc(X(C.x), Y(C.y), Math.max(0, col.r * k), 0, Math.PI * 2);
  else if (col.shape === 'box') g.rect(X(C.x - col.w / 2), Y(C.y), col.w * k, col.h * k);
  g.fill();
  g.stroke();
  g.restore();
  g.fillStyle = '#6ff0c8';
  g.beginPath();
  g.arc(X(C.x), Y(C.y), 3, 0, Math.PI * 2);
  g.fill();

  for (const h of hs) {
    const on = pv.drag && pv.drag.id === h.id && (!h.corner || pv.drag.corner === h.corner);
    g.fillStyle = on ? '#ffb547' : h.sprite ? 'rgba(255,181,71,.85)' : '#fff';
    g.strokeStyle = '#120e21';
    g.lineWidth = 1.5;
    g.fillRect(h.x - 4, h.y - 4, 8, 8);
    g.strokeRect(h.x - 4, h.y - 4, 8, 8);
  }
}

function pvTick(t) {
  const dt = Math.min(0.25, (t - (pv.last || t)) / 1000);
  pv.last = t;
  requestAnimationFrame(pvTick);
  const s = shapeOf();
  const cv = $('#objPv');
  if (!s || !$('#objStage').clientWidth) {
    if (cv.width !== 1) { cv.width = cv.height = 1; cv.style.width = cv.style.height = ''; }
    $('#pvRead').textContent = '';
    return;
  }
  const { art } = s;
  const lane = framesOfPart(art, art.active);
  // a still object shows a part's first frame in the game, so it does here;
  // clicking a frame still shows that one
  const fps = art.fps;
  if (pv.playing && lane.length && fps) {
    pv.acc += dt;
    while (pv.acc >= 1 / fps) { pv.acc -= 1 / fps; pv.i++; }
  } else if (pv.playing && !fps) pv.i = 0;
  if (lane.length) pv.i %= lane.length;

  // the glow's controls only for something that glows, and the pairing
  // swatch only when its colour comes from a pairing
  const gp = glowPart(art);
  const glows = !!gp && framesOfPart(art, gp.id).length > 0;
  $('#pvGlowWrap').hidden = !glows;
  $('#pvPair').hidden = !glows || !!art.glow || !$('#pvGlow').checked;
  $('#pvPair').style.background = KEY_COLORS[pvPair];

  const L = pv.lay = layout(s);
  const dpr = window.devicePixelRatio || 1;
  // resizing a canvas clears and reallocates it, so only when it has to
  if (cv.width !== Math.round(L.w * dpr) || cv.height !== Math.round(L.h * dpr)) {
    cv.width = Math.round(L.w * dpr);
    cv.height = Math.round(L.h * dpr);
    cv.style.width = L.w + 'px';
    cv.style.height = L.h + 'px';
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, L.w, L.h);
  g.imageSmoothingEnabled = false;
  drawScene(g, s, L, lane.length ? lane[pv.i] : null);

  $('#pvRead').textContent = lane.length
    ? `${pv.i + 1}/${lane.length} · ${art.fps ? art.fps + ' fps' : 'still'}`
    : 'no frames in this part';
}
requestAnimationFrame(pvTick);

// ---------- dragging on the preview ----------
function pointerAt(e) {
  const r = $('#objPv').getBoundingClientRect();
  const L = pv.lay;
  const mx = (e.clientX - r.left) * (L.w / r.width), my = (e.clientY - r.top) * (L.h / r.height);
  return { mx, my, x: mx / L.k + L.x0, y: my / L.k + L.y0 };   // canvas px, and game px from the cell's corner
}

const snapTo = (v, step, free) => free ? num(v, 2) : Math.round(v / step) * step;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Sets the sprite's width, scaling the collision with it and holding one
// point of the sprite (a fraction of it) where it was.
function scaleSprite(s, w, hold) {
  const { size, T } = s;
  const ratio = w / size.w;
  const F = { x: T.x + hold[0] * size.w, y: T.y + hold[1] * size.h };
  const T2 = { x: F.x - hold[0] * w, y: F.y - hold[1] * size.h * ratio };
  const C2 = { x: T2.x + s.art.pivot[0] * w, y: T2.y + s.art.pivot[1] * size.h * ratio };
  if (!s.inherited && s.col.shape !== 'tile' && s.col.shape !== 'none') {
    const c = s.o.collision;
    if (c.r) c.r = num(c.r * ratio, 2);
    if (c.w) c.w = num(c.w * ratio, 2);
    if (c.h) c.h = num(c.h * ratio, 2);
  }
  place(s, T2, C2, w);
}

function applyDrag(s, d, at, free) {
  const dx = at.x - d.x, dy = at.y - d.y;
  const { size, T, C } = d.s;          // where things were when the drag began
  if (d.id === 'sprite') {
    // sprite and collision together, on whole pixels so the art stays crisp
    const T2 = { x: snapTo(T.x + dx, 1, free), y: snapTo(T.y + dy, 1, free) };
    place(s, T2, { x: C.x + T2.x - T.x, y: C.y + T2.y - T.y }, size.w);
  } else if (d.id === 'col') {
    // the collision within the sprite, on half pixels of the art
    const px = snapTo((C.x + dx - T.x) / d.s.scale, SNAP, free) * d.s.scale;
    const py = snapTo((C.y + dy - T.y) / d.s.scale, SNAP, free) * d.s.scale;
    place(s, T, { x: T.x + px, y: T.y + py }, size.w);
  } else if (d.id === 'scale') {
    // about the opposite corner, keeping the art's shape
    const hold = [1 - d.corner[0], 1 - d.corner[1]];
    const F = { x: T.x + hold[0] * size.w, y: T.y + hold[1] * size.h };
    const want = Math.max(Math.abs(at.x - F.x), Math.abs(at.y - F.y) * size.w / size.h);
    // restart from the drag's own start each time, so sizes don't compound
    Object.assign(s.o, structuredClone(d.start));
    const fresh = shapeOf(s.o);
    scaleSprite(fresh, Math.max(4, snapTo(want, 1, free)), hold);
    renderCalc();
  } else {
    const col = ownCol(s);
    const ax = at.x - s.C.x, ay = at.y - s.C.y;
    if (d.id === 'r') col.r = Math.max(SNAP, snapTo(Math.hypot(ax, ay), SNAP, free));
    if (d.id === 'w' || d.id === 'wh') col.w = Math.max(1, snapTo(Math.abs(ax) * 2, 1, free));
    if (d.id === 'h' || d.id === 'wh') col.h = Math.max(1, snapTo(ay, 1, free));
  }
}

$('#objPv').addEventListener('pointerdown', e => {
  const s = shapeOf();
  if (!s || !pv.lay || e.button !== 0) return;
  const at = pointerAt(e);
  const h = hitTest(s, pv.lay, at.mx, at.my);
  if (!h) return;
  e.preventDefault();
  $('#objPv').focus({ focusVisible: false });
  $('#objPv').setPointerCapture(e.pointerId);
  markUndo();
  const o = s.o;
  pv.drag = {
    id: h.id, corner: h.corner, x: at.x, y: at.y, s,
    start: structuredClone({ tiles: o.tiles, pivot: o.pivot, offset: o.offset || [0, 0], collision: o.collision })
  };
  $('#objPv').style.cursor = cursorFor(h);
});

$('#objPv').addEventListener('pointermove', e => {
  const s = shapeOf();
  if (!s || !pv.lay) return;
  const at = pointerAt(e);
  if (!pv.drag) {
    $('#objPv').style.cursor = cursorFor(hitTest(s, pv.lay, at.mx, at.my));
    return;
  }
  applyDrag(s, pv.drag, at, e.shiftKey);
  syncShape();
});

const endShapeDrag = () => {
  if (!pv.drag) return;
  pv.drag = null;
  syncShape();
  savePack();
};
$('#objPv').addEventListener('pointerup', endShapeDrag);
$('#objPv').addEventListener('pointercancel', endShapeDrag);

// arrow keys nudge the sprite a pixel, or a tile with Shift; Alt nudges the
// collision within it instead
$('#objPv').addEventListener('keydown', e => {
  const s = shapeOf();
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!s || !dir || s.locked) return;
  e.preventDefault();
  markUndo();
  const { T, C, size, scale } = s;
  if (e.altKey) {
    place(s, T, { x: C.x + dir[0] * scale, y: C.y + dir[1] * scale }, size.w);
  } else {
    const step = e.shiftKey ? TILE : 1;
    place(s, { x: T.x + dir[0] * step, y: T.y + dir[1] * step }, { x: C.x + dir[0] * step, y: C.y + dir[1] * step }, size.w);
  }
  syncShape();
  savePack();
});

$('#pvPair').onclick = () => { pvPair = pvPair % (KEY_COLORS.length - 1) + 1; };

$('#pvZoom').addEventListener('click', e => {
  const z = e.target.closest('[data-z]');
  if (!z) return;
  const dz = +z.dataset.z;
  if (dz === 0) { pv.zoom = 1; pv.view = null; }
  else pv.zoom = clamp(pv.zoom * (dz > 0 ? 1.5 : 1 / 1.5), 1, 12);
});

// ---------- the fields under it ----------
// The sprite reads in game pixels against its cell, where a tile is 32; the
// collision in the art's own pixels, since it is the sprite's.
const ANCHORS = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]];
const ANCHOR_NAMES = ['top left', 'top', 'top right', 'left', 'centre', 'right', 'bottom left', 'bottom', 'bottom right'];

function renderShape() {
  const box = $('#objShape');
  const s = shapeOf();
  if (!s) { box.innerHTML = ''; return; }
  const { col, locked, inherited } = s;
  const field = (k, label, step, dis) => `<label class="nf"><span>${label}</span><input type="number" data-n="${k}" step="${step}" ${dis ? 'disabled' : ''}></label>`;
  const sized = col.shape === 'circle' || col.shape === 'box';
  box.innerHTML = `
    <div class="ctl"><span>Sprite on the grid</span>
      <div class="pivotrow">
        <div class="anchors" aria-label="Line the sprite up with its cell">${ANCHORS.map((a, i) =>
          `<button data-anchor="${i}" title="Sprite's ${ANCHOR_NAMES[i]} on the cell's ${ANCHOR_NAMES[i]}" aria-label="Align ${ANCHOR_NAMES[i]}" ${locked ? 'disabled' : ''}></button>`).join('')}</div>
        <div class="nfs three">${field('tx', 'x', 1, locked)}${field('ty', 'y', 1, locked)}${field('tiles', 'Tiles wide', 0.125, locked)}</div>
      </div>
    </div>
    <div class="ctl"><span>Collision on the sprite</span>
      <div class="seg shapeseg">${SHAPES.map(([k, label, icon]) =>
        `<button data-shape="${k}" class="${k === col.shape ? 'on' : ''}" title="${label}">
          ${icon ? `<svg viewBox="0 0 26 12" fill="none" stroke="currentColor" stroke-width="1.4">${icon}</svg>` : ''}<span>${label}</span></button>`).join('')}</div>
      <div class="nfs three">
        ${field('cx', 'Centre x', SNAP, locked)}${field('cy', 'Centre y', SNAP, locked)}
        ${col.shape === 'circle' ? field('r', 'Radius', SNAP) : ''}
      </div>
      ${col.shape === 'box' ? `<div class="nfs">${field('w', 'Width', SNAP)}${field('h', 'Height', SNAP)}</div>` : ''}
      ${locked ? '' : '<button class="btn sm" data-centre>Centre it on the sprite</button>'}
    </div>
    <p class="hint">${locked ? '' : 'Drag the sprite to move it on the grid — its collision goes with it — or pull an amber corner to scale both. Drag inside the collision to move it on the sprite. '}
      ${sized ? 'White handles size the collision. ' : ''}${col.shape === 'tile' ? 'It fills its cell in the collision grid. ' : ''}
      The collision is in the art's own pixels; the sprite in game pixels from its cell's corner.
      <br><span class="muted">Shift drags without snapping · arrows nudge the sprite, Shift a tile, Alt the collision</span></p>`;
  syncShape();
}

// Fills the fields from the object without redrawing them, so one being typed
// in keeps its caret.
function syncShape(force) {
  const s = shapeOf();
  if (!s) return;
  const { art, col, T, scale } = s;
  const vals = {
    tx: num(T.x), ty: num(T.y), tiles: num(art.tiles, 4),
    cx: num(art.pivot[0] * art.fw), cy: num(art.pivot[1] * art.fh),
    r: num((col.r || 0) / scale), w: num((col.w || 0) / scale), h: num((col.h || 0) / scale)
  };
  $$('#objShape [data-n]').forEach(i => { if (force || i !== document.activeElement) i.value = vals[i.dataset.n]; });
  $$('#objShape [data-anchor]').forEach(b => {
    const a = ANCHORS[b.dataset.anchor];
    const near = (v, w) => Math.abs(v - w) < 0.01;
    b.classList.toggle('on', near(T.x + a[0] * s.size.w, a[0] * TILE) && near(T.y + a[1] * s.size.h, a[1] * TILE));
  });
}

$('#objShape').addEventListener('click', e => {
  const s = shapeOf();
  if (!s) return;
  const sb = e.target.closest('[data-shape]');
  if (sb) {
    markUndo();
    const k = sb.dataset.shape;
    const { art, scale } = s;
    // the sizes of a shape not in use are kept, so flipping back loses nothing;
    // a first one is fitted to the art
    const prev = s.inherited ? { ...s.col } : (s.o.collision || {});
    const c = { ...prev, shape: k };
    if (k === 'circle' && !c.r) c.r = num(Math.min(art.fw, art.fh) * scale / 2 * 0.8, 1) || 8;
    if (k === 'box' && !c.w) c.w = Math.round(art.fw * scale) || 32;
    if (k === 'box' && !c.h) c.h = Math.max(1, Math.round((1 - art.pivot[1]) * art.fh * scale)) || 10;
    s.o.collision = c;
    renderShape();
    savePack();
    return;
  }
  if (s.locked) return;
  const ab = e.target.closest('[data-anchor]');
  if (ab) {
    // the sprite's point on the cell's same point, collision along with it
    markUndo();
    const a = ANCHORS[ab.dataset.anchor];
    const T2 = { x: a[0] * TILE - a[0] * s.size.w, y: a[1] * TILE - a[1] * s.size.h };
    place(s, T2, { x: s.C.x + T2.x - s.T.x, y: s.C.y + T2.y - s.T.y }, s.size.w);
    syncShape();
    savePack();
    return;
  }
  if (e.target.closest('[data-centre]')) {
    markUndo();
    place(s, s.T, { x: s.T.x + s.size.w / 2, y: s.T.y + s.size.h / 2 }, s.size.w);
    syncShape();
    savePack();
  }
});

$('#objShape').addEventListener('input', e => {
  const k = e.target.dataset.n;
  const s = shapeOf();
  const v = parseFloat(e.target.value);
  if (!k || !s || !Number.isFinite(v)) return;
  markUndo();
  const { T, C, size, scale, art } = s;
  if (k === 'tx' || k === 'ty') {
    const T2 = { x: k === 'tx' ? v : T.x, y: k === 'ty' ? v : T.y };
    place(s, T2, { x: C.x + T2.x - T.x, y: C.y + T2.y - T.y }, size.w);
  } else if (k === 'tiles') {
    if (v <= 0) return;
    scaleSprite(s, v * TILE, [0.5, 1]);       // grows from its feet, where most things stand
    renderCalc();
  } else if (k === 'cx' || k === 'cy') {
    const px = k === 'cx' ? v : art.pivot[0] * art.fw, py = k === 'cy' ? v : art.pivot[1] * art.fh;
    place(s, T, { x: T.x + px * scale, y: T.y + py * scale }, size.w);
  } else {
    ownCol(s)[k] = Math.max(SNAP, v * scale);
  }
  syncShape();
  savePack();
});
// a value the clamp changed is shown as it really is once the field is left
$('#objShape').addEventListener('change', () => syncShape(true));
