// ---------- Falling rocks ----------
// Hazards that drop from above at fixed x spots (mostly near the cave/
// tunnel sections) and fall under gravity until they hit the ground or
// her. A shield absorbs one and shatters it; without a shield, it costs
// a life just like an enemy. It is made mid-play by its spawner, whose sprite
// it wears and whose gravity it falls by; no block places one.
class Rock extends Entity {
  constructor(spawner) {
    super(spawner.name, spawner.x, spawner.y);
    this.gravity = spawner.props.gravity;
    this.maxFall = spawner.props.maxFall;
    this.breakParticles = spawner.props.breakParticles;
    this.vy = 0;
    this.alive = true;
    this.spin = (Math.random() - 0.5) * 0.2;
  }

  mapCell() { return null; }

  update() {
    if (!this.alive) return;
    this.vy += this.gravity;
    if (this.vy > this.maxFall) this.vy = this.maxFall;
    this.y += this.vy;

    const col = Math.floor(this.x / TILE);
    const row = Math.floor((this.y + this.r) / TILE);
    if (row >= 0 && solidAt(col, row) && this.y + this.r >= row * TILE) {
      this.shatter(row * TILE); // on the ground
      return;
    }
    const rampY = rampSurfaceY(this.x, this.y);
    if (rampY !== null && this.y + this.r >= rampY) { this.shatter(rampY); return; }
    // gone once it is past the floor of the level, not of the window: the
    // camera's height says nothing about how far there is left to fall
    if (this.y > mapHeightPx + 40) { this.alive = false; return; }

    if (!this.touches()) return;
    this.shatter(this.y);
    hurtWarm();
  }

  // gone, in its spawner's breakParticles if it names some, at height y
  shatter(y) {
    this.alive = false;
    ParticleSystem.burst(this.breakParticles, this.x, Math.min(y, this.y + this.r), this.layer);
  }

  draw() {
    if (!this.alive) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.y * this.spin); // tumbles as it falls
    atlas.draw(this.obj, 0, 0);
    ctx.restore();
  }

  debugShape() { return { stroke: '#ffe14d', skip: !this.alive }; }
}
