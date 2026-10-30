// ---------- The classes a pack's objects can be ----------
// Every class the game offers to objects.json — and the list the asset editor
// shows when a new object is made, each with the code and properties its
// `editor` block declares. A new kind of thing is a class file, its script tag
// in index.html (and the asset editor's), and a name here.
const GAME_CLASSES = [
  Beetle, Moth, Frog,
  Treasure, Key, Shield, Lantern,
  Portal, Checkpoint, Flag, Door, Sign,
  Plant, RockSpawner, Platform, PlatformStop, Decoration, ParticleSystem,
  Worm
];
const CLASS_BY_NAME = new Map(GAME_CLASSES.map(C => [C.name, C]));

// The class an object is, by its name in objects.json.
const classOf = name => {
  const o = atlas.object(name);
  return o ? CLASS_BY_NAME.get(o.class) || null : null;
};
