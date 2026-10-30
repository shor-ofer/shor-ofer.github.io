// hopping frog: sits on the ground, periodically leaps forward, turns
// around at a wall or ledge (checked while grounded, same as the beetle)

class Frog extends Enemy {
  static editor = {
    label: 'Frog',
    code: '2E',
    props: {
      hopUp: { type: 'float', default: 8.5, label: 'Hop strength, up', group: 'Motion', short: 'Hop up', unit: 'px / frame' },
      hopForward: { type: 'float', default: 2.2, label: 'Hop strength, forward', group: 'Motion', short: 'Forward', join: true, unit: 'px / frame' },
      pause: { type: 'int', default: 40, label: 'Frames on the ground between hops', group: 'Motion', short: 'Pause', unit: 'frames' }
    }
  };

  constructor(name, x, y) {
    super(name, x, y);
    this.type = 'hopper';
    this.vx = 0;
    this.vy = 0;
    this.pauseT = this.props.pause;
    this.grounded = false;
  }

  update() {
    if (!this.alive) return;
    this.vy += GRAVITY;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;
    this.x += this.vx;
    this.y += this.vy;

    const row = Math.floor((this.y + this.r) / TILE);
    const col = Math.floor(this.x / TILE);
    this.grounded = false;
    if (this.vy >= 0 && solidAt(col, row) && this.y + this.r >= row * TILE) {
      this.y = row * TILE - this.r;
      this.vy = 0;
      this.vx = 0;
      this.grounded = true;
    }

    if (!this.grounded) return;
    this.pauseT--;
    if (this.pauseT > 0) return;
    // check for a wall/ledge ahead before committing to the hop
    const aheadCol = Math.floor((this.x + this.dir * (this.r + TILE * 0.6)) / TILE);
    const bodyRow = Math.floor(this.y / TILE);
    const footRow = Math.floor((this.y + this.r + 2) / TILE);
    if (solidAt(aheadCol, bodyRow) || !solidAt(aheadCol, footRow)) this.dir *= -1;
    this.vy = -this.props.hopUp;
    this.vx = this.dir * this.props.hopForward;
    this.pauseT = this.props.pause;
  }

  drawBody() {
    const squash = this.grounded ? 1 : Math.max(0.7, 1 - Math.abs(this.vy) * 0.02);
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.dir < 0) ctx.scale(-1, 1);
    ctx.scale(1 / squash, squash); // stretch a little in the air, squash on the ground
    atlas.draw(this.obj, 0, 0);
    ctx.restore();
  }
}
