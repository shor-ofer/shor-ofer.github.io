// ---------- the pixel editor ----------
// Lifted from the Sprite Workshop and pointed at whichever object is open:
// every frame is a data: URL, so painting is done on a working canvas and
// written back when the stroke settles.

const PAL = ['#000000', '#1d1b2e', '#3b3a5c', '#6b6f8f', '#a8adc4', '#ffffff', '#5a2a3a', '#b8433c',
             '#ff7a59', '#ffc861', '#fff3a8', '#2e7a3c', '#7fd96a', '#2a5b8a', '#5ec8ff', '#b48cff'];
const TOOLS = [['pencil', '✎', 'Pencil', 'B'], ['eraser', '⌫', 'Eraser', 'E'], ['fill', '◧', 'Fill', 'G'],
               ['picker', '◉', 'Picker', 'I'], ['line', '╱', 'Line', 'L'], ['rect', '▭', 'Rect', 'R'],
               ['ellipse', '◯', 'Ellipse', 'C'], ['blur', '◍', 'Blur', 'U'], ['outline', '◌', 'Outline', 'T'],
               ['select', '⬚', 'Select', 'S'], ['lasso', '➰', 'Lasso', 'A']];

const P = {
  obj: null, f: null, work: null, w: null, onSave: null,
  tool: 'pencil', color: '#7fd96a', alpha: 1, size: 1,
  mirror: false, grid: true, onion: true, onionPrev: 1, onionNext: false, onionOp: 0.4, z: 8,
  undo: [], redo: [], drawing: false, erase: false, start: null, last: null, snap: null,
  hover: null, layers: [], timer: 0, dirty: false, mi: 0, macc: 0, mlast: 0, raf: 0
};

const pc = $('#pc');
const pcx = pc.getContext('2d', { willReadFrequently: true });

const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

