// ---------- Sprites and objects ----------
// An asset pack's objects/objects.json says what a level can place: each
// object is a game class, the 2-char code a map block names it by, and its
// property values — the sprite it wears among them. The art is sprites.json
// beside it: where each sprite's frames sit in the shared sheet, how fast they
// run, where its own position lands inside a frame, and what it collides as.
// Nothing about a thing's look, size or settings lives in code.
// A page may say where its root manifest is before loading this, which is how
// a downloaded pack points the game at its own copy.
const ROOT_OBJECTS_URL = window.OBJECTS_URL || '/assetpacks/old/garden/objects/objects.json';

// What a pairing id looks like. A key, a door and the portal pair all wear
// their id as a colour, filled into the object's glow mask below; index 0 is
// the wildcard and is left unglowing.
const KEY_COLORS = ['#ffffff', '#ff5a5a', '#ffa23a', '#ffd93a', '#5fe86b',
                    '#4fc9e8', '#6a8cff', '#b06aff', '#ff6ad5', '#9a7b5a'];

// One element names another with the other's kind in front: "sprite::coin",
// "sound::coin". Lookups take either form.
const refName = v => {
  const s = String(v ?? '');
  const cut = s.indexOf('::');
  return cut < 0 ? s : s.slice(cut + 2);
};

// An object's codes as a list. A code is the three characters a map block
// writes: its class's digit and glyph, then the object's own variant — "0C1" is
// the second coin. A digit of n is any digit, which the class reads as the
// thing's own id.
const codesOf = def => !def || !def.code ? [] : Array.isArray(def.code) ? def.code : [def.code];

// A block's third character, with the blanks a map pads with read as 0.
const variantOf = ch => (ch === undefined || ch === '.' || ch === ' ') ? '0' : ch;

class ObjectAtlas {
  constructor() {
    this.defs = {};                // sprite name -> its art
    this.objects = {};             // object name -> { class, code, props }
    this.codes = new Map();        // glyph -> [{ digit, variant, name }]
    this.sheet = new Image();
    this.root = null;
    // Seconds of elapsed play, so sprites animate at their own frame rate
    // however often the game steps or the display refreshes.
    this.clock = 0;
    this.manifests = new Map();   // one entry per file, however many levels name it
    this.tints = new Map();       // one recolour of the sheet per pairing id
  }

  async loadManifest(url, base) {
    const href = new URL(url, base || location.href).href;
    if (this.manifests.has(href)) return this.manifests.get(href);
    const get = async u => {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
      return res.json();
    };
    const data = await get(href);
    if (!data || !data.objects || !data.sprites) throw new Error(`${href}: no objects`);
    const spritesHref = new URL(data.sprites, href).href;
    const art = await get(spritesHref);
    if (!art || !art.sprites) throw new Error(`${spritesHref}: no sprites`);
    const sheet = new Image();
    sheet.src = new URL(art.texture, spritesHref).href;
    await new Promise((ok, fail) => {
      if (sheet.complete && sheet.naturalWidth) return ok();
      sheet.addEventListener('load', ok, { once: true });
      sheet.addEventListener('error', () => fail(new Error(`${sheet.src}: failed to load`)), { once: true });
    });
    const entry = { defs: art.sprites, objects: data.objects, sheet };
    this.manifests.set(href, entry);
    return entry;
  }

  // The editor keeps its own copy of the manifest, so where "root" lives is
  // the caller's business.
  async loadRoot(url = ROOT_OBJECTS_URL) {
    this.root = await this.loadManifest(url);
    this.use(this.root);
  }

  use(entry) {
    this.defs = entry.defs;
    this.objects = entry.objects;
    this.sheet = entry.sheet;
    // which object each block names, built from the objects' own codes
    this.codes = new Map();
    for (const [name, def] of Object.entries(this.objects)) {
      for (const code of codesOf(def)) {
        const glyph = code[1];
        if (!glyph) continue;
        if (!this.codes.has(glyph)) this.codes.set(glyph, []);
        this.codes.get(glyph).push({ digit: code[0], variant: variantOf(code[2]), name });
      }
    }
  }

  // ---- objects ----
  object(name) { return this.objects[refName(name)] || null; }

  // The object a block names. The digit picks the class among those on the
  // glyph (its own, or any for an id class), the third character the object
  // among that class's; a block that matches nothing exactly still places
  // something of its glyph, the variant 0 first — so "5E" is still an enemy.
  objectAt(glyph, digit = 0, variant = '0') {
    const all = this.codes.get(glyph);
    if (!all) return null;
    const v = variantOf(variant);
    const ofDigit = all.filter(e => e.digit === 'n' || +e.digit === digit);
    const pool = ofDigit.length ? ofDigit : all;
    const hit = pool.find(e => e.variant === v) || pool.find(e => e.variant === '0') || pool[0];
    return hit.name;
  }

  // The sprite an object wears.
  spriteOf(name) {
    const o = this.object(name);
    return o && o.props ? refName(o.props.sprite) : '';
  }

  // ---- sprites ----
  def(name) { return this.defs[refName(name)] || {}; }
  hit(name) { return this.def(name).collision || {}; }
  radius(name) { return this.hit(name).r || 0; }

