// The level's finish. Its id picks which of the level's exits it leads to.
// One leading into a level pack in another player's browser stands faded
// while that pack can't be reached (flagShut, in the game), breathing while
// the game is still looking.
class Flag extends Entity {
  static bucket = 'finishPoints';
  static editor = { label: 'Flag', code: 'nF', props: {} };

  draw() {
    const shut = typeof flagShut === 'function' ? flagShut(this) : '';
    if (!shut) { super.draw(); return; }
    ctx.save();
    ctx.globalAlpha = shut === 'checking' ? 0.35 + 0.15 * Math.sin(atlas.clock * 5) : 0.3;
    super.draw();
    ctx.restore();
  }
}
