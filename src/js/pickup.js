// ---------- Collectibles ----------
const COIN_POP_DURATION = 28; // frames
const COIN_POP_RISE = 22;     // px

// Taken on touch, then gone. A subclass only has to say what taking it does;
// those that set popT also fade upward on the way out.
class Pickup extends Entity {
  static editor = {
    groups: ['Taken', 'Look'],
    props: {
      takeParticles: { type: 'object', class: 'ParticleSystem', default: '', label: 'Particles when taken', group: 'Taken', short: 'Particles' }
    }
  };

  constructor(obj, x, y) {
    super(obj, x, y);
    this.collected = false;
    this.popT = null;
  }

  reset() { this.collected = false; this.popT = null; }

  mapCell() { return this.collected ? null : super.mapCell(); }

  update() {
    if (this.collected) {
      if (this.popT !== null && this.popT < COIN_POP_DURATION) this.popT++;
      return;
    }
    if (!this.touches()) return;
    this.collected = true;
    this.take();
    ParticleSystem.burst(this.props.takeParticles, this.x, this.y, this.layer);
    updateHud();
  }

  // Which frame of its own art it is showing. Kinds whose sheet holds more
  // than one look override this to pick out theirs.
  frame() { return atlas.frame(this.obj); }

  draw() {
    if (this.collected && (this.popT === null || this.popT >= COIN_POP_DURATION)) return;
    const frac = this.collected ? this.popT / COIN_POP_DURATION : 0;
    const frame = this.frame();
    ctx.save();
    if (this.collected) ctx.globalAlpha = 1 - frac;
    atlas.draw(this.obj, this.x, this.y - frac * COIN_POP_RISE, frame);
    atlas.drawMask(this.obj, this.id, this.x, this.y - frac * COIN_POP_RISE, frame);
    ctx.restore();
  }

  debugShape() { return { stroke: '#c08cff', skip: this.collected }; }
}