  // Where a sprite stands, given the point its kind spawns at. A def's
  // `offset` moves it off that point — art that sits low in its tile, with its
  // body going along — and a manifest without one means none.
  place(name, x, y) {
    const o = this.def(name).offset;
    return o ? [x + o[0], y + o[1]] : [x, y];
  }

  // Where a named part sits on the sheet: a [first, last] span, a single
  // frame, or null if this object hasn't got one by that name.
  partSpan(name, part) {
    const span = part && this.def(name).parts && this.def(name).parts[part];
    if (span === undefined || span === null) return null;
    return Array.isArray(span) ? span : [span, span];
  }

  // The frame a named part shows now. A part is one frame or a run of them —
  // the manifest writes a lone frame as a number and a run as [first, last] —
  // and a run plays at the object's own fps. So a part can grow from one frame
  // to an animation without the code that draws it changing. null if the
  // object has no part by that name.
  partFrame(name, part, seconds = this.clock) {
    const span = this.partSpan(name, part);
    if (!span) return null;
    const [first, last] = span;
    const fps = this.def(name).fps;
    return first + (fps ? Math.floor(seconds * fps) % (last - first + 1) : 0);
  }

  // Which frame an object is showing right now. Objects with no `fps` are
  // either still or animated on their own clock.
  frame(name) { return this.frameAt(name, this.clock); }

  frameAt(name, seconds) {
    const d = this.def(name);
    return d.fps ? Math.floor(seconds * d.fps) % d.frames : 0;
  }

  // Drawn size of one frame, in world pixels. A def's `scale` is how many
  // world pixels one sheet pixel covers: the sheet keeps the art at the
  // resolution it was drawn at, which is finer than the size it is shown at,
  // so everything else in a def — anchor, collision, slice — stays in world
  // pixels and only the blit knows the difference. A manifest packed before
  // this says nothing, and 1 is what it meant.
  size(name) {
    const d = this.def(name);
    if (!d.frame) return [0, 0];
    const s = d.scale || 1;
    return [d.frame.w * s, d.frame.h * s];
  }

  // Blits one frame. (x,y) is the object's own position and the anchor says
  // where that lands inside the frame. Frames are cropped to their artwork, so
  // this is a straight copy unless the object spans more than the collision
  // box its art was made for — then the middle stretches between caps of
  // `slice` width, which keep their shape.
  draw(name, x, y, frame = 0, ownWidth = 0, sheet = this.sheet) {
    const d = this.def(name);
    if (!d.frame) return;
    this.blit(d, frame % d.frames, x, y, ownWidth, sheet);
  }

  // One frame by where it sits in the def's strip — which may be past
  // `frames`, where an object keeps its glow.
  blit(d, index, x, y, ownWidth, sheet) {
    const f = d.frame;
    const s = d.scale || 1;
    const fw = f.w * s, fh = f.h * s;
    const sx = f.x + index * f.w;
    const dx = x - d.anchor[0], dy = y - d.anchor[1];
    const w = ownWidth ? ownWidth + fw - d.collision.w : fw;
    if (w === fw) {
      ctx.drawImage(sheet, sx, f.y, f.w, f.h, dx, dy, fw, fh);
      return;
    }
    const c = d.slice, cs = c / s;   // cap width, drawn and on the sheet
    ctx.drawImage(sheet, sx, f.y, cs, f.h, dx, dy, c, fh);
    ctx.drawImage(sheet, sx + cs, f.y, f.w - cs * 2, f.h, dx + c, dy, w - c * 2, fh);
    ctx.drawImage(sheet, sx + f.w - cs, f.y, cs, f.h, dx + w - c, dy, c, fh);
  }

  // The glow mask over an object, filled with its pairing colour — or with the
  // object's own `glow` if it has one, which is what a thing that glows for
  // its own sake uses, pairing or not. One recolour of the whole sheet per
  // colour serves every mask on it.
  //
  // The mask is the object's own frames after its `frames`, as [first, last]
  // or a lone frame, and frame n of the object wears the mask's n-th, round
  // again if the mask is shorter. A manifest from before that names another
  // object instead, which is drawn the same way.
  drawMask(name, id, x, y, frame = 0, ownWidth = 0) {
    const d = this.def(name);
    if (d.mask === undefined || d.mask === null || d.mask === '') return;
    const hex = d.glow || (id ? KEY_COLORS[id] || KEY_COLORS[0] : null);
    if (!hex) return;
    const tinted = this.recoloured(hex, this.sheet.src + '#' + hex);
    if (typeof d.mask === 'string') { this.draw(d.mask, x, y, frame, ownWidth, tinted); return; }
    const [first, last] = Array.isArray(d.mask) ? d.mask : [d.mask, d.mask];
    this.blit(d, first + frame % (last - first + 1), x, y, ownWidth, tinted);
  }

  // Recolours the sheet, keeping its shading. Cached per key, which must be
  // unique per source — a canvas has no src to fall back on.
  recoloured(hex, key) {
    let tinted = this.tints.get(key);
    if (!tinted) {
      const img = this.sheet;
      if (img instanceof Image && (!img.complete || !img.naturalWidth)) return img; // still loading
      tinted = document.createElement('canvas');
      tinted.width = img.width;
      tinted.height = img.height;
      const g = tinted.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = 1;
      g.fillStyle = hex;
      g.fillRect(0, 0, tinted.width, tinted.height);
      this.tints.set(key, tinted);
    }
    return tinted;
  }
}

const atlas = new ObjectAtlas();
