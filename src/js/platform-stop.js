// Where a moving platform turns back: placed in any layer, on the platform's
// line of travel, it ends the run there as a solid tile would. It is only for
// building levels — the editor draws it as a marker, the game reads it as a
// limit while it builds the platforms and never spawns or draws it. Without
// one a platform runs until the first tile that collides, or the map's edge.
class PlatformStop extends Entity {
  static editor = {
    label: 'Platform stop',
    code: '0x',
    props: {}
  };

  // never put in the world; the level editor shows this mark in its place
  static editorOnly = true;
  static stopsPlatforms = true;     // from any layer
  static marker = { colour: '#ff5a5a', letter: '⛔' };

  static drawGuide(g, view) {
    if (view.mode !== 'debug') this.drawMarker(g, view);
  }
}
