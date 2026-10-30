// The ledge a rock drops from. It isn't drawn — the hazard is the rock, which
// wears the spawner's sprite and falls as the spawner says, so two spawners
// can share a sprite and still drop at different speeds.
class RockSpawner extends Entity {
  static bucket = 'rockSpawners';
  static editor = {
    label: 'Falling rock',
    code: '0R',
    groups: ['Drop', 'Look'],
    props: {
      interval: { type: 'int', default: 140, label: 'Frames between drops', group: 'Drop', short: 'Every', unit: 'frames' },
      gravity: { type: 'float', default: 0.55, label: 'Gravity', group: 'Drop', short: 'Gravity' },
      maxFall: { type: 'float', default: 12, label: 'Top falling speed', group: 'Drop', short: 'Top speed', join: true, unit: 'px / frame' },
      breakParticles: { type: 'object', class: 'ParticleSystem', default: '', label: 'Particles when a rock breaks', group: 'Drop', short: 'Breaks into' }
    }
  };

  constructor(name, x, y, phase) {
    super(name, x, y);
    this.timer = phase;
  }

  // on the ledge's top edge, which is where its rocks start falling
  static cellAnchor = [0.5, 0];

  static spawn(row, col, data, name, index) {
    // staggered so a row of them doesn't drop in unison
    return new this(name, ...this.spawnPoint(row, col, name), index * 37 % 90);
  }

  update() {
    this.timer--;
    if (this.timer > 0) return;
    this.timer = this.props.interval;
    rocks.push(new Rock(this));
  }

  reset() { this.timer = this.props.interval; }
  draw() {}
  debugShape() { return null; }
}
