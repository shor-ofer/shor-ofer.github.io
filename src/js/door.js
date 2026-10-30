// A gate, not a tile — it stamps its own cell solid and clears it when opened.
// Its code takes any digit, which is its id: the key that opens it, and the
// colour it glows. 0 takes any key.
class Door extends Entity {
  static bucket = 'lockedDoorSpots';
  static mainLayerOnly = true;   // only the solid layer has cells to stamp
  static solidCell = true;       // which stops a platform, as a solid tile does
  static cellAnchor = [0, 0];     // it is its whole cell
  static editor = {
    label: 'Door',
    code: 'nL',   // its digit is its id
    props: {
      openSound: { type: 'sound', default: 'sound::unlock', label: 'Sound when opened', group: 'Opened', short: 'Sound' }
    }
  };

  constructor(name, row, col, id = 0) {
    super(name, col * TILE, row * TILE);
    this.row = row;
    this.col = col;
    this.id = id;
    this.open = false;
  }
  static spawn(row, col, data, name) { return new this(name, row, col, data); }
  reset() { this.open = false; }
  draw() { if (!this.open) super.draw(); }
  mapCell() { return this.open ? null : { ...super.mapCell(), x: this.col * TILE + TILE / 2, y: this.row * TILE + TILE / 2 }; }
  debugShape() { return null; }   // its cell is already solid in the terrain view
}