function tintCanvas(src, color) {
  const c = cloneCanvas(src);
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.65;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// The frames on either side, tinted, so a pose can be matched to its
// neighbours without flipping back and forth.
function buildOnion() {
  P.layers = [];
  if (!P.onion || !P.f) return;
  const o = P.obj;
  const L = framesOfPart(o, P.f.partId);
  const i = L.findIndex(x => x.id === P.f.id);
  const at = k => { const j = (i + k + L.length) % L.length; return j !== i ? L[j] : null; };
  for (let k = P.onionPrev; k >= 1; k--) {
    const g = at(-k);
    if (g) P.layers.push({ c: tintCanvas(frameCanvas(o, g), '#ff4d6d'), a: P.onionOp / k });
  }
  if (P.onionNext) {
    const g = at(1);
    if (g) P.layers.push({ c: tintCanvas(frameCanvas(o, g), '#4dc3ff'), a: P.onionOp });
  }
}

function paintInfo() {
  const o = P.obj;
  const L = framesOfPart(o, P.f.partId);
  const i = L.indexOf(P.f);
  const p = partById(o, P.f.partId);
  $('#ptIdx').textContent = `${i + 1}/${L.length}`;
  $('#ptWhere').textContent = `${o.name} · ${p ? p.name : '—'} · ${o.fw}×${o.fh}`;
  $('#ptPrev').disabled = i <= 0;
  $('#ptNext').disabled = i >= L.length - 1;
}

function drawPaint() {
  if (!P.work || !P.obj) return;
  const { fw, fh } = P.obj;
  const z = P.z, W = fw * z, H = fh * z;
  if (pc.width !== W || pc.height !== H) {
    pc.width = W; pc.height = H;
    pc.style.backgroundSize = `${z * 2}px ${z * 2}px`;
    pc.style.backgroundPosition = `0 0, ${z}px ${z}px`;
  }
  pcx.imageSmoothingEnabled = false;
  pcx.clearRect(0, 0, W, H);
  for (const l of P.layers) { pcx.globalAlpha = l.a; pcx.drawImage(l.c, 0, 0, W, H); }
  pcx.globalAlpha = 1;
  pcx.drawImage(P.work, 0, 0, W, H);
  drawSelection(z);
  if (P.grid && z >= 6) {
    pcx.strokeStyle = 'rgba(255,255,255,.09)';
    pcx.lineWidth = 1;
    pcx.beginPath();
    for (let x = 1; x < fw; x++) { pcx.moveTo(x * z + 0.5, 0); pcx.lineTo(x * z + 0.5, H); }
    for (let y = 1; y < fh; y++) { pcx.moveTo(0, y * z + 0.5); pcx.lineTo(W, y * z + 0.5); }
    pcx.stroke();
  }
  if (P.hover && !P.drawing && !['fill', 'picker', 'outline', 'select', 'lasso'].includes(P.tool)) {
    const s = brushSize(), o = Math.floor((s - 1) / 2);
    pcx.strokeStyle = P.tool === 'blur' ? 'rgba(94,200,255,.95)' : 'rgba(255,181,71,.95)';
    const box = l => pcx.strokeRect(l * z + 0.5, (P.hover.y - o) * z + 0.5, s * z - 1, s * z - 1);
    box(P.hover.x - o);
    if (P.mirror) box(fw - (P.hover.x - o) - s);
  }
}

function loadPaint(f) {
  disarmDel();
  if (P.work && P.float) dropFloat();
  if (P.work) flushPaint();
  P.sel = null; P.float = null; P.selPts = null; P.moving = null;
  P.f = f;
  P.work = blankCanvas(P.obj.fw, P.obj.fh);
  P.w = P.work.getContext('2d', { willReadFrequently: true });
  P.w.drawImage(frameCanvas(P.obj, f), 0, 0);
  P.undo = []; P.redo = [];
  P.mi = framesOfPart(P.obj, f.partId).indexOf(f);
  buildOnion(); paintInfo(); drawPaint();
}

function fitZoom() {
  const st = $('#ptStage');
  P.z = Math.max(1, Math.min(48, Math.floor(Math.min((st.clientWidth - 28) / P.obj.fw, (st.clientHeight - 28) / P.obj.fh))));
  drawPaint();
}

// `opts.onSave` hears each settled stroke, for an image that is not one of an
// object's frames — a background or a terrain tile, opened as a one-frame
// stand-in object — and `opts.single` hides the frame buttons and onion skin
// such an image has no use for.
function openPaint(o, f, opts = {}) {
  if (!f) return;
  markUndo();            // the dialog keeps its own history; this undoes the whole visit
  P.obj = o;
  P.onSave = opts.onSave || null;
  $('#paint').classList.toggle('single', !!opts.single);
  $('#paint').showModal();
  loadPaint(f);
  fitZoom();
  startMini();
}

function flushPaint() {
  if (!P.dirty || !P.f) return;
  clearTimeout(P.timer);
  P.dirty = false;
  P.f.src = P.work.toDataURL();
  setFrameCanvas(P.obj, P.f, P.work);
  if (P.onSave) P.onSave(P.f);
  else renderObjectFrames();
  savePack();
}
function commitPaint() { P.dirty = true; clearTimeout(P.timer); P.timer = setTimeout(flushPaint, 150); }
function goFrame(f) { flushPaint(); loadPaint(f); }

// ---------- selecting part of a frame ----------
// Select drags out a rectangle, Lasso draws round a shape; either way the
// pixels inside are the selection (P.sel, a mask), outlined. Ctrl+C copies
// them, Ctrl+X cuts them, Delete empties them. Dragging inside the selection
// lifts its pixels into a floating piece (P.float) that follows the pointer;
// a copied selection pastes back as one, where it was taken from. A floating
// piece is set down by Enter, a click outside it, another tool or another
// frame. Escape lets a selection go and sets a floating piece down.
const isSelectTool = () => P.tool === 'select' || P.tool === 'lasso';
const inFrame = (x, y) => x >= 0 && y >= 0 && x < P.obj.fw && y < P.obj.fh;
const selHas = (x, y) => !!P.sel && inFrame(x, y) && P.sel.mask[y * P.obj.fw + x] === 1;
const inFloat = (x, y) => !!P.float && x >= P.float.x && y >= P.float.y && x < P.float.x + P.float.c.width && y < P.float.y + P.float.c.height;

// The pixels a rectangle or a drawn outline takes in: those whose middles
// fall inside it, and those it passes over.
function maskFrom(points, rect) {
  const W = P.obj.fw, H = P.obj.fh, mask = new Uint8Array(W * H);
  if (rect) {
    const [a, b] = [points[0], points[points.length - 1]];
    for (let y = Math.max(0, Math.min(a.y, b.y)); y <= Math.min(H - 1, Math.max(a.y, b.y)); y++) {
      for (let x = Math.max(0, Math.min(a.x, b.x)); x <= Math.min(W - 1, Math.max(a.x, b.x)); x++) mask[y * W + x] = 1;
    }
    return mask;
  }
  const pts = points.map(q => [q.x + 0.5, q.y + 0.5]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) mask[y * W + x] = 1;
    }
  }
  for (let i = 1; i < points.length; i++) {
    linePx(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, (x, y) => { if (inFrame(x, y)) mask[y * W + x] = 1; });
  }
  if (points.length) { const q = points[0]; if (inFrame(q.x, q.y)) mask[q.y * W + q.x] = 1; }
  return mask;
}

// The selected pixels, alone, in the smallest canvas that holds them, and
// where that canvas sits in the frame. null if nothing is selected.
function selectedPixels() {
  if (!P.sel) return null;
  const W = P.obj.fw, H = P.obj.fh, m = P.sel.mask;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const src = P.w.getImageData(x0, y0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!m[(y + y0) * W + x + x0]) src.data[(y * w + x) * 4 + 3] = 0;
  const c = blankCanvas(w, h);
  c.getContext('2d').putImageData(src, 0, 0);
  return { c, x: x0, y: y0 };
}

function clearSelected() {
  const W = P.obj.fw, H = P.obj.fh, id = P.w.getImageData(0, 0, W, H);
  for (let k = 0; k < W * H; k++) if (P.sel.mask[k]) id.data[k * 4 + 3] = 0;
  P.w.putImageData(id, 0, 0);
}

// Puts a floating piece down, where it is. False if there was none.
function dropFloat() {
  if (!P.float) return false;
  const f = P.float;
  P.float = null;
  P.w.drawImage(f.c, f.x, f.y);
  // what was put down stays selected, so it can be picked up again
  const W = P.obj.fw, mask = new Uint8Array(W * P.obj.fh);
  const d = f.c.getContext('2d').getImageData(0, 0, f.c.width, f.c.height).data;
  for (let y = 0; y < f.c.height; y++) for (let x = 0; x < f.c.width; x++) {
    if (d[(y * f.c.width + x) * 4 + 3] && inFrame(x + f.x, y + f.y)) mask[(y + f.y) * W + x + f.x] = 1;
  }
  P.sel = { mask };
  commitPaint();
  drawPaint();
  return true;
}

