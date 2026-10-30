// ---------- the terrain sheet ----------
// The sheet is a grid of tiles: a row per kind of tile, a column per tint. A
// row is named by two characters — the 1# of a 1#1 block — and says what it
// collides as; the third character of a block is the column, always 0 to 9.
// The names are fixed by the row's place on the sheet, so only the collision
// is chosen here, with the button beside each row. They are kept as the
// strings a level pack carries (row_0, row_1, row_C).

const TILE_COLUMNS = '0123456789';

// Every row's name, in order: the twenty the game has always had — 0# to 9#,
// the four ramps 0/ to 3/, then T U * o $ ~ — and after those a digit on each
// of T U * o $ ~ again, since the game draws only those glyphs from the sheet.
const TILE_ROW_NAMES = (() => {
  const names = [];
  for (const d of '0123456789') names.push(d + '#');
  for (const d of '0123') names.push(d + '/');
  for (const g of 'TU*o$~') names.push(' ' + g);
  for (const g of 'TU*o$~') for (const d of '123456789') names.push(d + g);
  return names;
})();
const TILE_MAX_ROWS = TILE_ROW_NAMES.length;

// What a row can collide as, by the character the game reads: the mark on
// its button, and the word.
const TILE_HITS = [
  [' ', '·', 'None'], ['S', '■', 'Solid'], ['^', '▀', 'Top half'],
  ['0', '◢', 'Ramp up'], ['1', '◣', 'Ramp down'], ['2', '◥', 'Ceiling, right'], ['3', '◤', 'Ceiling, left']
];
const hitOf = ch => TILE_HITS.find(h => h[0] === ch) || TILE_HITS[0];

// Where things sit on the sheet, as src/js/tileset.js reads it: every cell is
// the tile plus a margin of an eighth of a tile each side, and only the tile
// is ever drawn. A sheet from before carries one more cell of labels down the
// left and across the top; it is told by its width.
function sheetGeom(size, w, h) {
  const cell = size * 1.25, inset = size / 8;
  const gutter = Math.round(w / cell) > TILE_COLUMNS.length ? cell : 0;
  return {
    size, cell, gutter,
    cols: Math.max(0, Math.floor((w - gutter) / cell)),
    rows: Math.max(0, Math.floor((h - gutter) / cell)),
    at: (r, c) => ({ x: gutter + c * cell + inset, y: gutter + r * cell + inset })
  };
}

// A sheet with the old label cells has them cut off, once. True if it had.
async function migrateTileSheet(p) {
  const t = p.tiles;
  t.col_0 = TILE_COLUMNS;
  if (!t.src) return false;
  const img = await loadImg(t.src).catch(() => null);
  if (!img) return false;
  const G = sheetGeom(t.size, img.naturalWidth, img.naturalHeight);
  if (!G.gutter) return false;
  const c = blankCanvas(img.naturalWidth - G.gutter, img.naturalHeight - G.gutter);
  c.getContext('2d').drawImage(img, -G.gutter, -G.gutter);
  t.src = c.toDataURL('image/png');
  return true;
}

// The row strings fitted to the sheet's rows: the names are the fixed ones,
// and a row new to the sheet collides as nothing until one is chosen.
function fitRows(n) {
  const t = pack.tiles;
  n = Math.min(n, TILE_MAX_ROWS);
  const fit = (s, pad) => (s || '').padEnd(n, pad).slice(0, n);
  const names = TILE_ROW_NAMES.slice(0, n);
  t.row_0 = names.map(s => s[0]).join('');
  t.row_1 = names.map(s => s[1]).join('');
  t.row_C = fit(t.row_C, ' ');
  t.row_D = fit(t.row_D, 'T');
}

const setAt = (s, i, ch) => s.slice(0, i) + ch + s.slice(i + 1);

// What a map block calls the tile at (row, column), e.g. 1#1.
const tileName = (r, c) => {
  const t = pack.tiles, ch = s => (s && s !== ' ' ? s : '·');
  return ch(t.row_0[r]) + ch(t.row_1[r]) + (c === undefined ? '' : TILE_COLUMNS[c] || '·');
};

let tilesImg = null;               // the sheet as last drawn, for the hover box
let tilesHot = null;               // {r, c} under the pointer

function drawSheet() {
  const cv = $('#tilesCv');
  if (!tilesImg) { cv.width = cv.height = 1; return; }
  const w = tilesImg.naturalWidth || tilesImg.width, h = tilesImg.naturalHeight || tilesImg.height;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.drawImage(tilesImg, 0, 0);
  if (tilesHot) {
    const G = sheetGeom(pack.tiles.size, w, h), p = G.at(tilesHot.r, tilesHot.c);
    g.strokeStyle = '#ffb547';
    g.lineWidth = Math.max(2, G.size / 24);
    g.strokeRect(p.x, p.y, G.size, G.size);
  }
}

