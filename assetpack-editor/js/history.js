// ---------- undo ----------
// A snapshot per gesture rather than per keystroke, so one slider drag undoes
// in one go. Audio bytes are shared rather than copied: nothing ever mutates
// them in place, and copying megabytes per edit is what made saving slow.

const UNDO_LIMIT = 40;
const undoStack = [];
const redoStack = [];
let undoOpen = false;      // a gesture is already captured
let undoTimer = 0;

function snapshotPack() {
  const media = pack.sounds.media;
  pack.sounds.media = {};
  const copy = structuredClone(pack);
  pack.sounds.media = media;
  copy.sounds.media = { ...media };
  return copy;
}

// Another pack opened: what could be undone belonged to the last one.
function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  undoOpen = false;
  refreshHistory();
}

// Called before anything changes the pack.
function markUndo() {
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undoOpen = false; }, 600);
  if (undoOpen) return;
  undoStack.push(snapshotPack());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  undoOpen = true;
  refreshHistory();
}

async function applySnapshot(snap) {
  pack = snap;
  fcan.clear();
  mediaUrls.clear();
  current = (current && pack.sprites.find(o => o.id === current.id)) || pack.sprites[0] || null;
  currentObj = (currentObj && pack.objects.find(o => o.id === currentObj.id)) || pack.objects[0] || null;
  if (!sndSel || !pack.sounds.defs[sndSel]) sndSel = Object.keys(pack.sounds.defs)[0] || null;
  laySel = 0;
  await warmFrames();
  useSounds();
  renderObjects();
  renderGameObjects();
  renderTiles();
  renderBackgrounds();
  renderSounds();
  renderPackTab();
  savePack();
  refreshHistory();
}

async function undoHistory() {
  if (!undoStack.length) { toast('Nothing to undo', true); return; }
  redoStack.push(snapshotPack());
  undoOpen = false;
  await applySnapshot(undoStack.pop());
  toast('Undone');
}

async function redoHistory() {
  if (!redoStack.length) { toast('Nothing to redo', true); return; }
  undoStack.push(snapshotPack());
  undoOpen = false;
  await applySnapshot(redoStack.pop());
  toast('Redone');
}

function refreshHistory() {
  $('#undoBtn').disabled = !undoStack.length;
  $('#redoBtn').disabled = !redoStack.length;
}

$('#undoBtn').onclick = () => undoHistory();
$('#redoBtn').onclick = () => redoHistory();

document.addEventListener('keydown', e => {
  if ($('#paint').open) return;                      // the paint dialog keeps its own history
  if (e.target.matches('input,textarea,select')) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redoHistory() : undoHistory(); }
  else if (e.code === 'KeyY') { e.preventDefault(); redoHistory(); }
});