// A piece to place: it floats over the frame until it is set down. The
// frame is snapshotted first, so one Ctrl+Z takes it all back.
function floatPiece(c, x, y) {
  dropFloat();
  pushUndo();
  P.sel = null;
  P.float = { c, x, y };
  drawPaint();
}

function copySelection(cut) {
  const piece = P.float ? { c: P.float.c, x: P.float.x, y: P.float.y } : selectedPixels();
  if (!piece) return false;
  pixelClip = cloneCanvas(piece.c);
  pixelClip.selFrom = { x: piece.x, y: piece.y };    // a part of a frame: it floats back in where it was
  $('#opPaste').disabled = false;
  copyToSystem(pixelClip);
  if (cut) {
    if (P.float) { P.float = null; commitPaint(); }
    else { pushUndo(); clearSelected(); commitPaint(); }
    P.sel = null;
    drawPaint();
  }
  paintMsg(`${cut ? 'Cut' : 'Copied'} ${pixelClip.width}×${pixelClip.height} — Ctrl+V floats it back in, then drag it into place`);
  return true;
}

// Fill and Clear with a selection: every selected pixel, joined or not —
// the colour picked (a right-click, or no opacity, empties them instead).
function fillSelection(erase) {
  const W = P.obj.fw, H = P.obj.fh, id = P.w.getImageData(0, 0, W, H);
  const a = Math.round(P.alpha * 255);
  const c = (erase || !a) ? [0, 0, 0, 0] : [...hexRgb(P.color), a];
  pushUndo();
  for (let k = 0; k < W * H; k++) if (P.sel.mask[k]) for (let n = 0; n < 4; n++) id.data[k * 4 + n] = c[n];
  P.w.putImageData(id, 0, 0);
  commitPaint();
  drawPaint();
}

function deleteSelection() {
  if (P.float) { P.float = null; commitPaint(); drawPaint(); return true; }
  if (!P.sel) return false;
  pushUndo();
  clearSelected();
  P.sel = null;
  commitPaint();
  drawPaint();
  return true;
}

function selectDown(p) {
  if (P.float && inFloat(p.x, p.y)) {
    P.moving = { px: p.x, py: p.y, fx: P.float.x, fy: P.float.y };
    return;
  }
  dropFloat();
  if (selHas(p.x, p.y)) {
    // lift the selection off the frame and carry it
    const piece = selectedPixels();
    pushUndo();
    clearSelected();
    P.sel = null;
    P.float = piece;
    P.moving = { px: p.x, py: p.y, fx: piece.x, fy: piece.y };
    drawPaint();
    return;
  }
  P.sel = null;
  P.selPts = [p];
  drawPaint();
}

function selectMove(p) {
  if (P.moving) {
    P.float.x = P.moving.fx + p.x - P.moving.px;
    P.float.y = P.moving.fy + p.y - P.moving.py;
  } else if (P.selPts) {
    const last = P.selPts[P.selPts.length - 1];
    if (P.tool === 'select') P.selPts = [P.selPts[0], p];
    else if (last.x !== p.x || last.y !== p.y) P.selPts.push(p);
  }
  drawPaint();
}

function selectUp() {
  if (P.moving) { P.moving = null; commitPaint(); drawPaint(); return; }
  if (!P.selPts) return;
  const pts = P.selPts;
  P.selPts = null;
  const mask = maskFrom(pts, P.tool === 'select');
  P.sel = mask.some(v => v) ? { mask } : null;
  drawPaint();
}

// The floating piece, the selection's outline, and the lasso or rectangle
// being drawn.
function drawSelection(z) {
  const W = P.obj.fw;
  if (P.float) {
    const f = P.float;
    pcx.drawImage(f.c, f.x * z, f.y * z, f.c.width * z, f.c.height * z);
    pcx.save();
    pcx.setLineDash([4, 3]);
    pcx.strokeStyle = 'rgba(94,200,255,.95)';
    pcx.strokeRect(f.x * z + 0.5, f.y * z + 0.5, f.c.width * z - 1, f.c.height * z - 1);
    pcx.restore();
  }
  if (P.sel) {
    const m = P.sel.mask, H = P.obj.fh;
    pcx.save();
    pcx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (!selHas(x, y - 1)) { pcx.moveTo(x * z, y * z + 0.5); pcx.lineTo((x + 1) * z, y * z + 0.5); }
      if (!selHas(x, y + 1)) { pcx.moveTo(x * z, (y + 1) * z - 0.5); pcx.lineTo((x + 1) * z, (y + 1) * z - 0.5); }
      if (!selHas(x - 1, y)) { pcx.moveTo(x * z + 0.5, y * z); pcx.lineTo(x * z + 0.5, (y + 1) * z); }
      if (!selHas(x + 1, y)) { pcx.moveTo((x + 1) * z - 0.5, y * z); pcx.lineTo((x + 1) * z - 0.5, (y + 1) * z); }
    }
    pcx.lineWidth = 1;
    pcx.strokeStyle = '#000';
    pcx.stroke();
    pcx.setLineDash([3, 3]);
    pcx.strokeStyle = '#fff';
    pcx.stroke();
    pcx.restore();
  }
  if (P.selPts) {
    pcx.save();
    pcx.setLineDash([3, 3]);
    pcx.strokeStyle = '#ffb547';
    pcx.lineWidth = 1.5;
    if (P.tool === 'select') {
      const [a, b] = [P.selPts[0], P.selPts[P.selPts.length - 1]];
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      pcx.strokeRect(x * z + 0.5, y * z + 0.5, (Math.abs(a.x - b.x) + 1) * z - 1, (Math.abs(a.y - b.y) + 1) * z - 1);
    } else {
      pcx.beginPath();
      P.selPts.forEach((q, i) => (i ? pcx.lineTo : pcx.moveTo).call(pcx, (q.x + 0.5) * z, (q.y + 0.5) * z));
      pcx.stroke();
    }
    pcx.restore();
  }
}

