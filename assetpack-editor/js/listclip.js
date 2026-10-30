// ---------- copy and paste in the left lists ----------
// With the pointer over a tab's list (or a click just made in it), Ctrl+C
// copies the object, sprite or sound picked there and Ctrl+V adds a copy of it
// under the next free name — coin → coin2 — and picks it. Anywhere else on the
// tab the keys keep their own meaning: frames on the Sprites tab, layers on
// the Sounds tab. Delete (or Backspace) there deletes the item picked, as
// its tab's own delete button does, and Ctrl+Z brings it back.
//
// The copy goes on the system clipboard as text, whole, so it pastes into
// another pack, another tab or window of the creator, another browser: a
// sprite with its frames, parts, collision, pivot, offset, fps and glow; an
// object with the sprite it wears; a sound with its recorded audio, if it has
// any. It is also kept here, for a browser that won't hand the text back.
let listClip = null;        // the last copy made here, as it went on the clipboard

const CLIP_TAG = 'warm-worm-asset';
const LIST_KINDS = {
  gameobjects: { list: '#goList', kind: 'object' },
  objects: { list: '#objList', kind: 'sprite' },
  sounds: { list: '#sndList', kind: 'sound' }
};
const KIND_TAB = { object: 'Objects', sprite: 'Sprites', sound: 'Sounds' };
// each tab's own button for deleting the item picked
const KIND_DELETE = { object: '#goForm [data-g="delete"]', sprite: '[data-p="delete"]', sound: '#sndDel' };

// The next free name from `base`, by `taken`: coin → coin2, coin2 → coin3.
function nextName(base, taken) {
  const stem = base.replace(/\d+$/, '') || base;
  if (!taken(base)) return base;
  let n = 2, name;
  do name = stem + n++; while (taken(name));
  return name;
}

const bytesB64 = u8 => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64Bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// A sprite as plain data: everything it is, each frame as its pixels are now
// (which may be newer than its src).
function spriteClip(s) {
  const { frames, ...rest } = s;
  return { ...structuredClone(rest), frames: frames.map(f => ({ partId: f.partId, src: frameCanvas(s, f).toDataURL() })) };
}

// The list item picked on that tab, as a clip, or null.
function makeClip(kind) {
  if (kind === 'object') {
    const o = currentObj;
    if (!o) return null;
    const s = spriteByName(refName(o.props.sprite));
    return { [CLIP_TAG]: 1, kind, name: o.name, object: structuredClone({ cls: o.cls, props: o.props }), sprite: s ? spriteClip(s) : null };
  }
  if (kind === 'sprite') return current ? { [CLIP_TAG]: 1, kind, name: current.name, sprite: spriteClip(current) } : null;
  const d = sndSel && pack.sounds.defs[sndSel];
  if (!d) return null;
  const m = d.src && pack.sounds.media[d.src];
  return { [CLIP_TAG]: 1, kind, name: sndSel, def: structuredClone(d), media: m && m.bytes ? { [d.src]: bytesB64(m.bytes) } : {} };
}

function readClip(text) {
  try {
    const c = JSON.parse(text);
    return c && c[CLIP_TAG] && LIST_KINDS_BY_KIND.has(c.kind) ? c : null;
  } catch { return null; }
}
const LIST_KINDS_BY_KIND = new Set(Object.values(LIST_KINDS).map(k => k.kind));

// A sprite from a clip into this pack under `name`, its frames decoded.
async function addSprite(data, name, after) {
  const s = { ...structuredClone(data), id: uid(), name, frames: data.frames.map(f => ({ id: uid(), src: f.src, partId: f.partId })) };
  await Promise.all(s.frames.map(f => attachFrame(s, f)));
  const at = pack.sprites.indexOf(after);
  pack.sprites.splice(at >= 0 ? at + 1 : pack.sprites.length, 0, s);
  return s;
}

