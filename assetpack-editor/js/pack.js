// ---------- the pack ----------
// One model for the whole app. Everything a tab edits lives in here, and
// export.js is the only thing that knows how it turns into files.
//
//   sprites[]      art: frames (data: URLs), parts, glow, size, pivot, collision
//   objects[]      what a level places: a game class, its codes, its property values
//   tiles          the terrain sheet plus the four strings that label it
//   backgrounds[]  tiling sprites a level can sit in front of
//   sounds.defs    id -> an engine sound def (synth, clip or looping track)
//   sounds.media   'clips/x.wav' -> bytes, for the defs that name a file

const TILE = 32;                  // what the game draws a 1-tile object at
const PART_COLORS = ['#ffb84d', '#5ec8ff', '#8be37a', '#ff7ab6', '#b48cff', '#4de0c4', '#ff9161', '#e3e35b'];

let pack = null;

function newSprite(name) {
  const part = { id: uid(), name: 'all', color: PART_COLORS[0] };
  return {
    id: uid(),
    name: name || 'object',
    fw: 32, fh: 32,
    frames: [],                   // {id, src, partId}
    parts: [part],
    active: part.id,
    tiles: 1,                     // how many tiles wide it is drawn at
    pivot: [0.5, 0.5],            // where its body sits in the art, as a fraction of the frame
    offset: [0, 0],               // game pixels its body is moved off the point its kind spawns at
    fps: 0,                       // 0 = still, or animated on its own clock
    slice: 0,
    glow: '',                     // a colour its glow part is filled with, rather than its pairing's
    collision: { shape: 'none' }
  };
}

// ---------- objects ----------
// What a level places. The class is one of the game's own (GAME_CLASSES, read
// from src/js), and its `editor` block says the code that places it and which
// properties it reads; this keeps a value for each.
//
//   code   the 3-char block codes that place it: its class's two (a digit, or n
//          for any digit read as an id, then a glyph), then its own variant —
//          set here, never typed: the first one its class has free
//   props  property name -> value; references carry their kind, "sound::coin"

const gameClass = name => CLASS_BY_NAME.get(name) || null;
const classDefs = name => { const C = gameClass(name); return C ? C.propDefs() : {}; };
const objectByName = name => pack.objects.find(o => o.name === name);

// Every property its class declares, keeping the values it already had for
// those, defaults for the rest — so changing class keeps what still applies.
function fillProps(o) {
  const defs = classDefs(o.cls);
  const props = {};
  for (const [k, d] of Object.entries(defs)) props[k] = o.props && o.props[k] !== undefined ? o.props[k] : d.default;
  o.props = props;
}

// The third character, which tells the objects of one class apart.
const VARIANTS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const variantOf = o => (o.code[0] || '')[2] || '';

// The first variant no other object of that class has.
function freeVariant(cls, except) {
  const used = new Set(pack.objects.filter(o => o !== except && o.cls === cls).map(variantOf));
  return [...VARIANTS].find(v => !used.has(v)) || '0';
}

// Its codes: every code its class has, with this variant on the end.
function setVariant(o, v) {
  const C = gameClass(o.cls);
  o.code = C ? C.codes.map(c => c + v) : o.code.map(c => c.slice(0, 2) + v);
}

function newGameObject(name, cls, sprite) {
  const o = { id: uid(), name, cls, code: [], props: { sprite: sprite ? 'sprite::' + sprite : '' } };
  fillProps(o);
  setVariant(o, freeVariant(cls, o));
  return o;
}

// Lanterns once shared one sprite, each showing a part of it, and said how far
// they lit as `reach`. Each now wears a sprite of its own, cut here from the
// part it showed, and the reach is its `radius`. The shared sprite goes once
// nothing wears it.
function migrateLanterns(p) {
  const split = new Set();
  let n = 0;
  for (const o of p.objects) {
    if (o.cls !== 'Lantern') continue;
    if (o.props.reach !== undefined && o.props.radius === undefined) o.props.radius = o.props.reach;
    const partName = o.props.part;
    delete o.props.reach;
    delete o.props.part;
    const s = p.sprites.find(x => x.name === refName(o.props.sprite));
    const part = partName && s && s.parts.find(x => x.name === partName);
    if (!part) continue;
    let name = o.name, k = 2;
    while (p.sprites.some(x => x.name === name)) name = o.name + k++;
    const all = { id: uid(), name: 'all', color: PART_COLORS[0] };
    const own = {
      ...structuredClone({ ...s, frames: [], parts: [] }),
      id: uid(), name, parts: [all], active: all.id,
      frames: s.frames.filter(f => f.partId === part.id).map(f => ({ id: uid(), src: f.src, partId: all.id }))
    };
    p.sprites.splice(p.sprites.indexOf(s) + 1, 0, own);
    o.props.sprite = 'sprite::' + name;
    split.add(s.name);
    n++;
  }
  p.sprites = p.sprites.filter(s => !split.has(s.name) || p.objects.some(o => refName(o.props.sprite) === s.name));
  return n;
}