// ---------- drawing primitives ----------
const paintStyle = () => {
  const [r, g, b] = hexRgb(P.color);
  return `rgba(${r},${g},${b},${Math.round(P.alpha * 255) / 255})`;
};

// The square a dab covers: the brush size, or for the blur brush a wider one
// (3, 5 or 7 across), since a pixel alone has nothing to soften against.
const brushSize = () => (P.tool === 'blur' ? P.size * 2 + 1 : P.size);

function dab(x, y) {
  if (P.tool === 'blur') {
    const s = brushSize(), o = Math.floor((s - 1) / 2);
    blurAt(x - o, y - o, s);
    if (P.mirror) blurAt(P.obj.fw - (x - o) - s, y - o, s);
    return;
  }
  const o = Math.floor((P.size - 1) / 2), top = y - o;
  // pixels are replaced, never blended: a 50% pixel stays 50% even when drawn twice
  const put = l => {
    P.w.clearRect(l, top, P.size, P.size);
    if (!P.erase && P.alpha > 0) { P.w.fillStyle = paintStyle(); P.w.fillRect(l, top, P.size, P.size); }
  };
  put(x - o);
  if (P.mirror) put(P.obj.fw - (x - o) - P.size);
}

// Softens a square of the frame: each pixel becomes a weighted average of
// itself and its eight neighbours in the frame — itself counting most
// (BLUR_WEIGHTS), so a pass is gentle — colour and alpha together, the
// colour weighted by alpha, so an edge fades out rather than darkening
// towards the empty pixels around it. A pixel is softened once a stroke
// however often the brush passes over it (P.blurred), so a stroke is one
// even pass and another stroke softens more.
const BLUR_WEIGHTS = [1, 2, 1, 2, 8, 2, 1, 2, 1];   // the 3x3 round a pixel, row by row

function blurAt(left, top, s) {
  const W = P.obj.fw, H = P.obj.fh;
  const x0 = Math.max(0, left), y0 = Math.max(0, top);
  const x1 = Math.min(W - 1, left + s - 1), y1 = Math.min(H - 1, top + s - 1);
  if (x1 < x0 || y1 < y0) return;
  // the square and a pixel round it, for the neighbours
  const rx = Math.max(0, x0 - 1), ry = Math.max(0, y0 - 1);
  const rw = Math.min(W - 1, x1 + 1) - rx + 1, rh = Math.min(H - 1, y1 + 1) - ry + 1;
  const src = P.w.getImageData(rx, ry, rw, rh).data;
  const out = P.w.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  const d = out.data, ow = x1 - x0 + 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (P.blurred) {
        if (P.blurred.has(y * W + x)) continue;
        P.blurred.add(y * W + x);
      }
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = x + dx - rx, sy = y + dy - ry;
          if (x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H) continue;
          const w = BLUR_WEIGHTS[(dy + 1) * 3 + dx + 1];
          const i = (sy * rw + sx) * 4, al = src[i + 3] * w;
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; n += w;
        }
      }
      const j = ((y - y0) * ow + (x - x0)) * 4;
      d[j + 3] = Math.round(a / n);
      if (a) { d[j] = Math.round(r / a); d[j + 1] = Math.round(g / a); d[j + 2] = Math.round(b / a); }
    }
  }
  P.w.putImageData(out, x0, y0);
}

function linePx(x0, y0, x1, y1, cb) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}

function shape(p, filled) {
  P.w.putImageData(P.snap, 0, 0);
  const a = P.start;
  if (P.tool === 'line') { linePx(a.x, a.y, p.x, p.y, dab); return; }
  const x0 = Math.min(a.x, p.x), x1 = Math.max(a.x, p.x);
  const y0 = Math.min(a.y, p.y), y1 = Math.max(a.y, p.y);
  if (P.tool === 'ellipse') { ellipsePx(x0, y0, x1, y1, filled, dab); return; }
  if (filled) { for (let y = y0; y <= y1; y++) linePx(x0, y, x1, y, dab); }
  else {
    linePx(x0, y0, x1, y0, dab); linePx(x1, y0, x1, y1, dab);
    linePx(x1, y1, x0, y1, dab); linePx(x0, y1, x0, y0, dab);
  }
}

// The ellipse that fits the box x0..x1, y0..y1: every pixel whose centre is
// inside it, or for the outline only those with a neighbour outside, so the
// ring is one pixel thick and closed at any size.
function ellipsePx(x0, y0, x1, y1, filled, cb) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) cb(x, y);
    }
  }
}

