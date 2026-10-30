// ---------- The worm ----------
// Her, as an object in objects.json like any other, so a pack says what she
// wears and how she moves. She is never placed by a map block — a level says
// only where she starts — so the class has no code; the game takes the pack's
// one Worm object (or these defaults, for a pack without one) at every load.
//
// Her body is a chain of circles tapering to the tail; the head's radius is
// her sprite's collision circle, which is what she hits the tiles with.
class Worm extends Entity {
  static editor = {
    label: 'Worm',
    player: true,
    // a new sprite's layout in the asset pack creator (sprite-templates.js)
    sprite: {
      fw: 44, fh: 44, pivot: [0.5, 0.5], frames: { body: 5 },
      note: 'Her head is 22 game units across — 44 pixels — and her collision circle is what she hits the tiles with. body is its shades, head to tail; tail is the tip; head faces right, and headLeft, if drawn, left.'
    },
    groups: ['Look', 'Body', 'Motion'],
    props: {
      sprite: { type: 'sprite', default: 'sprite::worm', label: 'Sprite', group: 'Look', short: 'Sprite' },
      body: { type: 'part', default: 'body', label: 'Body — its frames are the shades, head to tail', group: 'Look', short: 'Body' },
      tail: { type: 'part', default: 'tail', label: 'Tail tip', group: 'Look', short: 'Tail', join: true },
      head: { type: 'part', default: 'headRight', label: 'Head, facing right', group: 'Look', short: 'Head', join: true },
      headLeft: { type: 'part', default: 'headLeft', optional: true, label: 'Head facing left (without one, the right one mirrored)', group: 'Look', short: 'Head left', join: true },
      segments: { type: 'int', default: 14, label: 'Body parts, head to tail', group: 'Body', short: 'Segments' },
      tailScale: { type: 'float', default: 0.32, label: 'Tail size, a share of the head (1 = no taper)', group: 'Body', short: 'Tail size', percent: true, unit: 'of the head' },
      speed: { type: 'float', default: 3, label: 'Run speed, px a frame', group: 'Motion', short: 'Run', unit: 'px / frame' },
      jump: { type: 'float', default: 10.5, label: 'Jump speed, px a frame', group: 'Motion', short: 'Jump', join: true, unit: 'px / frame' }
    }
  };

  // The head radius a sprite gives her: its collision circle, half the longer
  // side of a box, or the radius she has always had.
  static radiusOf(sprite) {
    const c = atlas.hit(sprite);
    if (c.shape === 'circle' && c.r > 0) return c.r;
    if (c.shape === 'box' && c.w > 0) return Math.max(c.w, c.h) / 2;
    return 11;
  }

  // The settings of the pack's Worm object, or the defaults.
  static current() {
    const name = Object.keys(atlas.objects || {}).find(n => atlas.objects[n].class === 'Worm');
    const props = name ? this.propsFor(name)
      : Object.fromEntries(Object.entries(this.propDefs()).map(([k, d]) => [k, d.default]));
    const sprite = refName(props.sprite) || 'worm';
    return { ...props, sprite, r: this.radiusOf(sprite) };
  }
}
