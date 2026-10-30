// Taking it decides how far she can see. The darkness itself lives in the
// engine, since it is drawn over the whole screen rather than by any one
// object; each lantern object has its own sprite — its own lamp — and says how
// far that lamp lets her see. A radius of 0 is the full light a level already
// starts in, so that lamp puts it back.
class Lantern extends Pickup {
  static bucket = 'lanterns';
  static editor = {
    label: 'Lantern',
    code: '0N',   // 'T' and 'L' are spoken for, by the tileset and the door
    groups: ['Light', 'Taken', 'Look'],
    props: {
      radius: { type: 'int', default: 0, label: 'Light radius, in tiles (0 = full light)', group: 'Light', short: 'Radius', unit: 'tiles' },
      pickSound: { type: 'sound', default: 'sound::lantern', label: 'Sound when taken', group: 'Taken', short: 'Sound' }
    }
  };

  take() {
    lightReach = this.props.radius || 0;
    playSound(this.props.pickSound);
  }
}