// The Outline tool: a click takes the area Fill would — every pixel joined
// to it, side on, of exactly its colour — and paints only that area's edge,
// the pixels of it that touch something else, as thick as the brush size, in
// the colour picked (a right-click clears it instead). Clicking the empty
// space round the art strokes the art's outside, holes it closes round left
// alone; clicking inside a shape gives it a rim. The frame's own border is
// not an edge, so the empty space doesn't get a box round it.
function outlineAt(x, y) {
  const W = P.obj.fw, H = P.obj.fh;
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const id = P.w.getImageData(0, 0, W, H), d = id.data;
  const i0 = (y * W + x) * 4;
  const t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const a = Math.round(P.alpha * 255);
  const c = (P.erase || !a) ? [0, 0, 0, 0] : [...hexRgb(P.color), a];
  // the area, as Fill finds it
  const inArea = new Uint8Array(W * H);
  const same = k => d[k * 4] === t[0] && d[k * 4 + 1] === t[1] && d[k * 4 + 2] === t[2] && d[k * 4 + 3] === t[3];
  const st = [y * W + x];
  while (st.length) {
    const k = st.pop();
    if (inArea[k] || !same(k)) continue;
    inArea[k] = 1;
    const cx = k % W, cy = (k - cx) / W;
    if (cx > 0) st.push(k - 1);
    if (cx < W - 1) st.push(k + 1);
    if (cy > 0) st.push(k - W);
    if (cy < H - 1) st.push(k + W);
  }
  // its edge, peeled a ring at a time for each pixel of brush size
  let painted = 0;
  for (let pass = 0; pass < P.size; pass++) {
    const edge = [];
    for (let k = 0; k < W * H; k++) {
      if (!inArea[k]) continue;
      const cx = k % W, cy = (k - cx) / W;
      if ((cx > 0 && !inArea[k - 1]) || (cx < W - 1 && !inArea[k + 1]) ||
          (cy > 0 && !inArea[k - W]) || (cy < H - 1 && !inArea[k + W])) edge.push(k);
    }
    if (!edge.length) break;
    for (const k of edge) {
      inArea[k] = 0;
      for (let n = 0; n < 4; n++) d[k * 4 + n] = c[n];
    }
    painted += edge.length;
  }
  if (!painted) { paintMsg('That area touches nothing else — there is no edge to outline'); return false; }
  P.w.putImageData(id, 0, 0);
  return true;
}

function flood(x, y) {
  const W = P.obj.fw, H = P.obj.fh;
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const id = P.w.getImageData(0, 0, W, H), d = id.data;
  const i0 = (y * W + x) * 4;
  const t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const a = Math.round(P.alpha * 255);
  const c = (P.erase || !a) ? [0, 0, 0, 0] : [...hexRgb(P.color), a];
  if (t.every((v, k) => v === c[k])) return false;
  const same = i => d[i] === t[0] && d[i + 1] === t[1] && d[i + 2] === t[2] && d[i + 3] === t[3];
  const st = [x, y];
  while (st.length) {
    const cy = st.pop(), cx = st.pop();
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const i = (cy * W + cx) * 4;
    if (!same(i)) continue;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
    st.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }
  P.w.putImageData(id, 0, 0);
  return true;
}

function pickAt(p) {
  if (p.x < 0 || p.y < 0 || p.x >= P.obj.fw || p.y >= P.obj.fh) return;
  const d = P.w.getImageData(p.x, p.y, 1, 1).data;
  if (d[3]) { setColor(rgbHex(d[0], d[1], d[2])); setAlpha(Math.round(d[3] / 255 * 20) / 20); }
  else setAlpha(0);
}

const snapshot = () => P.w.getImageData(0, 0, P.obj.fw, P.obj.fh);
function pushUndo() { P.undo.push(snapshot()); if (P.undo.length > 80) P.undo.shift(); P.redo = []; }
function undo() { if (!P.undo.length) return; P.float = null; P.sel = null; P.redo.push(snapshot()); P.w.putImageData(P.undo.pop(), 0, 0); commitPaint(); drawPaint(); }
function redo() { if (!P.redo.length) return; P.float = null; P.sel = null; P.undo.push(snapshot()); P.w.putImageData(P.redo.pop(), 0, 0); commitPaint(); drawPaint(); }
function transform(fn) {
  pushUndo();
  const t = cloneCanvas(P.work);
  P.w.clearRect(0, 0, P.obj.fw, P.obj.fh);
  P.w.save(); fn(t); P.w.restore();
  commitPaint(); drawPaint();
}

// ---------- paint UI ----------
function setTool(t) {
  // a floating piece is set down; the selection stays, for Fill and Clear
  if (t !== 'select' && t !== 'lasso') dropFloat();
  P.tool = t;
  $$('.tool').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  drawPaint();
}
function setColor(h) {
  P.color = h;
  $('#ptColor').value = h;
  $('#ptHex').textContent = h;
  $$('#ptPal button').forEach(b => b.classList.toggle('on', b.dataset.c === h));
  if (P.tool === 'eraser' || P.tool === 'picker') setTool('pencil');
}
function setAlpha(a) {
  P.alpha = a;
  $('#ptAlpha').value = Math.round(a * 100);
  $('#ptAlphaV').textContent = Math.round(a * 100) + '%';
  $('#ptTransp').classList.toggle('on', a === 0);
  if (P.tool === 'eraser' || P.tool === 'picker') setTool('pencil');
}
function setSize(s) { P.size = s; $$('#ptSize .btn').forEach(b => b.classList.toggle('on', +b.dataset.s === s)); }