function renderTiles() {
  const t = pack.tiles;
  const cv = $('#tilesCv');
  cv.classList.toggle('pickable', !!t.src);
  if (t.src) {
    loadImg(t.src).then(img => {
      tilesImg = img;
      drawSheet();
      const G = sheetGeom(t.size, img.naturalWidth, img.naturalHeight);
      $('#tilesDims').textContent = `${img.naturalWidth}×${img.naturalHeight} · tile ${t.size}px · ${G.rows} rows × ${G.cols} columns`;
      renderTileRows(G.rows, G);
    }).catch(() => { $('#tilesDims').textContent = 'That sheet could not be read'; });
  } else {
    tilesImg = null;
    drawSheet();
    $('#tilesDims').textContent = 'No sheet loaded — load one, or start a new one to draw.';
    renderTileRows(0);
  }
}

// The left edge of the sheet: a line per row, as tall as its cells, with its
// fixed name and a button for what it collides as. The tile size is the
// only other thing set here.
function renderTileRows(n, G) {
  const t = pack.tiles;
  if (n) fitRows(n);
  n = Math.min(n, TILE_MAX_ROWS);
  const el = $('#tilesRows');
  el.style.paddingTop = G ? G.gutter + 'px' : '0';
  el.innerHTML = n && G ? [...Array(n).keys()].map(r => {
    const [, mark, word] = hitOf(t.row_C[r]);
    return `<div class="srow" style="height:${G.cell}px">
      <span class="mono">${esc(TILE_ROW_NAMES[r].trim())}</span>
      <button class="btn sm hitbtn" data-hit="${r}" title="Row ${TILE_ROW_NAMES[r].trim()} collides as ${word} — click to change"><b>${mark}</b> ${word}</button>
    </div>`;
  }).join('') : '';
  $('#tilesProps').innerHTML = `
    <label class="ctl"><div class="row"><span>Tile size</span><output>${t.size}px</output></div>
      <input type="range" data-t="size" min="8" max="128" step="8" value="${t.size}"></label>`;
}

// A row's button opens the choices beside it; picking one sets the row.
let hitMenu = null;
function closeHitMenu() { if (hitMenu) { hitMenu.remove(); hitMenu = null; } }
$('#tilesRows').addEventListener('click', e => {
  const b = e.target.closest('[data-hit]');
  if (!b) return;
  e.stopPropagation();
  const r = +b.dataset.hit, again = hitMenu && hitMenu.dataset.r === String(r);
  closeHitMenu();
  if (again) return;
  const cur = pack.tiles.row_C[r];
  hitMenu = document.createElement('div');
  hitMenu.className = 'hitmenu';
  hitMenu.dataset.r = r;
  hitMenu.innerHTML = TILE_HITS.map(([v, mark, word]) =>
    `<button class="${v === cur ? 'on' : ''}" data-v="${v === ' ' ? '_' : v}"><b>${mark}</b> ${word}</button>`).join('');
  document.body.appendChild(hitMenu);
  const box = b.getBoundingClientRect(), h = hitMenu.offsetHeight;
  hitMenu.style.left = box.left + 'px';
  hitMenu.style.top = Math.max(4, Math.min(box.bottom + 2, innerHeight - h - 4)) + 'px';
  hitMenu.addEventListener('click', ev => {
    const o = ev.target.closest('[data-v]');
    if (!o) return;
    ev.stopPropagation();
    const v = o.dataset.v === '_' ? ' ' : o.dataset.v;
    closeHitMenu();
    if (v === pack.tiles.row_C[r]) return;
    markUndo();
    pack.tiles.row_C = setAt(pack.tiles.row_C, r, v);
    savePack();
    const [, mark, word] = hitOf(v);
    b.innerHTML = `<b>${mark}</b> ${word}`;
    b.title = `Row ${TILE_ROW_NAMES[r].trim()} collides as ${word} — click to change`;
  });
});
document.addEventListener('click', closeHitMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHitMenu(); });
$('#tilesWrap').addEventListener('scroll', closeHitMenu);

$('#tilesProps').addEventListener('input', e => {
  const t = pack.tiles;
  if (e.target.dataset.t === 'size') {
    markUndo();
    t.size = +e.target.value;
    e.target.parentElement.querySelector('output').textContent = t.size + 'px';
    savePack();
  }
});
// a size change moves where every tile is, so the rows and sheet are redrawn
$('#tilesProps').addEventListener('change', e => { if (e.target.dataset.t === 'size') renderTiles(); });

