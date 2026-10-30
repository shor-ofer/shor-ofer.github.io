// ---------- Carnivorous plant ----------
// Rooted to the ground, closed and harmless normally. If she's airborne
// and passes close overhead (jumping over it), it lunges straight up
// trying to catch her, then retracts and waits before it can strike again.

class Plant extends Entity {
  static bucket = 'plants';
  static editor = {
    label: 'Plant',
    code: '0V',
    // a new sprite's layout in the asset pack creator (sprite-templates.js)
    sprite: { fw: 76, fh: 224, pivot: [0.5, 0.88], note: 'bud is the plant at rest, stem stretches up to head as it lunges, and head bites — head may have frames of its own.' },
    groups: ['Strike', 'Timing', 'Look'],
    props: {
      reach: { type: 'int', default: 100, label: 'How high it lunges, px', group: 'Strike', short: 'Reach', unit: 'px' },
      trigger: { type: 'int', default: 40, label: 'How near overhead sets it off, px', group: 'Strike', short: 'Trigger', unit: 'px' },
      rise: { type: 'int', default: 16, label: 'Frames to lunge up', group: 'Timing', short: 'Rise', unit: 'frames' },
      hold: { type: 'int', default: 10, label: 'Frames held at the top', group: 'Timing', short: 'Hold', join: true, unit: 'frames' },
      fall: { type: 'int', default: 20, label: 'Frames to sink back', group: 'Timing', short: 'Fall', join: true, unit: 'frames' },
      cooldown: { type: 'int', default: 50, label: 'Frames before it can strike again', group: 'Timing', short: 'Cooldown', unit: 'frames' },
      bounce: { type: 'float', default: 0.4, label: 'How far a bite throws her, as a share of a jump', group: 'Strike', short: 'Bounce', percent: true, unit: 'of a jump' },
      bud: { type: 'part', default: 'bud', label: 'Part when resting', group: 'Look', short: 'Bud' },
      stem: { type: 'part', default: 'stem', label: 'Part stretched up to the head', group: 'Look', short: 'Stem', join: true },
      head: { type: 'part', default: 'head', label: 'Part that bites', group: 'Look', short: 'Head', join: true }
    }
  };

  constructor(name, x, groundY) {
    super(name, x, groundY);
    this.groundY = groundY;
    this.state = 'idle';
    this.t = 0;
    this.height = 0;
  }

  // rooted to the floor of its cell
  static cellAnchor = [0.5, 1];

  reset() { this.state = 'idle'; this.t = 0; this.height = 0; }

  update() {
    switch (this.state) {
      case 'idle':
        if (!warm.grounded && warm.y < this.groundY - 20 && Math.abs(warm.x - this.x) < this.props.trigger) {
          this.state = 'rising';
          this.t = 0;
        }
        break;
      case 'rising':
        this.t++;
        this.height = Math.min(this.props.reach, (this.t / this.props.rise) * this.props.reach);
        if (this.t >= this.props.rise) { this.state = 'holding'; this.t = 0; }
        break;
      case 'holding':
        this.t++;
        if (this.t >= this.props.hold) { this.state = 'falling'; this.t = 0; }
        break;
      case 'falling':
        this.t++;
        this.height = Math.max(0, this.props.reach * (1 - this.t / this.props.fall));
        if (this.t >= this.props.fall) { this.height = 0; this.state = 'cooldown'; this.t = 0; }
        break;
      case 'cooldown':
        this.t++;
        if (this.t >= this.props.cooldown) this.state = 'idle';
        break;
    }

    if (this.height <= 4) return;
    const headY = this.groundY - this.height;
    if (Math.hypot(warm.x - this.x, warm.y - headY) < R + this.r) hurtWarm(this.props.bounce);
  }

  draw() {
    if (!atlas.def(this.obj).parts) return;
    // each part may be one frame or an animation of several
    const frame = part => atlas.partFrame(this.obj, part) ?? 0;
    if (this.height < 2) {
      atlas.draw(this.obj, this.x, this.groundY, frame(this.props.bud));
      return;
    }
    // the stem is a plain bar, so stretching it to reach the head is safe
    ctx.save();
    ctx.translate(this.x, this.groundY);
    ctx.scale(1, this.height / this.props.reach);
    atlas.draw(this.obj, 0, 0, frame(this.props.stem));
    ctx.restore();
    atlas.draw(this.obj, this.x, this.groundY - this.height, frame(this.props.head));
  }
}
