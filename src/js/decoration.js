// Scenery. It spawns from a block like anything else and then just stands
// there: no collision, no update, nothing to collect.
//
// Its art may be far larger than the cell that named it — the cloud is 200x100
// where a tile is 32 — because a block says where the middle of the thing goes,
// not how much room it takes. Nothing reads its size, so nothing minds.
class Decoration extends Entity {
  static bucket = 'decorations';
  static editor = { label: 'Decoration', code: '0W', props: {} };

  // Never collides, so it has no ring to show in the collision view.
  debugShape() { return null; }
}
