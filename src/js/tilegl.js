// ---------- Tiles in one WebGL pass ----------
// The sheet is a grid — a row per kind of tile, a column per tint, every tile
// at the same spot in its cell — so a whole layer can be drawn by one
// full-screen quad: for each screen pixel the fragment shader finds the map
// cell under it, reads that cell's sheet row and tint from a small texture
// (one texel per cell), and samples the tile straight from the sheet. A layer
// costs one draw however many tiles it shows.
//
// It draws into a WebGL canvas of its own, copied onto the game's 2D canvas
// once per layer, so the layers still interleave with the objects drawn in 2D
// between them. A layer's map texture is built once, the first time it is
// drawn — only the level loader writes a layer's rows and tints. Without
// WebGL, or if its context is lost, drawTileLayer() does the work in 2D as it
// always has; F3 switches between the two to compare them.
//
// It is off to begin with. It draws exactly what 2D does, pixel for pixel,
// but measured on an Intel HD 4600 at 60 fps it was no faster: the main
// layer's pass cost about what 2D did, and copying each layer onto the 2D
// canvas ate what it saved. It pays off when a layer shows far more tiles
// than the levels here do, or once everything draws in WebGL with no copy.

// Fewer tiles than this on screen and a layer is drawn in 2D, where it costs
// less than the pass and the copy onto the game's canvas.
const TILE_GL_MIN = 40;

const TILE_GL_VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const TILE_GL_FS = `
precision highp float;
uniform sampler2D uMap;      // r: sheet row + 1 (0 is no tile), g: tint column
uniform sampler2D uSheet;
uniform vec2 uMapSize;       // cells
uniform vec2 uSheetSize;     // sheet pixels
uniform vec2 uView;          // canvas pixels
uniform vec2 uCam;           // world units at the canvas's top-left
uniform float uPx;           // canvas pixels per world unit
uniform float uTile;         // world units per tile
uniform float uCell;         // sheet pixels per cell, margin included
uniform float uInset;        // sheet pixels from a cell's corner to its tile
uniform float uSize;         // sheet pixels per tile
uniform float uGutter;       // an old sheet's label cell, or 0
void main() {
  vec2 dp = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 world = uCam + dp / uPx;
  vec2 cell = floor(world / uTile);
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uMapSize.x || cell.y >= uMapSize.y) discard;
  vec4 t = texture2D(uMap, (cell + 0.5) / uMapSize);
  float row = floor(t.r * 255.0 + 0.5) - 1.0;
  if (row < 0.0) discard;
  float tint = floor(t.g * 255.0 + 0.5);
  vec2 corner = vec2(uGutter) + vec2(tint, row) * uCell + vec2(uInset);
  // where in the tile, kept half a pixel inside it so filtering at an odd
  // scale never reaches the margin or the next cell
  vec2 local = clamp((world - cell * uTile) / uTile * uSize, vec2(0.5), vec2(uSize - 0.5));
  gl_FragColor = texture2D(uSheet, (corner + local) / uSheetSize);
}`;

const tileGL = {
  on: false,           // off: measured, it was no faster than 2D here; F3 turns it on to compare
  canvas: null, gl: null, prog: null, loc: null,
  broken: false,       // no WebGL here, or its context was lost
  sheets: new Map(),   // sheet image -> texture
  maps: new WeakMap()  // layer meta -> texture
};

function tileGLReady() {
  if (!tileGL.on || tileGL.broken) return false;
  if (tileGL.gl) return true;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  const highp = gl && gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  if (!gl || !highp || !highp.precision) { tileGL.broken = true; return false; }
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, TILE_GL_VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, TILE_GL_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const loc = {};
    for (const u of ['uMap', 'uSheet', 'uMapSize', 'uSheetSize', 'uView', 'uCam', 'uPx', 'uTile', 'uCell', 'uInset', 'uSize', 'uGutter']) {
      loc[u] = gl.getUniformLocation(prog, u);
    }
    gl.uniform1i(loc.uMap, 0);
    gl.uniform1i(loc.uSheet, 1);
    Object.assign(tileGL, { canvas, gl, prog, loc });
  } catch (err) {
    console.warn('Tiles fall back to 2D:', err.message);
    tileGL.broken = true;
    return false;
  }
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); tileGL.broken = true; });
  return true;
}

function tileGLTexture(gl, filter) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// The sheet, uploaded once; premultiplied, as the canvas it lands on expects.
function tileGLSheet(img) {
  const gl = tileGL.gl;
  let tex = tileGL.sheets.get(img);
  if (tex) return tex;
  tex = tileGLTexture(gl, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  tileGL.sheets.set(img, tex);
  return tex;
}

// One texel per map cell: its sheet row + 1, or 0 for none, and its tint.
function tileGLMap(meta) {
  const gl = tileGL.gl;
  let tex = tileGL.maps.get(meta);
  if (tex) return tex;
  const rowsN = meta.row.length, colsN = rowsN ? meta.row[0].length : 0;
  const data = new Uint8Array(Math.max(1, colsN * rowsN) * 4);
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < colsN; c++) {
      const i = (r * colsN + c) * 4, row = meta.row[r][c];
      data[i] = row < 0 ? 0 : Math.min(255, row + 1);
      data[i + 1] = meta.tint[r][c] || 0;
      data[i + 3] = 255;
    }
  }
  tex = tileGLTexture(gl, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Math.max(1, colsN), Math.max(1, rowsN), 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  tileGL.maps.set(meta, tex);
  return tex;
}

// Draws one layer onto the game's canvas, the camera at (camX, camY) in world
// units. False if it couldn't, so the caller draws it the 2D way.
function drawTileLayerGL(meta, sheet, camX, camY) {
  const img = sheet.img;
  if (!meta || !meta.row.length || !img.complete || !img.naturalWidth || !tileGLReady()) return false;
  const gl = tileGL.gl, cv = tileGL.canvas, loc = tileGL.loc;
  if (gl.isContextLost()) { tileGL.broken = true; return false; }
  if (cv.width !== canvas.width || cv.height !== canvas.height) {
    cv.width = canvas.width;
    cv.height = canvas.height;
  }
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tileGLMap(meta));
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tileGLSheet(img));
  gl.uniform2f(loc.uMapSize, meta.row[0].length, meta.row.length);
  gl.uniform2f(loc.uSheetSize, img.naturalWidth, img.naturalHeight);
  gl.uniform2f(loc.uView, cv.width, cv.height);
  gl.uniform2f(loc.uCam, camX, camY);
  gl.uniform1f(loc.uPx, PIXEL_X);
  gl.uniform1f(loc.uTile, TILE);
  gl.uniform1f(loc.uCell, sheet.cell);
  gl.uniform1f(loc.uInset, sheet.inset);
  gl.uniform1f(loc.uSize, sheet.size);
  gl.uniform1f(loc.uGutter, sheet.gutter);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  // onto the game's canvas, a pixel to a pixel
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (Math.random() < 1) // This condition is always true, but can be adjusted as needed
    ctx.drawImage(cv, 0, 0);
  ctx.restore();
  return true;
}
