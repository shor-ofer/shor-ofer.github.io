// ---------- Entities ----------
// Everything a level spawns is one of these. A class says how its kind moves,
// draws and reacts; an object in objects.json says which class it is, the
// block code that places it, and its property values. So a new kind of thing
// is a class listed in classes.js, not another branch in the loader, the
// update loop and the draw loop.
//
// Each class declares what it reads in a static `editor` block: the 2-char
// code that places it and its properties, typed and with defaults. The asset
// editor builds an object's form from it, and the game falls back on the
// defaults for anything an object leaves out. Declarations add up down the
// class chain, so an Enemy's stomp settings are every enemy's.
//
//   types: int, float, bool, text, color, choice (with `options`),
//          sound, sprite, part (of the object's own sprite), background,
//          object (another of the pack's objects, of the class `class` names:
//          'object::sparkle')
//   optional: true  — a part that may be missing, the class managing without
//
// How the asset pack creator lays a property out, Blender-style — each one a
// line, label on the left, field on the right:
//   group: 'Motion' — the panel it is in (one per name, folding away); the
//                     class's `editor.groups` orders the panels, then its bases'
//                     ; a property without one goes in Properties
//   short: 'Speed'  — the label on its line; `label` is its tooltip
//   join: true      — stacked onto the line before, as one joined block
//                     (speed and its variation, a size's start and end)
//   unit: 'px'      — shown inside the field, after the value
//   percent: true   — a share, shown and typed as a percentage (0.2 is 20 %)
//
// The base is enough on its own for anything that just sits there: it draws
// its sprite's current animation frame, tinted by its pairing id if it has
// one and its sprite carries a glow mask.
class Entity {
  static editor = { props: {} };

  // Anything a class shows about itself beyond its art, where someone is
  // building or checking a level — never in normal play. Called once per
  // placed thing (and per palette swatch) with what is being drawn on:
  //
  //   view.mode   'board'  the level editor's board, in world units
  //               'panel'  a palette swatch, in its own pixels (view.size)
  //               'debug'  the game's collision view, in world units
  //   view.r, view.c   its cell (board, debug)
  //   view.digit       its block's digit — an id, or what editor.digit says
  //   view.blocks(r, c)   whether that cell stops things moving, as the game
  //                       will see it (board)
  //   view.px          screen pixels per unit, for lines that stay 1px thin
  //   view.hasArt      whether its sprite drew anything
  //   view.name        the object placed (board, panel), for its props
  //
  // The base draws nothing; a class with something to show overrides it.
  static drawGuide(g, view) {}

