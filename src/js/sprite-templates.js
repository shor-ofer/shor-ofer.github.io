// ---------- sprite templates ----------
// The layouts a new sprite can start from in the asset pack creator: the parts
// the game reads by name, a blank frame (or more) in each, a frame size and
// where the body sits. Art is drawn at two pixels to a game unit, as the
// shipped sprites are, so a 64-pixel frame is one tile wide.
//
// Every class whose editor block has part props gets a template of its own,
// its parts named by those props' defaults; its `editor.sprite` adds a size,
// a pivot, frame counts, or parts it reads without a prop. A layout that
// belongs to no class goes in the list below. A new kind with a layout of its
// own is one `sprite` block on its class, or one more entry here.
//
//   { name, label, fw, fh, pivot, parts: [{ name, frames }], note }
const SPRITE_TEMPLATES_EXTRA = [];

// Pixels of art to a game unit in a template.
const TEMPLATE_ART_SCALE = 2;

// Every template there is: the listed ones, then one per class with parts.
function spriteTemplates() {
  const out = SPRITE_TEMPLATES_EXTRA.map(t => ({ ...t }));
  for (const cls of (typeof GAME_CLASSES === 'undefined' ? [] : GAME_CLASSES)) {
    if (!Object.hasOwn(cls, 'editor')) continue;     // one per class, not per subclass
    const ed = cls.editor;
    const own = ed.sprite || {};
    const props = typeof cls.propDefs === 'function' ? cls.propDefs() : ed.props || {};
    const named = Object.values(props).filter(p => p.type === 'part').map(p => p.default);
    const names = own.parts || named;
    if (!names.length) continue;
    const frames = own.frames || {};
    out.push({
      name: (ed.label || cls.name).toLowerCase().replace(/[^a-z0-9]+/g, ''),
      label: ed.label || cls.name,
      fw: own.fw || 64, fh: own.fh || 64,
      pivot: own.pivot || [0.5, 0.5],
      parts: names.map(n => ({ name: n, frames: frames[n] || 1 })),
      note: own.note || `${ed.label || cls.name} reads the parts ${names.join(', ')}.`
    });
  }
  return out;
}