async function pasteClip(kind, clip) {
  if (!clip) { toast(`Copy ${kind === 'object' ? 'an object' : 'a ' + kind} first — Ctrl+C over the list`, true); return; }
  if (clip.kind !== kind) {
    toast(`The copy is a ${clip.kind} (${clip.name}) — paste it on the ${KIND_TAB[clip.kind]} tab`, true);
    return;
  }
  let name, also = '';
  if (kind === 'object') {
    const c = clip.object;
    const C = gameClass(c.cls);
    if (!C) { toast(`${clip.name} is a ${c.cls}, a class this game hasn't got`, true); return; }
    if (C.editor.player && pack.objects.some(o => o.cls === c.cls)) { toast('A pack has one worm — this one already has her', true); return; }
    name = nextName(clip.name, n => !!objectByName(n));
    markUndo();
    // the sprite it wears comes too, if this pack hasn't one of that name
    const want = refName(c.props.sprite);
    if (want && clip.sprite && !spriteByName(want)) {
      await addSprite(clip.sprite, want, null);
      also = ` and its sprite ${want}`;
    }
    const o = { id: uid(), name, cls: c.cls, code: [], props: structuredClone(c.props) };
    fillProps(o);
    setVariant(o, freeVariant(o.cls, o));
    const at = pack.objects.indexOf(currentObj);
    pack.objects.splice(at >= 0 ? at + 1 : pack.objects.length, 0, o);
    currentObj = o;
    renderGameObjects();
  } else if (kind === 'sprite') {
    name = nextName(clip.name, n => !!spriteByName(n));
    markUndo();
    current = await addSprite(clip.sprite, name, current);
    renderObjects();
  } else {
    name = freeId(clip.name.replace(/\d+$/, '') || clip.name);
    markUndo();
    // its recorded audio, if this pack hasn't that file
    for (const [path, b64] of Object.entries(clip.media || {})) {
      if (!pack.sounds.media[path]) { pack.sounds.media[path] = { bytes: b64Bytes(b64) }; also = ' and its audio'; }
    }
    pack.sounds.defs[name] = structuredClone(clip.def);
    sndSel = name;
    laySel = 0;
    useSounds();
    renderSounds();
  }
  savePack();
  toast(`Pasted ${kind}::${name}${also}, a copy of ${clip.name}`);
}

// Which list the keys are for, if any: the one under the pointer, or holding
// the focus, on the tab showing.
function hotList() {
  if ($('#paint').open || $('#ask').open) return null;
  const page = $('.page.on');
  const at = page && LIST_KINDS[page.dataset.page];
  if (!at) return null;
  const list = $(at.list);
  return list.matches(':hover') || list.contains(document.activeElement) ? at : null;
}
const typing = t => t && t.matches && t.matches('input,select,textarea');

// The keys only claim the list: nothing else on the tab acts on them (in
// capture, ahead of the tabs' own Ctrl+C/V), and the browser goes on to fire
// copy or paste, which carry the clipboard.
window.addEventListener('keydown', e => {
  if (typing(e.target) || e.altKey) return;
  // Delete over a list deletes its item — not the frames or layer it would
  // elsewhere on the tab
  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const at = hotList();
    if (!at) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const btn = $(KIND_DELETE[at.kind]);
    if (btn && !btn.disabled) {
      const was = at.kind === 'object' ? currentObj && currentObj.name : at.kind === 'sprite' ? current && current.name : sndSel;
      btn.click();
      // the list is drawn again: the focus goes to what is picked now, so
      // Delete can go on down the list
      const on = $(LIST_KINDS_FOCUS[at.kind]);
      if (on) on.focus();
      if (at.kind === 'sound' && was) toast(`Sound ${was} deleted — Ctrl+Z brings it back`);
    } else toast(`Pick ${at.kind === 'object' ? 'an object' : 'a ' + at.kind} first`, true);
    return;
  }
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
  const key = e.code || 'Key' + (e.key || '').toUpperCase();
  if ((key === 'KeyC' || key === 'KeyV') && hotList()) e.stopImmediatePropagation();
}, true);
const LIST_KINDS_FOCUS = { object: '#goList .item.on', sprite: '#objList .item.on', sound: '#sndList .item.on' };

window.addEventListener('copy', e => {
  const at = !typing(e.target) && hotList();
  if (!at) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const clip = makeClip(at.kind);
  if (!clip) { toast(`Pick ${at.kind === 'object' ? 'an object' : 'a ' + at.kind} first`, true); return; }
  listClip = clip;
  e.clipboardData.setData('text/plain', JSON.stringify(clip));
  toast(`Copied ${at.kind}::${clip.name} — Ctrl+V over a ${KIND_TAB[at.kind]} list pastes it, in this pack or another`);
}, true);

window.addEventListener('paste', e => {
  const at = !typing(e.target) && hotList();
  if (!at) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  // what is on the clipboard, if it is one of ours; else the last copy here
  const clip = readClip(e.clipboardData ? e.clipboardData.getData('text/plain') : '') || listClip;
  pasteClip(at.kind, clip);
}, true);
