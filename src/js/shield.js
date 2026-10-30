// A shield wears two sprites: its own, lying in the level, and `worn`, how it
// looks on her once taken — drawn over her head, centred on it by its pivot
// and animated by its own fps, in place of the plain ring she gets without one.
class Shield extends Pickup {
  static bucket = 'shieldPickups';
  static editor = {
    label: 'Shield',
    code: '0S',
    props: {
      worn: { type: 'sprite', default: '', label: 'Sprite worn over her head (without one, a plain ring)', group: 'Look', short: 'Worn' },
      pickSound: { type: 'sound', default: 'sound::shieldUp', label: 'Sound when taken', group: 'Taken', short: 'Sound' }
    }
  };

  take() {
    hasShield = true;
    // what drawWorm puts on her: the worn sprite, if the pack has it
    const worn = refName(this.props.worn);
    shieldWorn = worn && atlas.defs[worn] ? worn : null;
    playSound(this.props.pickSound);
  }
}
