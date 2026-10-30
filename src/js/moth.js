// flying moth: no gravity, drifts side to side within a range of its spawn
// point while bobbing up and down on a sine wave

class Moth extends Enemy {
  static editor = {
    label: 'Moth',
    code: '1E',
    props: {
      speed: { type: 'float', default: 0.9, label: 'Flying speed, px a frame', group: 'Motion', short: 'Speed', unit: 'px / frame' },
      range: { type: 'float', default: 3, label: 'How far it strays each way, in tiles', group: 'Motion', short: 'Range', unit: 'tiles' },
      bob: { type: 'float', default: 14, label: 'Bob height, px', group: 'Motion', short: 'Bob', unit: 'px' },
      bobSpeed: { type: 'float', default: 0.05, label: 'Bob speed', group: 'Motion', short: 'Bob speed', join: true }
    }
  };

  constructor(name, x, y) {
    super(name, x, y);
    this.type = 'flyer';
    this.baseX = x;
    this.baseY = y;
    this.t = Math.random() * 100;
  }

  // mid-cell, because it never falls onto anything
  static cellAnchor = [0.5, 0.5];

  update() {
    if (!this.alive) return;
    this.t++;
    const { speed, range, bob, bobSpeed } = this.props;
    this.x += this.dir * speed;
    if (this.x > this.baseX + range * TILE) { this.x = this.baseX + range * TILE; this.dir = -1; }
    else if (this.x < this.baseX - range * TILE) { this.x = this.baseX - range * TILE; this.dir = 1; }
    this.y = this.baseY + Math.sin(this.t * bobSpeed) * bob;
  }

  // wingbeat runs on its own clock, so a swarm isn't in lockstep
  drawBody() { atlas.draw(this.obj, this.x, this.y, atlas.frameAt(this.obj, this.t * FIXED_STEP_MS / 1000)); }
}
