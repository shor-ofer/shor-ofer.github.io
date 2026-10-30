// ---------- back ----------
// Following what an object names — its sprite, sound, particle system or
// background (↗, or a double-click), a new one made from its list, or an
// object a sprite or sound is used by — leaves a step behind: where you were,
// the tab and what was picked on it. ← Back (or Alt+←, or the mouse's back
// button) goes back a step at a time. Only these jumps leave one; clicking a
// tab or a list item does not.
const NAV_LIMIT = 40;
const navSteps = [];

// where you are now
function navHere() {
  const page = $('.page.on');
  return {
    tab: page ? page.dataset.page : 'gameobjects',
    obj: currentObj && currentObj.id,
    sprite: current && current.id,
    sound: sndSel
  };
}

// Called just before a jump.
function navJump() {
  const here = navHere();
  const last = navSteps[navSteps.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(here)) return;
  navSteps.push(here);
  if (navSteps.length > NAV_LIMIT) navSteps.shift();
  refreshBack();
}

function navBack() {
  const to = navSteps.pop();
  refreshBack();
  if (!to) return;
  // what was picked then, if it is still there
  currentObj = pack.objects.find(o => o.id === to.obj) || currentObj;
  current = pack.sprites.find(s => s.id === to.sprite) || current;
  if (to.sound && pack.sounds.defs[to.sound]) { sndSel = to.sound; laySel = 0; }
  showTab(to.tab);
  if (to.tab === 'gameobjects') renderGameObjects();
  if (to.tab === 'objects') renderObjects();
  if (to.tab === 'sounds') renderSounds();
}

function refreshBack() {
  const b = $('#backBtn');
  if (!b) return;
  b.disabled = !navSteps.length;
  const to = navSteps[navSteps.length - 1];
  b.title = to ? `Back to ${({ gameobjects: 'Objects', objects: 'Sprites', sounds: 'Sounds', backgrounds: 'Backgrounds', tiles: 'Tiles', pack: 'Pack' })[to.tab] || to.tab} (Alt+←)` : 'Back — after following what an object names';
}

// another pack: the steps were through the last one
function navForget() { navSteps.length = 0; refreshBack(); }

$('#backBtn').addEventListener('click', navBack);
addEventListener('keydown', e => {
  if (e.altKey && e.key === 'ArrowLeft' && navSteps.length && !(e.target.matches && e.target.matches('input,textarea,select'))) {
    e.preventDefault();
    navBack();
  }
});
// the mouse's back button
addEventListener('mouseup', e => { if (e.button === 3 && navSteps.length) { e.preventDefault(); navBack(); } });
refreshBack();