// A shield's worn look was a part of its own sprite; it is a sprite of its
// own now, so the part is cut out into one (named after the shield, as + New
// would) and the shield's worn names it. A worn part with no frames just goes.
// How many shields were changed.
function migrateShieldWorn(p) {
  let n = 0;
  for (const o of p.objects) {
    const v = o.props && o.props.worn;
    if (o.cls !== 'Shield' || !v || String(v).startsWith('sprite::')) continue;
    n++;
    const s = p.sprites.find(x => x.name === refName(o.props.sprite));
    const part = s && s.parts.find(x => x.name === v);
    o.props.worn = '';
    if (!part) continue;
    const frames = s.frames.filter(f => f.partId === part.id);
    if (s.parts.length > 1) {
      s.parts = s.parts.filter(x => x !== part);
      s.frames = s.frames.filter(f => f.partId !== part.id);
      if (s.active === part.id) s.active = s.parts[0].id;
    }
    if (!frames.length) continue;
    let name = o.name + 'Worn', k = 2;
    while (p.sprites.some(x => x.name === name)) name = o.name + 'Worn' + k++;
    const all = { id: uid(), name: 'all', color: PART_COLORS[0] };
    const own = {
      ...structuredClone({ ...s, frames: [], parts: [] }),
      id: uid(), name, parts: [all], active: all.id, collision: { shape: 'none' },
      frames: frames.map(f => ({ id: uid(), src: f.src, partId: all.id }))
    };
    p.sprites.splice(p.sprites.indexOf(s) + 1, 0, own);
    o.props.worn = 'sprite::' + name;
  }
  return n;
}

// Coins and gems were two classes doing the same thing; both are Treasure
// now, a gem told apart by its props and counting as a gem. A coin keeps its
// third character; a gem, whose code was 0G, takes the first one free. True if
// any was changed.
function migrateTreasure(p) {
  const old = p.objects.filter(o => o.cls === 'Coin' || o.cls === 'Gem');
  const gems = old.filter(o => o.cls === 'Gem');
  for (const o of old) {
    o.props = { ...o.props, tally: o.cls === 'Gem' ? 'gems' : 'coins' };
    o.cls = 'Treasure';
  }
  // the coins' codes stand; each gem then takes the first one left
  const used = new Set(p.objects.filter(x => x.cls === 'Treasure' && !gems.includes(x)).map(variantOf));
  for (const o of gems) {
    const v = [...VARIANTS].find(x => !used.has(x)) || '0';
    used.add(v);
    o.code = ['0C' + v];
  }
  return old.length > 0;
}

// Platforms turn at a platform stop, which the level editor places from the
// pack's objects like anything else; a pack without one gets one, with no
// art — the editor marks it, and the game never draws it. True if added.
// Some steps add things a pack made before they existed lacks — a platform
// stop, the default particle systems. Each runs once per pack: it can't tell
// a pack too old to have them from one whose owner removed them, or never
// wanted them, so it doesn't try again. A new or imported pack is marked done
// from the start (newPack). True the first time, for a pack not marked.
function onceOnly(p, step) {
  if (!p.migrated) p.migrated = {};
  if (p.migrated[step]) return false;
  p.migrated[step] = true;
  return true;
}

function migratePlatformStop(p) {
  if (!onceOnly(p, 'platformStop')) return false;
  if (p.objects.some(o => o.cls === 'PlatformStop')) return false;
  let name = 'platformStop', n = 2;
  while (p.objects.some(o => o.name === name)) name = 'platformStop' + n++;
  const o = { id: uid(), name, cls: 'PlatformStop', code: ['0x0'], props: { sprite: '' } };
  fillProps(o);
  p.objects.push(o);
  return true;
}

