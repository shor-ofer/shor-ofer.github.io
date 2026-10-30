// ---------- packing the objects ----------
// A port of tools/gen/pack-objects.ps1: every object's frames become one
// horizontal strip, cropped to its artwork, and the strips stack into a single
// objects.png. Everything the manifest states about size is in drawn units,
// with `scale` saying how many of those a sheet pixel is worth — which is what
// lets the art be finer than the size the game shows it at.

// The artwork's bounds inside a frame, taken across every frame at once so
// they all stay in register once cropped.
function artBounds(ctx, w, h, fw) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let minX = fw, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!d[(y * w + x) * 4 + 3]) continue;
      const lx = x % fw;
      if (lx < minX) minX = lx;
      if (lx > maxX) maxX = lx;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: fw, h };      // nothing drawn at all
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function objectStrip(o) {
  const c = blankCanvas(o.fw * o.frames.length, o.fh);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  for (let i = 0; i < o.frames.length; i++) {
    const img = await loadImg(o.frames[i].src);
    g.drawImage(img, i * o.fw, 0, o.fw, o.fh);
  }
  return c;
}

// A collision shape sits inside the sprite at the object's own position, so
// the game needs nothing but the frame and this to know where everything is.
function collisionOut(col, anchor) {
  if (col.shape === 'tile') return { shape: 'tile' };
  const at = { x: anchor[0], y: anchor[1] };
  if (col.shape === 'box') return { shape: 'box', ...at, w: num(col.w), h: num(col.h) };
  return { shape: 'circle', ...at, r: num(col.r) };
}

async function packSprites() {
  const drawn = pack.sprites.filter(o => o.name.trim() && o.frames.length);
  if (!drawn.length) throw new Error('no sprite has any frames yet');

  const built = new Map();
  for (const o of drawn) {
    normalizeObject(o);
    const strip = await objectStrip(o);
    const g = strip.getContext('2d', { willReadFrequently: true });
    built.set(o.name, { o, strip, art: artBounds(g, strip.width, strip.height, o.fw), scale: (o.tiles * TILE) / o.fw });
  }

  // An object's glow is frames in its own strip, so the crop above already
  // takes it in and the two stay in register whatever the glow does.

  let width = 0, height = 0;
  for (const b of built.values()) {
    width = Math.max(width, b.art.w * b.o.frames.length);
    height += b.art.h;
  }

  const sheet = blankCanvas(width, height);
  const sg = sheet.getContext('2d');
  sg.imageSmoothingEnabled = false;
  let y = 0;
  for (const b of built.values()) {
    const { o, art } = b;
    for (let f = 0; f < o.frames.length; f++) {
      sg.drawImage(b.strip, f * o.fw + art.x, art.y, art.w, art.h, f * art.w, y, art.w, art.h);
    }
    b.rect = { x: 0, y, w: art.w, h: art.h };
    y += art.h;
  }

  const entryFor = b => {
    const { o, art, scale } = b;
    // Where the object's own position lands once the transparent margin is
    // gone. For a box that's the box's corner, so a platform is placed by its
    // left end rather than its middle.
    let ax = (o.pivot[0] * o.fw - art.x) * scale;
    const ay = (o.pivot[1] * o.fh - art.y) * scale;
    if (o.collision && o.collision.shape === 'box') ax -= o.collision.w / 2;
    // `frames` is what animates; the glow sits after them and is `mask`
    const def = { frame: b.rect, frames: bodyFrames(o).length };
    if (o.fps) def.fps = num(o.fps, 2);
    // the art is packed finer than it is shown, and the sizes derived from
    // this are rounded to the pixel, so it is not
    if (scale !== 1) def.scale = num(scale, 6);
    def.anchor = [num(ax), num(ay)];
    const off = o.offset || [0, 0];
    if (off[0] || off[1]) def.offset = [num(off[0]), num(off[1])];
    const spans = partSpans(o);
    if (spans) def.parts = spans;
    if (o.slice) def.slice = num(o.slice * scale);   // authored in source pixels
    const mask = maskSpan(o);
    if (mask !== null) def.mask = mask;
    if (o.glow) def.glow = o.glow;
    return def;
  };

  const defs = {};
  for (const b of built.values()) {
    const def = entryFor(b);
    if (b.o.collision && b.o.collision.shape !== 'none') def.collision = collisionOut(b.o.collision, def.anchor);
    defs[b.o.name] = def;
  }

  const ordered = {};
  for (const name of Object.keys(defs).sort()) ordered[name] = defs[name];
  return { sheet, manifest: { texture: 'objects.png', sprites: ordered } };
}

// objects.json: each object's class, codes and every property its class
// declares, so the file reads on its own. A lone code is written bare.
function objectsManifest() {
  const objects = {};
  for (const o of [...pack.objects].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!o.name.trim()) continue;
    fillProps(o);
    // a class no map block places — the worm — has no code to write
    const code = o.code.length ? { code: o.code.length === 1 ? o.code[0] : [...o.code] } : {};
    objects[o.name] = { class: o.cls, ...code, props: { ...o.props } };
  }
  return { sprites: 'sprites.json', objects };
}
