// A signpost speaks when she walks into it. The words aren't here: the level
// carries a `messages` list and the block's info digit picks one, so '0M0',
// '1M0' and '2M0' are three different notes on the same post.
class Sign extends Entity {
  static bucket = 'signs';
  static editor = { label: 'Sign', code: 'nM', props: {} };


  constructor(name, x, y) { super(name, x, y); this.reading = false; }
  reset() { this.reading = false; }
  update() {
    const near = this.touches();
    if (near && !this.reading) showSignMessage(levelMessages[this.id]);
    this.reading = near;     // so standing against it doesn't re-trigger every frame
  }
}