// Particle systems came with a few ready-made: a pack with none gets them
// (ParticleSystem.presets), and its coins, gems, rocks and enemies that have
// never had particles get the fitting ones. True if anything was added.
function migrateParticles(p) {
  if (!onceOnly(p, 'particles')) return false;
  if (p.objects.some(o => o.cls === 'ParticleSystem')) return false;
  const made = {};
  Object.entries(ParticleSystem.presets).forEach(([want, props], i) => {
    let name = want, n = 2;
    while (p.objects.some(o => o.name === name)) name = want + n++;
    const o = { id: uid(), name, cls: 'ParticleSystem', code: ['0Z' + VARIANTS[i]], props: { sprite: '', ...props } };
    fillProps(o);
    p.objects.push(o);
    made[want] = 'object::' + name;
  });
  const give = (o, k, ref) => { if (o.props[k] === undefined) o.props[k] = ref; };
  for (const o of p.objects) {
    if (o.cls === 'Treasure') give(o, 'takeParticles', o.props.tally === 'gems' ? made.gemSparkle : made.sparkle);
    if (o.cls === 'RockSpawner') give(o, 'breakParticles', made.dust);
    if (['Beetle', 'Moth', 'Frog'].includes(o.cls)) give(o, 'stompParticles', made.dust);
  }
  return true;
}

// The worm became an object like the rest: a pack without a Worm object gets
// one, wearing the sprite called worm if it has one, and her sprite gets the
// collision circle she has always hit the tiles with, if it has none. True if
// either was done.
function migrateWorm(p) {
  const had = p.objects.find(o => o.cls === 'Worm');
  const worn = p.sprites.find(x => x.name === refName(had ? had.props.sprite : 'worm'));
  const circled = !!worn && (!worn.collision || worn.collision.shape === 'none');
  if (circled) worn.collision = { shape: 'circle', r: 11 };
  if (had) return circled;
  const s = p.sprites.find(x => x.name === 'worm');
  let name = 'worm', n = 2;
  while (p.objects.some(o => o.name === name)) name = 'worm' + n++;
  const o = { id: uid(), name, cls: 'Worm', code: [], props: { sprite: s ? 'sprite::worm' : '' } };
  fillProps(o);
  p.objects.push(o);
  return true;
}

// An object whose codes aren't its class's — the class's code has changed in
// the game since it was saved, as platforms' did — takes the class's again,
// keeping its own third character.
function recodeObjects(p) {
  let n = 0;
  for (const o of p.objects) {
    const C = gameClass(o.cls);
    const v = variantOf(o) || '0';
    if (!C || o.code.join() === C.codes.map(c => c + v).join()) continue;
    setVariant(o, v);
    n++;
  }
  return n;
}

// Packs from when an object chose its own 2-char code: each class's objects
// are numbered in the order of the digit they had, as was done for the packs
// on disk, so the first coin is 0C0 and the second 0C1.
function migrateCodes(p) {
  if (!p.objects.some(o => o.code.some(c => c.length === 2))) return false;
  const byClass = {};
  for (const o of p.objects) (byClass[o.cls] = byClass[o.cls] || []).push(o);
  const digit = o => { const c = o.code[0] || 'n'; return c[0] === 'n' ? 0 : +c[0]; };
  for (const list of Object.values(byClass)) {
    list.sort((a, b) => digit(a) - digit(b) || a.name.localeCompare(b.name));
    list.forEach((o, i) => setVariant(o, VARIANTS[i]));
  }
  return true;
}

// The codes two objects both claim, by code.
function clashingCodes() {
  const seen = new Map();
  for (const o of pack.objects) for (const c of o.code) seen.set(c, [...(seen.get(c) || []), o.name]);
  return [...seen].filter(([, names]) => names.length > 1);
}

function newPack() {
  return {
    id: uid(),                    // its record in this browser (js/db.js)
    dirty: true,                  // changed since it was last exported — never, yet
    origin: '',                   // where it was imported from, if it was: a .zip or a folder
    exported: false,              // written out as a .zip at least once
    // the one-time additions it has had, or never needs (see onceOnly): a new
    // or imported pack is as it is, and gets none
    migrated: { platformStop: true, particles: true },
    name: 'My Pack',
    sprites: [],
    objects: [],
    tiles: {
      src: null, w: 0, h: 0,
      size: 64,
      row_0: '01234567890123      ',
      row_1: '##########////TU*o$~',
      row_C: 'SSSSSSSSSS0123 ^    ',
      row_D: 'TTTTTTTTTTTTTTTTDDDD',
      col_0: '0123456789'
    },
    backgrounds: [],              // {id, file, name, color, scroll, src}
    sounds: { defs: {}, media: {} }
  };
}

