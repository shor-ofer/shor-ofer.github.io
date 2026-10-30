// ---------- Pads, gates and goals ----------
// Portal and flag are the plain Entity drawing: an animated sprite plus its
// glow mask tinted by the id that pairs it with something else. Their codes
// take any digit, which is that id.
class Portal extends Entity {
  static bucket = 'portals';
  static editor = { label: 'Portal', code: 'nO', props: {} };

}