$('#tilesLoad').onclick = async () => {
  const [file] = await pickFiles('image/png,image/*');
  if (!file) return;
  const src = await pngURL(file);
  markUndo();
  pack.tiles.src = src;
  renderTiles();
  savePack();
  toast('Sheet loaded');
};

// ---------- painting tiles ----------
function tileAt(e) {
  if (!tilesImg) return null;
  const cv = $('#tilesCv'), b = cv.getBoundingClientRect();
  const x = (e.clientX - b.left) * cv.width / b.width, y = (e.clientY - b.top) * cv.height / b.height;
  const G = sheetGeom(pack.tiles.size, cv.width, cv.height);
  const c = Math.floor((x - G.gutter) / G.cell), r = Math.floor((y - G.gutter) / G.cell);
  return r >= 0 && c >= 0 && r < G.rows && c < G.cols ? { r, c } : null;
}

const HIT_WORDS = { S: 'solid', '^': 'top half', ' ': 'passes through', 0: 'ramp', 1: 'ramp', 2: 'ramp', 3: 'ramp' };

$('#tilesCv').addEventListener('mousemove', e => {
  const hot = tileAt(e);
  if (hot?.r === tilesHot?.r && hot?.c === tilesHot?.c) return;
  tilesHot = hot;
  drawSheet();
  const hit = hot && (pack.tiles.row_C[hot.r] ?? ' ');
  $('#tilesHover').textContent = hot ? `${tileName(hot.r, hot.c)} · row ${hot.r + 1}, column ${hot.c + 1} · ${HIT_WORDS[hit] || hit}` : '';
});
$('#tilesCv').addEventListener('mouseleave', () => { tilesHot = null; drawSheet(); $('#tilesHover').textContent = ''; });
$('#tilesCv').addEventListener('click', e => {
  const hot = tileAt(e);
  if (hot) editTile(hot.r, hot.c).catch(err => toast(err.message, true));
});

// A tile opens in the pixel editor alone, as a one-frame stand-in object —
// a tile is a still picture, so there is nothing to step through or play —
// and every settled stroke goes straight back into its cell on the sheet.
async function editTile(r, c) {
  const t = pack.tiles;
  const img = await loadImg(t.src);
  const G = sheetGeom(t.size, img.naturalWidth, img.naturalHeight);
  const sheet = blankCanvas(img.naturalWidth, img.naturalHeight);
  const sg = sheet.getContext('2d');
  sg.drawImage(img, 0, 0);
  const p = G.at(r, c);
  const tc = blankCanvas(G.size, G.size);
  tc.getContext('2d').drawImage(sheet, p.x, p.y, G.size, G.size, 0, 0, G.size, G.size);
  const part = { id: 'tile', name: `tile ${tileName(r, c)}`, color: '#ffffff' };
  const f = { id: `tile-${r}-${c}`, src: tc.toDataURL(), partId: part.id };
  fcan.set(f.id, tc);
  const stand = { name: 'Tiles', fw: G.size, fh: G.size, frames: [f], parts: [part] };
  openPaint(stand, f, {
    single: true,
    onSave: g => {
      sg.clearRect(p.x, p.y, G.size, G.size);
      sg.drawImage(frameCanvas(stand, g), p.x, p.y);
      t.src = sheet.toDataURL('image/png');
      tilesImg = sheet;
      drawSheet();
    }
  });
}

// A blank sheet laid out from the labels: a row per row glyph, a column per
// tint name, and the labels themselves written in the gutter to read it by.
$('#tilesNew').onclick = async () => {
  const t = pack.tiles;
  const got = await ask('Start a new terrain sheet', [
    { key: 'rows', label: 'Rows — one per kind of tile', type: 'number', value: t.row_1.length || 20 },
    { type: 'note', label: `Each row has 10 columns, 0 to 9, at ${t.size}px a tile. The rows are named in order — 0# to 9#, 0/ to 3/, then T U * o $ ~ — and the button beside each says what it collides as.` },
    ...(t.src ? [{ type: 'note', label: 'This replaces the sheet that is loaded now. Ctrl+Z brings it back.' }] : [])
  ], 'Make it');
  if (!got) return;
  const rows = parseInt(got.rows, 10);
  if (!(rows >= 1 && rows <= TILE_MAX_ROWS)) { toast(`Pick from 1 to ${TILE_MAX_ROWS} rows`, true); return; }
  const cell = t.size * 1.25;
  const sheet = blankCanvas(cell * TILE_COLUMNS.length, cell * rows);
  markUndo();
  t.src = sheet.toDataURL('image/png');
  fitRows(rows);
  renderTiles();
  savePack();
  toast('New sheet — click a tile to paint it');
};

