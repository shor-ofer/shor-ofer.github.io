// ---------- Tileset ----------
// A sheet plus the four strings that say what's on it. One of these is built
// per level, and it answers everything about terrain art: which row a map
// block names and what that row collides as.
//
// The sheet is a grid (see tools/gen/tiles.ps1): a row per type and a
// column per tint, 0 to 9. Every cell carries a CELL_PAD margin, and only the
// tile inside it is ever blitted. A sheet from before carries one more cell
// of labels down the left and across the top; it is told by its width, one
// cell more than its columns, and read past.
//
//   row_0  "01234567890123      "   first character of the tile's name
//   row_1  "##########////TU*o$~"   second character — the glyph
//   row_C  "SSSSSSSSSS0123 ^    "   what that row collides as
//   col_0  "0123456789"             name of each tint column
//
// A map block names a tile with those two characters plus a colour, so row
// '1'+'#' column '1' is the cell block '1#1' draws. A name whose first
// character is blank matches any info id.
const DEFAULT_ROW_0 = '01234567890123      ';
const DEFAULT_ROW_1 = '##########////TU*o$~';
const DEFAULT_ROW_C = 'SSSSSSSSSS0123 ^    ';
const DEFAULT_COL_0 = '0123456789';

// Collision classes a row may declare in row_C. The sheet decides what its
// own tiles do, so adding a shape is data rather than another branch.
const HIT_NONE = ' ';          // drawn but never collides
const HIT_SOLID = 'S';         // the whole cell
const HIT_HALF = '^';          // only the top half — the duck-under ceiling
const isRampHit = c => c >= '0' && c <= '3';   // a wedge, the digit is its direction

// A blank id or colour is the same as naming index 0.
const isBlank = ch => ch === undefined || ch === '.' || ch === ' ';

const CELL_PAD = 4;            // empty margin each cell carries, in tile units
const DEFAULT_TEXTURE = new URL(window.TILES_URL || '/assetpacks/old/garden/tiles/tiles.png', location.href).href;
const DEFAULT_TILE_SIZE = 64;

// Every path a level names is relative to that level's own JSON file, so a
// level folder can be moved or copied whole. Resolution goes through URL,
// which keeps '..' inside the origin, and the result must still be a .png
// we are allowed to fetch.
function resolveTexture(path, base) {
  if (!path) return null;
  try {
    const url = new URL(path, base);
    if (url.origin !== location.origin) return null;
    if (!url.pathname.toLowerCase().endsWith('.png')) return null;
    return url.href;
  } catch (e) {
    return null;
  }
}

// One Image per texture, however many levels name it.
const textureCache = new Map();
function loadTexture(href) {
  let img = textureCache.get(href);
  if (!img) {
    img = new Image();
    img.src = href;
    textureCache.set(href, img);
  }
  return img;
}

// Settles when the sheet is usable, so a level can wait for its art instead of
// drawing a frame of nothing. A sheet that fails to load settles too, since a
// missing file should leave the game playable rather than stuck.
function textureReady(img) {
  if (img.complete) return Promise.resolve();
  return new Promise(done => {
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  });
}

class Tileset {
  // `sheet` is a level's tileset block; anything it leaves out falls back to
  // the default sheet.
  constructor(sheet = {}) {
    const row0 = sheet.row_0 || DEFAULT_ROW_0;
    const row1 = sheet.row_1 || DEFAULT_ROW_1;
    const rowC = sheet.row_C || DEFAULT_ROW_C;
    this.colText = sheet.col_0 || DEFAULT_COL_0;

    this.byName = new Map();     // 'id + glyph' -> row
    this.byGlyph = new Map();    // glyph -> row, for names written with a blank id
    this.collide = [];
    for (let i = 0; i < row1.length; i++) {
      this.collide.push(rowC[i] === undefined ? HIT_NONE : rowC[i]);
      const glyph = row1[i];
      if (glyph === ' ') continue;
      const id = row0[i] === undefined ? ' ' : row0[i];
      this.byName.set(id + glyph, i);
      if (isBlank(id)) this.byGlyph.set(glyph, i);
    }
    this.tints = new Map();
    for (let i = 0; i < this.colText.length; i++) this.tints.set(this.colText[i], i);

    const size = sheet.size > 0 ? +sheet.size : DEFAULT_TILE_SIZE;
    const scale = size / TILE;
    this.img = loadTexture(resolveTexture(sheet.texture, location.href) || DEFAULT_TEXTURE);
    this.size = size;
    this.cell = (TILE + CELL_PAD * 2) * scale;
    this.cols = this.colText.length;
    this.inset = CELL_PAD * scale;
  }

  // An old sheet's label cell, or 0 — known once the image has its size.
  get gutter() {
    const w = this.img.naturalWidth;
    return w && Math.round(w / this.cell) > this.cols ? this.cell : 0;
  }

  // Which sheet row a block names, or -1 if this sheet hasn't got one.
  row(idCh, glyph) {
    const exact = this.byName.get(idCh + glyph);
    if (exact !== undefined) return exact;
    const loose = this.byGlyph.get(glyph);
    return loose === undefined ? -1 : loose;
  }

  collideAt(row) { return row < 0 ? HIT_NONE : this.collide[row]; }

  tintIndex(ch) { return this.tints.get(ch) || 0; }
  tintName(i) { return this.colText[i] || this.colText[0] || '0'; }
  firstTint() { return this.colText[0]; }

  // Every row is cropped to its own tile; the cell's margin is never blitted.
  // A size other than a tile's lets the caller snap the edges to the screen.
  drawCell(row, col, x, y, w = TILE, h = TILE) {
    const g = this.gutter;
    const cx = g + col * this.cell, cy = g + row * this.cell;
    ctx.drawImage(this.img, cx + this.inset, cy + this.inset, this.size, this.size,
      x, y, w, h);
  }
}