// ---------- lookups the tabs share ----------
const spriteByName = name => pack.sprites.find(o => o.name === name);
const spriteById = id => pack.sprites.find(o => o.id === id);
const partsOf = o => o.parts;
const framesOfPart = (o, pid) => o.frames.filter(f => f.partId === pid);
const partById = (o, id) => o.parts.find(p => p.id === id);

// An object's glow is a part of its own, marked `glow`: the frames the game
// fills with a colour and draws over the rest. It is kept last, so the strip
// is the object's frames and then its mask, and it is never an animation.
const glowPart = o => o.parts.find(p => p.glow) || null;
const bodyFrames = o => { const g = glowPart(o); return g ? o.frames.filter(f => f.partId !== g.id) : o.frames; };

function nextPartColor(o) {
  const used = o.parts.map(p => p.color);
  return PART_COLORS.find(c => !used.includes(c)) || PART_COLORS[o.parts.length % PART_COLORS.length];
}

// Frames are kept grouped by part, in part order, because the strip the game
// reads is one row and a part is a span of it.
function normalizeObject(o) {
  // one glow part at most, and it goes last
  let seen = false;
  o.parts.forEach(p => { if (p.glow) { if (seen) delete p.glow; seen = true; } });
  o.parts = [...o.parts.filter(p => !p.glow), ...o.parts.filter(p => p.glow)];
  const valid = new Set(o.parts.map(p => p.id));
  o.frames.forEach(f => { if (!valid.has(f.partId)) f.partId = o.parts[0] ? o.parts[0].id : null; });
  const order = [...o.parts.map(p => p.id), null];
  o.frames = order.flatMap(id => o.frames.filter(f => f.partId === id));
  if (!partById(o, o.active)) o.active = o.parts[0] ? o.parts[0].id : null;
}

// Where each named part lands in the finished strip. A part covering the whole
// strip is left out: naming it would say nothing the object doesn't already.
function partSpans(o) {
  normalizeObject(o);
  const spans = {};
  let at = 0;
  for (const p of o.parts) {
    if (p.glow) continue;                       // written as the mask, not a part
    const n = framesOfPart(o, p.id).length;
    if (n) spans[p.name] = n === 1 ? at : [at, at + n - 1];
    at += n;
  }
  const only = Object.keys(spans);
  if (only.length <= 1 && at === bodyFrames(o).length && only[0] === 'all') return null;
  if (!only.length) return null;
  // by name, so two packs built from the same art read the same
  const sorted = {};
  for (const k of only.sort()) sorted[k] = spans[k];
  return sorted;
}

// Where the glow sits in the finished strip, as the manifest's `mask`: a run
// after the object's own frames, or null for an object that doesn't glow.
function maskSpan(o) {
  const g = glowPart(o);
  const n = g ? framesOfPart(o, g.id).length : 0;
  if (!n) return null;
  const at = bodyFrames(o).length;
  return n === 1 ? at : [at, at + n - 1];
}

// A glow used to be an object of its own that another named as its `mask`.
// Each such object's frames become a glow part of the one it served, and the
// mask object goes once nothing else names it. Frames of another size are
// fine: every frame is drawn into its object's frame size.
function migrateGlow(p) {
  const served = new Set();
  for (const o of p.sprites) {
    const name = typeof o.mask === 'string' ? o.mask : '';
    delete o.mask;
    delete o.maskWas;
    if (!name || o.copy) continue;
    const m = p.sprites.find(x => x.name === name);
    if (!m || !m.frames.length || glowPart(o)) continue;
    const part = { id: uid(), name: 'glow', color: '#ffffff', glow: true };
    o.parts.push(part);
    for (const f of m.frames) o.frames.push({ id: uid(), src: f.src, partId: part.id });
    normalizeObject(o);
    served.add(name);
  }
  // only those nothing else still uses — as art for a copy, say
  const gone = [...served].filter(n => !p.sprites.some(o => o.copy === n));
  p.sprites = p.sprites.filter(o => !gone.includes(o.name));
  return gone;
}