// ---------- copy and paste ----------
// Over a tile, Ctrl+C copies it and Ctrl+V pastes onto the tile under the
// pointer. Ctrl+Shift+V is the smart paste: it fills the whole row, column 0
// as copied and every other column recoloured to its own colour, the way
// tools/gen/tiles.ps1 makes them. The copy is the same one the pixel editor
// uses, so a tile can go into a sprite and a frame into a tile.

// Each column's colour; column 0 is the art's own.
const TILE_TINTS = [null, '#8a5a35', '#8a8a92', '#d1452f', '#e08a2e', '#e0c92e', '#2ec4c4', '#3a7fd1', '#8a4fd1', '#d14f9e'];
const TINT_LIFT = 0.22;            // flat tint blended over the recolour

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h, s, l) {
  if (!s) return [l, l, l];
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
}

// A copy of `src` in the colour `hex`: its hue and saturation, the art's own
// lightness, so cracks and highlights survive.
function tintedCanvas(src, hex) {
  const out = cloneCanvas(src), g = out.getContext('2d');
  const img = g.getImageData(0, 0, out.width, out.height), px = img.data;
  const n = parseInt(hex.slice(1), 16);
  const tr = (n >> 16 & 255) / 255, tg = (n >> 8 & 255) / 255, tb = (n & 255) / 255;
  const [th, ts] = rgbToHsl(tr, tg, tb);
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const [, , l] = rgbToHsl(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
    const [r, gg, b] = hslToRgb(th, ts, l);
    px[i] = Math.round((r * (1 - TINT_LIFT) + tr * TINT_LIFT) * 255);
    px[i + 1] = Math.round((gg * (1 - TINT_LIFT) + tg * TINT_LIFT) * 255);
    px[i + 2] = Math.round((b * (1 - TINT_LIFT) + tb * TINT_LIFT) * 255);
  }
  g.putImageData(img, 0, 0);
  return out;
}

function copyTile(r, c) {
  const G = sheetGeom(pack.tiles.size, tilesImg.naturalWidth || tilesImg.width, tilesImg.naturalHeight || tilesImg.height);
  const p = G.at(r, c), tc = blankCanvas(G.size, G.size);
  tc.getContext('2d').drawImage(tilesImg, p.x, p.y, G.size, G.size, 0, 0, G.size, G.size);
  pixelClip = tc;
  $('#opPaste').disabled = false;
  toast(`Copied ${tileName(r, c)} — Ctrl+V pastes it, Ctrl+Shift+V fills its row in every colour`);
}

// Pastes onto the given cells: [[column, canvas]], all on row r. A copy of
// another size is centred, never scaled, as in the pixel editor.
function pasteTiles(r, cells) {
  const w = tilesImg.naturalWidth || tilesImg.width, h = tilesImg.naturalHeight || tilesImg.height;
  const G = sheetGeom(pack.tiles.size, w, h);
  const sheet = blankCanvas(w, h), sg = sheet.getContext('2d');
  sg.drawImage(tilesImg, 0, 0);
  for (const [c, art] of cells) {
    const p = G.at(r, c);
    sg.save();
    sg.beginPath();
    sg.rect(p.x, p.y, G.size, G.size);
    sg.clip();
    sg.clearRect(p.x, p.y, G.size, G.size);
    sg.drawImage(art, p.x + Math.round((G.size - art.width) / 2), p.y + Math.round((G.size - art.height) / 2));
    sg.restore();
  }
  markUndo();
  pack.tiles.src = sheet.toDataURL('image/png');
  tilesImg = sheet;
  drawSheet();
  savePack();
}

document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || $('#paint').open || e.target.matches('input,select,textarea')) return;
  if (!$('[data-page="tiles"]').classList.contains('on') || !tilesHot || !tilesImg) return;
  const { r, c } = tilesHot;
  // by the key's place, so it works whatever the keyboard's language
  const key = e.code || 'Key' + (e.key || '').toUpperCase();
  if (key === 'KeyC') { e.preventDefault(); copyTile(r, c); return; }
  if (key !== 'KeyV') return;
  e.preventDefault();
  if (!pixelClip) { toast('Copy a tile first — hover it and press Ctrl+C', true); return; }
  if (!e.shiftKey) {
    pasteTiles(r, [[c, pixelClip]]);
    toast(`Pasted onto ${tileName(r, c)}`);
    return;
  }
  pasteTiles(r, TILE_TINTS.map((hex, col) => [col, hex ? tintedCanvas(pixelClip, hex) : pixelClip]));
  toast(`Pasted across row ${tileName(r)}, each column in its own colour`);
});