$('#ptTools').innerHTML = TOOLS.map(([t, ic, name, k]) =>
  `<button class="tool" data-t="${t}" title="${name} (${k})"><b>${ic}</b>${name}<span class="mono">${k}</span></button>`).join('');
$('#ptPal').innerHTML = PAL.map(c => `<button data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
$('#ptTools').onclick = e => { const b = e.target.closest('.tool'); if (b) setTool(b.dataset.t); };
$('#ptPal').onclick = e => { const b = e.target.closest('button'); if (b) { setColor(b.dataset.c); if (!P.alpha) setAlpha(1); } };
$('#ptColor').oninput = e => { setColor(e.target.value); if (!P.alpha) setAlpha(1); };
$('#ptAlpha').oninput = e => setAlpha(+e.target.value / 100);
$('#ptTransp').onclick = () => setAlpha(P.alpha === 0 ? 1 : 0);
$('#ptSize').onclick = e => { const b = e.target.closest('[data-s]'); if (b) setSize(+b.dataset.s); };
$('#ptMirror').onchange = e => { P.mirror = e.target.checked; drawPaint(); };
$('#ptGrid').onchange = e => { P.grid = e.target.checked; drawPaint(); };
$('#onOn').onchange = e => { P.onion = e.target.checked; buildOnion(); drawPaint(); };
$('#onPrev').onchange = e => { P.onionPrev = +e.target.value; buildOnion(); drawPaint(); };
$('#onNext').onchange = e => { P.onionNext = e.target.checked; buildOnion(); drawPaint(); };
$('#onOp').oninput = e => { P.onionOp = e.target.value / 100; buildOnion(); drawPaint(); };
$('#opUndo').onclick = undo;
$('#opRedo').onclick = redo;
$('#opFh').onclick = () => transform(t => { P.w.translate(P.obj.fw, 0); P.w.scale(-1, 1); P.w.drawImage(t, 0, 0); });
$('#opFv').onclick = () => transform(t => { P.w.translate(0, P.obj.fh); P.w.scale(1, -1); P.w.drawImage(t, 0, 0); });
$('#opClear').onclick = () => {
  if (P.float) { deleteSelection(); return; }
  if (P.sel) { fillSelection(true); return; }       // just the selected pixels
  transform(() => {});
};

// A quarter turn, pixel for pixel, about the frame's middle: a square frame
// turns exactly; in a wider or taller one the turned art is centred and what
// would fall outside the frame is cut off. dir is 1 for right, -1 for left.
function rotateFrame(dir) {
  const W = P.obj.fw, H = P.obj.fh;
  const src = P.w.getImageData(0, 0, W, H), out = P.w.createImageData(W, H);
  const ox = Math.floor((W - H) / 2), oy = Math.floor((H - W) / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (dir > 0 ? H - 1 - y : y) + ox;
      const ny = (dir > 0 ? x : W - 1 - x) + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = (y * W + x) * 4, j = (ny * W + nx) * 4;
      for (let k = 0; k < 4; k++) out.data[j + k] = src.data[i + k];
    }
  }
  pushUndo();
  P.w.putImageData(out, 0, 0);
  commitPaint();
  drawPaint();
  if (W !== H) paintMsg(`Turned in a ${W}×${H} frame — what fell outside it is cut off (Ctrl+Z brings it back)`);
}
$('#opRotL').onclick = () => rotateFrame(-1);
$('#opRotR').onclick = () => rotateFrame(1);

// ---------- copy and paste ----------
// A whole image, kept here rather than on the system clipboard so it keeps its
// transparency and works in any browser: copy one frame, open another — an
// object's, a tile or a background — and paste. The same size lands pixel for
// pixel; another size is centred, never scaled, so the art stays crisp.
let pixelClip = null;
let msgTimer = 0;

// The dialog sits above the page's toasts, so it says things in its own header.
function paintMsg(text) {
  $('#ptMsg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('#ptMsg').textContent = ''; }, 2500);
}

function copyPixels() {
  pixelClip = cloneCanvas(P.work);
  $('#opPaste').disabled = false;
  paintMsg(`Copied ${pixelClip.width}×${pixelClip.height}`);
  copyToSystem(pixelClip);
}

// The system clipboard too, as a PNG: so a frame pastes into other programs,
// and so what Ctrl+V finds there is always the last thing copied, here or
// anywhere else. Where the browser won't allow it, the copy stays here alone.
function copyToSystem(canvas) {
  if (!navigator.clipboard || !window.ClipboardItem) return;
  canvas.toBlob(blob => {
    if (blob) navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
  }, 'image/png');
}

// An image from outside — another program, a web page — onto the frame: as
// it is and centred if it fits, scaled down to fit (keeping its shape) if
// not. It becomes the copy here too, so it can be pasted again.
async function pasteImage(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { paintMsg('The clipboard holds an image this browser cannot read'); return; }
  // our own selection copy, back from the system clipboard: float it in
  if (pixelClip && pixelClip.selFrom && bmp.width === pixelClip.width && bmp.height === pixelClip.height) { pastePixels(); return; }
  const { fw, fh } = P.obj;
  const k = Math.min(1, fw / bmp.width, fh / bmp.height);
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = blankCanvas(w, h);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = k < 1;
  g.drawImage(bmp, 0, 0, w, h);
  pixelClip = c;
  $('#opPaste').disabled = false;
  const x = Math.round((fw - w) / 2), y = Math.round((fh - h) / 2);
  transform(() => P.w.drawImage(c, x, y));
  paintMsg(k < 1
    ? `Pasted a ${bmp.width}×${bmp.height} image, scaled to ${w}×${h} to fit`
    : `Pasted a ${bmp.width}×${bmp.height} image${w === fw && h === fh ? '' : ', centred'}`);
}

// What Ctrl+V brings: the browser hands over the clipboard with the paste, so
// an image there — from here or anywhere — is what goes in; without one, the
// copy made here.
document.addEventListener('paste', e => {
  if (!$('#paint').open || (e.target.matches && e.target.matches('input,select,textarea'))) return;
  e.preventDefault();
  const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
  if (item) pasteImage(item.getAsFile());
  else pastePixels();
});

// The Paste button asks for the clipboard itself (the browser may ask first).
async function pasteFromButton() {
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) { await pasteImage(await item.getType(type)); return; }
      }
    }
  } catch { /* not allowed, or nothing there: the copy made here */ }
  pastePixels();
}

function pastePixels() {
  if (!pixelClip) { paintMsg('Copy a frame first — or an image, anywhere'); return; }
  if (pixelClip.selFrom) {
    const { fw, fh } = P.obj;
    // where it was taken from, kept on the frame if this one is smaller
    const x = Math.max(0, Math.min(fw - 1, pixelClip.selFrom.x)), y = Math.max(0, Math.min(fh - 1, pixelClip.selFrom.y));
    if (!isSelectTool()) setTool('select');
    floatPiece(cloneCanvas(pixelClip), x, y);
    paintMsg('Pasted — drag it into place, then Enter or click outside it to set it down');
    return;
  }
  const { fw, fh } = P.obj;
  const x = Math.round((fw - pixelClip.width) / 2), y = Math.round((fh - pixelClip.height) / 2);
  transform(() => P.w.drawImage(pixelClip, x, y));
  paintMsg(pixelClip.width === fw && pixelClip.height === fh
    ? 'Pasted'
    : `Pasted ${pixelClip.width}×${pixelClip.height} into ${fw}×${fh}, centred`);
}

$('#opCopy').onclick = copyPixels;
$('#opPaste').onclick = pasteFromButton;
$$('[data-shift]').forEach(b => b.onclick = () => {
  const [dx, dy] = b.dataset.shift.split(',').map(Number);
  transform(t => {
    P.w.drawImage(t, dx, dy);
    if (dx) P.w.drawImage(t, dx - Math.sign(dx) * P.obj.fw, 0);
    if (dy) P.w.drawImage(t, 0, dy - Math.sign(dy) * P.obj.fh);
  });
});

const navFrame = d => {
  const L = framesOfPart(P.obj, P.f.partId);
  const i = L.indexOf(P.f);
  if (L[i + d]) goFrame(L[i + d]);
};
$('#ptPrev').onclick = () => navFrame(-1);
$('#ptNext').onclick = () => navFrame(1);
$('#ptNew').onclick = () => { flushPaint(); const f = insertFrame(P.obj, P.f.partId, P.f.id, blankCanvas(P.obj.fw, P.obj.fh)); renderObjectFrames(); loadPaint(f); };
$('#ptCopy').onclick = () => { flushPaint(); const f = insertFrame(P.obj, P.f.partId, P.f.id, P.work); renderObjectFrames(); loadPaint(f); };

// Deleting a frame is one click away from losing work, so it asks twice.
let delArm = 0;
function disarmDel() {
  clearTimeout(delArm);
  delArm = 0;
  const b = $('#ptDel');
  if (b) { b.textContent = '🗑 Delete frame'; b.classList.remove('primary'); }
}
function deletePaintFrame() {
  const b = $('#ptDel');
  if (!delArm) { b.textContent = 'Click again to delete'; b.classList.add('primary'); delArm = setTimeout(disarmDel, 2500); return; }
  disarmDel();
  clearTimeout(P.timer);
  P.dirty = false;
  const o = P.obj, f = P.f;
  const L = framesOfPart(o, f.partId);
  const next = L[L.indexOf(f) - 1] || L[L.indexOf(f) + 1];
  o.frames = o.frames.filter(x => x.id !== f.id);
  dropFrameCanvas(f.id);
  renderObjectFrames();
  savePack();
  if (next) loadPaint(next); else { P.f = null; $('#paint').close(); }
}
$('#ptDel').onclick = deletePaintFrame;
$('#ptZin').onclick = () => { P.z = Math.min(64, P.z + 2); drawPaint(); };
$('#ptZout').onclick = () => { P.z = Math.max(1, P.z - 2); drawPaint(); };
$('#ptZfit').onclick = fitZoom;
$('#ptDone').onclick = () => $('#paint').close();
$('#paint').addEventListener('close', () => { flushPaint(); cancelAnimationFrame(P.raf); P.f = null; renderObjects(); });

const toPx = e => {
  const r = pc.getBoundingClientRect();
  return { x: Math.floor((e.clientX - r.left) / r.width * P.obj.fw), y: Math.floor((e.clientY - r.top) / r.height * P.obj.fh) };
};
pc.addEventListener('pointerdown', e => {
  e.preventDefault();
  pc.setPointerCapture(e.pointerId);
  const p = toPx(e);
  P.erase = P.tool === 'eraser' || e.button === 2;
  if (isSelectTool() && e.button === 0) { selectDown(p); return; }
  if (P.tool === 'picker' || e.altKey) { pickAt(p); return; }
  if (P.tool === 'fill' && P.sel) { fillSelection(P.erase); return; }
  if (P.tool === 'fill') { pushUndo(); if (flood(p.x, p.y)) commitPaint(); else P.undo.pop(); drawPaint(); return; }
  if (P.tool === 'outline') { pushUndo(); if (outlineAt(p.x, p.y)) commitPaint(); else P.undo.pop(); drawPaint(); return; }
  pushUndo();
  P.drawing = true; P.start = p; P.last = p;
  P.blurred = new Set();      // what this stroke has softened already
  if (['line', 'rect', 'ellipse'].includes(P.tool)) { P.snap = snapshot(); shape(p, e.shiftKey); } else dab(p.x, p.y);
  drawPaint();
});
pc.addEventListener('pointermove', e => {
  const p = toPx(e);
  P.hover = p;
  if (P.moving || P.selPts) { selectMove(p); return; }
  if (P.drawing) {
    if (['line', 'rect', 'ellipse'].includes(P.tool)) shape(p, e.shiftKey);
    else { linePx(P.last.x, P.last.y, p.x, p.y, dab); P.last = p; }
  }
  drawPaint();
});
const endStroke = () => {
  if (P.moving || P.selPts) { selectUp(); return; }
  if (P.drawing) { P.drawing = false; commitPaint(); drawPaint(); }
};
pc.addEventListener('pointerup', endStroke);
pc.addEventListener('pointercancel', endStroke);
pc.addEventListener('pointerleave', () => { if (!P.drawing) { P.hover = null; drawPaint(); } });
pc.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (!$('#paint').open || e.target.matches('input,select,textarea')) return;
  const c = e.code || (e.key && e.key.length === 1 ? 'Key' + e.key.toUpperCase() : '');   // by the key's place, whatever the keyboard's language
  if (e.ctrlKey || e.metaKey) {
    if (c === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (c === 'KeyY') { e.preventDefault(); redo(); }
    else if (c === 'KeyC') { e.preventDefault(); if (!copySelection(false)) copyPixels(); }
    else if (c === 'KeyX') { e.preventDefault(); if (!copySelection(true)) paintMsg('Select part of the frame first — Select (S) or Lasso (A)'); }
    // Ctrl+V is left to the browser, which fires 'paste' with the clipboard
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && (P.sel || P.float)) { e.preventDefault(); deleteSelection(); return; }
  if (e.key === 'Enter' && P.float) { e.preventDefault(); dropFloat(); return; }
  if (e.key === 'Escape' && (P.sel || P.float)) { e.preventDefault(); e.stopPropagation(); dropFloat(); P.sel = null; drawPaint(); return; }
  const tk = { KeyB: 'pencil', KeyE: 'eraser', KeyG: 'fill', KeyI: 'picker', KeyL: 'line', KeyR: 'rect', KeyC: 'ellipse', KeyU: 'blur', KeyT: 'outline', KeyS: 'select', KeyA: 'lasso' }[c];
  if (tk) { setTool(tk); return; }
  if (c === 'KeyM') $('#ptMirror').click();
  else if (c === 'KeyO') $('#onOn').click();
  else if (c === 'BracketLeft' || c === 'Comma') navFrame(-1);
  else if (c === 'BracketRight' || c === 'Period') navFrame(1);
  else if (c === 'Equal' || c === 'NumpadAdd') $('#ptZin').click();
  else if (c === 'Minus' || c === 'NumpadSubtract') $('#ptZout').click();
});

// The part playing in the corner, so a change can be judged in motion.
function startMini() {
  cancelAnimationFrame(P.raf);
  P.mlast = 0; P.macc = 0;
  const m = $('#pmini');
  const loop = t => {
    if (!$('#paint').open || !P.f) return;
    const o = P.obj;
    const L = framesOfPart(o, P.f.partId);
    const z = Math.max(1, Math.floor(120 / Math.max(o.fw, o.fh)));
    if (m.width !== o.fw * z) { m.width = o.fw * z; m.height = o.fh * z; }
    const g = m.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, m.width, m.height);
    if (L.length) {
      const dt = P.mlast ? (t - P.mlast) / 1000 : 0;
      P.mlast = t;
      P.macc += dt;
      if (P.macc >= 1 / (o.fps || 8)) { P.macc = 0; P.mi = (P.mi + 1) % L.length; }
      const fr = L[P.mi % L.length];
      g.drawImage(fr.id === P.f.id ? P.work : frameCanvas(o, fr), 0, 0, m.width, m.height);
    }
    P.raf = requestAnimationFrame(loop);
  };
  P.raf = requestAnimationFrame(loop);
}

setTool('pencil');
setColor(P.color);
setAlpha(1);
setSize(1);