  // The marker an editor-only class wears when it has no art: a tinted square
  // with a letter, `static marker = { colour, letter }`.
  static drawMarker(g, view) {
    const m = this.marker;
    if (!m || view.hasArt) return;
    const s = view.mode === 'panel' ? view.size * 0.76 : TILE;
    const x = view.mode === 'panel' ? (view.size - s) / 2 : view.c * TILE;
    const y = view.mode === 'panel' ? (view.size - s) / 2 : view.r * TILE;
    g.save();
    g.fillStyle = m.colour + '33';
    g.fillRect(x, y, s, s);
    g.strokeStyle = m.colour;
    g.lineWidth = 2 / view.px;
    g.strokeRect(x + 1, y + 1, s - 2, s - 2);
    g.fillStyle = m.colour;
    g.font = `bold ${Math.round(s * 0.5)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(m.letter, x + s / 2, y + s / 2 + 1);
    g.restore();
  }

  // Where in its cell an object of this class stands, as a share of the cell:
  // the middle, unless a class stands on the floor or hangs from the top. The
  // editors read it too, to draw a thing where the game will put it.
  static cellAnchor = [0.5, 0.5];

  // The two characters a map block starts with to place one of these: a digit
  // and a glyph, fixed by the class — `editor.code`, one or a list. A digit of
  // n is any digit, which the class reads as the thing's own id: a key's
  // colour, a sign's message. The third character picks which object of the
  // class, so a pack can have several: 0C0 a coin, 0C1 another.
  static get codes() {
    const c = (Object.hasOwn(this, 'editor') && this.editor.code) || [];
    return Array.isArray(c) ? c : [c];
  }
  static get takesId() { return this.codes.some(c => c[0] === 'n'); }

  // What the digit means when a class takes any: its id, unless the class
  // says otherwise (`editor.digit`) — a platform's is its direction.
  static get digitMeaning() {
    if (!this.takesId) return null;
    return (Object.hasOwn(this, 'editor') && this.editor.digit) || 'id';
  }

  // The order of the property panels: the class's own `editor.groups`, then
  // its bases' (so a lantern's Light comes before every pickup's Taken), then
  // any other group its properties name, as they come.
  static propGroups() {
    const chain = [];
    for (let C = this; C && C.prototype instanceof Object; C = Object.getPrototypeOf(C)) chain.push(C);
    const out = [];
    for (const C of chain) if (Object.hasOwn(C, 'editor')) for (const g of C.editor.groups || []) if (!out.includes(g)) out.push(g);
    for (const d of Object.values(this.propDefs())) { const g = d.group || 'Properties'; if (!out.includes(g)) out.push(g); }
    return out;
  }

  // Every property this class reads, its bases' first, the sprite before all.
  static propDefs() {
    const chain = [];
    for (let C = this; C && C.prototype instanceof Object; C = Object.getPrototypeOf(C)) chain.unshift(C);
    const out = { sprite: { type: 'sprite', default: '', label: 'Sprite', group: 'Look', short: 'Sprite' } };
    for (const C of chain) if (Object.hasOwn(C, 'editor')) Object.assign(out, C.editor.props || {});
    return out;
  }

  // An object's values over the class defaults.
  static propsFor(name) {
    const own = (atlas.object(name) || {}).props || {};
    const out = {};
    for (const [k, d] of Object.entries(this.propDefs())) out[k] = own[k] !== undefined ? own[k] : d.default;
    return out;
  }

  constructor(name, x, y) {
    this.name = name;                         // the object, in objects.json
    this.props = this.constructor.propsFor(name);
    this.obj = refName(this.props.sprite);    // the sprite it wears, in sprites.json
    this.x = x;
    this.y = y;
    this.r = atlas.radius(this.obj);
    this.layer = LAYER_MAIN;   // overwritten at spawn; anything made mid-play is middle
  }

  // Where its cellAnchor says, moved by its sprite's offset. `index` is how
  // many of this kind the level has already spawned.
  static spawn(row, col, data, name, index) {
    const e = new this(name, ...this.spawnPoint(row, col, name));
    if (this.takesId) e.id = data;
    return e;
  }

  static spawnPoint(row, col, name) {
    const [ax, ay] = this.cellAnchor;
    return atlas.place(atlas.spriteOf(name), (col + ax) * TILE, (row + ay) * TILE);
  }

  update() {}

  draw() {
    const frame = atlas.frame(this.obj);
    atlas.draw(this.obj, this.x, this.y, frame);
    atlas.drawMask(this.obj, this.id, this.x, this.y, frame);
  }

  // back to how the level spawned it, for a restart without a reload
  reset() {}

  // How this would be written in a block map, for the debug export: its
  // object's first code, with its own id where the code takes any digit. null
  // if it isn't something a map spells out, like a rock already in flight.
  mapCell() {
    const code = codesOf(atlas.object(this.name))[0];
    if (!code) return null;
    return { ch: code[1], data: code[0] === 'n' ? (this.id || 0) : +code[0], x: this.x, y: this.y };
  }

  touches(reach = R) {
    return Math.hypot(warm.x - this.x, warm.y - this.y) < reach + this.r;
  }

  // A trigger is a ring in the collision view; things that are stood on or
  // stomped override this.
  debugShape() { return { stroke: '#c08cff' }; }
}

// Costs a life unless the shield takes it. Everything damaging shares this,
// so what an enemy, a rock and a plant do to her can't drift apart.
function hurtWarm(bounce = 0) {
  if (!hasShield) { loseLife(); return; }
  hasShield = false;
  updateHud();
  playSound('shieldBreak');
  if (bounce) warm.vy = JUMP_V * bounce;
}
