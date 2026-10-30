class Checkpoint extends Entity {
  static bucket = 'checkpoints';
  static editor = {
    label: 'Checkpoint',
    code: '0!',
    sprite: { fw: 108, fh: 186, pivot: [0.5, 0.82], note: 'off until she reaches it, on after.' },
    groups: ['Look', 'Reached'],
    props: {
      off: { type: 'part', default: 'off', label: 'Part before she reaches it', group: 'Look', short: 'Off' },
      on: { type: 'part', default: 'on', label: 'Part once reached', group: 'Look', short: 'On', join: true },
      sound: { type: 'sound', default: 'sound::checkpoint', label: 'Sound when reached', group: 'Reached', short: 'Sound' }
    }
  };

  constructor(name, x, y) { super(name, x, y); this.activated = false; }
  reset() { this.activated = false; }
  update() {
    if (this.activated || !this.touches()) return;
    this.activated = true;
    respawnPoint = { x: this.x, y: this.y };
    playSound(this.props.sound);
  }
  draw() {
    atlas.draw(this.obj, this.x, this.y, atlas.partFrame(this.obj, this.activated ? this.props.on : this.props.off) ?? 0);
  }
}
