// walks its ledge, turning at a wall or a drop
class Beetle extends Enemy {
  static editor = {
    label: 'Beetle',
    code: '0E',
    props: {
      speed: { type: 'float', default: 1.1, label: 'Walking speed, px a frame', group: 'Motion', short: 'Speed', unit: 'px / frame' }
    }
  };

  constructor(name, x, y) {
    super(name, x, y);
    this.type = 'beetle';
    this.vy = 0;
    this.frame = 0;
    this.animT = 0;
  }

  update() {
    if (!this.alive) return;

    this.vy += GRAVITY;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;
    this.y += this.vy;

    const row = Math.floor((this.y + this.r) / TILE);
    const col = Math.floor(this.x / TILE);
    if (this.vy >= 0 && solidAt(col, row) && this.y + this.r >= row * TILE) {
      this.y = row * TILE - this.r;
      this.vy = 0;
    }
    if (this.vy >= 0) {
      const rampY = rampUnderfoot(this.x, this.y + this.r);
      if (rampY !== null) {
        this.y = rampY - this.r;
        this.vy = 0;
      }
    }

    // patrol: walk until a wall or a ledge is ahead, then turn around
    const nextX = this.x + this.dir * this.props.speed;
    const aheadCol = Math.floor((nextX + this.dir * this.r) / TILE);
    const bodyRow = Math.floor(this.y / TILE);
    const footRow = Math.floor((this.y + this.r + 2) / TILE);
    const wallAhead = solidAt(aheadCol, bodyRow);
    const groundAhead = solidAt(aheadCol, footRow) || rampUnderfoot(nextX, this.y + this.r) !== null;
    if (wallAhead || !groundAhead) {
      this.dir *= -1;
    } else {
      this.x = nextX;
    }

    // walk cycle runs on her own clock rather than the shared one
    const def = atlas.def(this.obj);
    this.animT += FIXED_STEP_MS / 1000;
    if (this.animT >= 1 / def.fps) {
      this.animT -= 1 / def.fps;
      this.frame = (this.frame + 1) % def.frames;
    }
  }

  animFrame() { return this.frame; }
}
