// Every enemy is stomped from above and hurts from the side; what a stomp is
// worth is each enemy object's own.
class Enemy extends Entity {
  static bucket = 'enemies';
  static editor = {
    groups: ['Motion', 'Stomp', 'Look'],
    props: {
      stompScore: { type: 'int', default: 1, label: 'Score for a stomp', group: 'Stomp', short: 'Score' },
      stompSound: { type: 'sound', default: 'sound::eat', label: 'Sound when stomped', group: 'Stomp', short: 'Sound' },
      stompBounce: { type: 'float', default: 0.55, label: 'Bounce off it, as a share of a jump', group: 'Stomp', short: 'Bounce', percent: true, unit: 'of a jump' },
      stompParticles: { type: 'object', class: 'ParticleSystem', default: '', label: 'Particles when killed (stomped, or hit with the shield on)', group: 'Stomp', short: 'Particles' }
    }
  };

  constructor(name, x, y) {
    super(name, x, y);
    this.dir = 1;
    this.alive = true;
  }

  // standing on the top edge of its cell, to fall onto whatever is below
  static cellAnchor = [0.5, 0];

  reset() { this.alive = true; this.dir = 1; }

  mapCell() { return this.alive ? super.mapCell() : null; }

  draw() { if (this.alive) this.drawBody(); }

  drawBody() {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.dir < 0) ctx.scale(-1, 1); // sprite's natural facing is to the right
    atlas.draw(this.obj, 0, 0, this.animFrame());
    ctx.restore();
  }

  animFrame() { return atlas.frame(this.obj); }

  debugShape() { return { stroke: '#ffe14d', skip: !this.alive }; }
}