// A pack from before sprites and objects were apart: one list of objects,
// each art and behaviour at once, some "copies" of another's art, a rock's
// fall on the art itself, and which block spawned what decided by the game's
// old fixed tables. The list becomes the sprites; the objects are made from
// those tables with the game's defaults, as tools did for the packs on disk.
const OLD_GLYPHS = {
  E: ['beetle', 'moth', 'frog'], C: ['coin', 'coin2'], G: 'gem', K: 'key', S: 'shield',
  N: ['lantern:fulllight', 'lantern:biglight', 'lantern:smalllight'],
  O: 'portal', '!': 'checkpoint', V: 'plant', R: ['rock', 'rock2'],
  L: 'door', F: 'flag', M: 'sign', W: 'cloud',
  '>': 'platform', '<': 'platform', '^': 'platform', v: 'platform'
};
const OLD_CLASSES = {
  E: ['Beetle', 'Moth', 'Frog'], C: 'Treasure', G: 'Treasure', K: 'Key', S: 'Shield', N: 'Lantern',
  O: 'Portal', '!': 'Checkpoint', V: 'Plant', R: 'RockSpawner', L: 'Door', F: 'Flag',
  M: 'Sign', W: 'Decoration', '>': 'Platform', '<': 'Platform', '^': 'Platform', v: 'Platform'
};
const OLD_LANTERNS = { fulllight: ['lanternFull', 0], biglight: ['lanternBig', 6], smalllight: ['lanternSmall', 2] };

function migrateSplit(p) {
  if (p.sprites) return false;
  p.sprites = p.objects || [];
  p.objects = [];
  migrateGlow(p);
  const art = name => {
    const s = p.sprites.find(x => x.name === name);
    return s && s.copy ? s.copy : name;
  };
  const byName = {};
  for (const [glyph, named] of Object.entries(OLD_GLYPHS)) {
    const list = Array.isArray(named) ? named : [named];
    list.forEach((entry, i) => {
      const cls = Array.isArray(OLD_CLASSES[glyph]) ? OLD_CLASSES[glyph][i] : OLD_CLASSES[glyph];
      const [base, part] = entry.split(':');
      const sprite = p.sprites.find(x => x.name === base);
      if (!sprite || !gameClass(cls)) return;
      const C = gameClass(cls);
      const code = (Array.isArray(named) && !C.takesId ? String(i) : 'n') + glyph;
      let name = base, extra = {};
      if (cls === 'Lantern') { const [n, reach] = OLD_LANTERNS[part] || [base + part, 0]; name = n; extra = { part, reach }; }
      if (cls === 'RockSpawner' && sprite.fall) extra = { gravity: sprite.fall.gravity, maxFall: sprite.fall.max };
      if (glyph === 'G') extra = { score: 5, pickSound: 'sound::gem', tally: 'gems' };
      if (!byName[name]) {
        const o = { id: uid(), name, cls, code: [], props: { sprite: 'sprite::' + art(base), ...extra } };
        fillProps(o);
        byName[name] = o;
        p.objects.push(o);
      }
      byName[name].code.push(code);
    });
  }
  // copies were only ever art someone else drew
  p.sprites = p.sprites.filter(s => !s.copy);
  for (const s of p.sprites) { delete s.copy; delete s.fall; }
  return true;
}

// ---------- persistence ----------
// Written through structuredClone rather than JSON: audio is held as bytes,
// and JSON would turn a 3.5MB track into 45MB of {"0":12,"1":255,...} and
// then fail to read it back as a Uint8Array at all. Blob URLs are runtime
// only, so nothing here holds one.
let saveTimer = 0;
let saving = null;
let saveAgain = false;

function writePack() {
  if (saving) { saveAgain = true; return saving; }
  saving = dbSave(structuredClone(pack))
    .then(() => renderPackPicker())
    .catch(err => toast('Could not save: ' + err.message, true))
    .finally(() => {
      saving = null;
      if (saveAgain) { saveAgain = false; writePack(); }
    });
  return saving;
}

// Set when the stored packs could not be read at start-up: the blank one open
// instead must not be saved over them, so nothing is written until the person
// imports a pack or makes a new one, which say they mean to.
let storageLocked = false;
let warnTimer = 0;

// Any change marks the pack as not exported since (the picker's *).
function savePack() {
  clearTimeout(warnTimer);
  warnTimer = setTimeout(refreshTabWarnings, 150);
  if (storageLocked) return;
  if (!pack.dirty) { pack.dirty = true; renderPackPicker(); }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writePack, 400);
}

// Written now rather than on the debounce: before another pack is opened.
async function flushPack() {
  clearTimeout(saveTimer);
  if (storageLocked || !pack) return;
  await writePack();
  while (saving) await saving;
}
