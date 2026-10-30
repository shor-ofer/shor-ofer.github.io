// ---------- sounds ----------
// A def here is exactly what the game reads: a synthesized shape, a recorded
// one-shot, or a looping track. Previews go through the engine's own
// SoundBoard, so nothing can sound right here and wrong in the game.
//
// A synthesized def is a list of layers, and a layer is one of two things:
//
//   oscillator   a note at a pitch, optionally bending to another
//   noise        a burst of static under a lowpass that closes as it fades
//
// They share nothing but the def they sit in, so each carries its own volume,
// length, delay and shape.

const WAVES = ['square', 'sine', 'triangle', 'sawtooth'];
const WAVE_PATHS = {
  square: 'M1 10V2h6v8h6V2h6v8h6',
  sine: 'M1 6C4 -1 7 -1 10 6S16 13 19 6 24 0 25 3',
  triangle: 'M1 10L7 2l6 8 6-8 6 8',
  sawtooth: 'M1 10L9 2v8l8-8v8l8-8'
};

const TL_COLORS = ['#ffb547', '#ff6fae', '#6ff0c8', '#7cc4ff', '#c9a2ff'];
const FREQ_MIN = 20, FREQ_MAX = 8000;
const ROW = 34, PADX = 14, AXIS = 22;

const newOsc = (hz = 660) => ({ wave: 'square', sweep: [[hz, 0], [hz, 0.12]], gain: 0.2, attack: 0.005, decay: 0.12, delay: 0 });
const newNoise = () => ({ noise: { gain: 0.3, decay: 0.2, from: 3000, to: 300 }, delay: 0 });

const SOUND_PRESETS = {
  coin:   { layers: [{ wave: 'sine', sweep: [[880, 0], [1400, 0.08]], gain: 0.15, attack: 0.01, decay: 0.15, delay: 0 }], shake: 12 },
  jump:   { layers: [{ wave: 'square', sweep: [[220, 0], [880, 0.18]], gain: 0.2, attack: 0, decay: 0.2, delay: 0 }], shake: 15 },
  hurt:   { layers: [{ wave: 'sawtooth', sweep: [[220, 0], [60, 0.35]], gain: 0.2, attack: 0.02, decay: 0.4, delay: 0 }], shake: 120 },
  hit:    { layers: [{ wave: 'sawtooth', sweep: [[300, 0], [60, 0.18]], gain: 0.3, attack: 0, decay: 0.18, delay: 0 },
                     { noise: { gain: 0.25, decay: 0.12, from: 3000, to: 300 }, delay: 0 }], shake: 60 },
  explode:{ layers: [{ noise: { gain: 0.6, decay: 0.8, from: 2500, to: 60 }, delay: 0 },
                     { wave: 'sine', sweep: [[120, 0], [30, 0.6]], gain: 0.5, attack: 0, decay: 0.6, delay: 0 }], shake: 150 },
  blip:   { layers: [{ wave: 'square', sweep: [[988, 0], [988, 0.07]], gain: 0.2, attack: 0.005, decay: 0.07, delay: 0 }], shake: 20 }
};

let sndSel = null;        // which sound
let laySel = 0;           // which layer of it
let scopeNode = null;
const mediaUrls = new Map();      // path -> blob URL, runtime only

const defKind = d => !d ? 'synth' : d.loop ? 'track' : d.src ? 'clip' : 'synth';
const curDef = () => (sndSel ? pack.sounds.defs[sndSel] : null);
const isNoise = l => !!(l && l.noise && !l.wave);

// ---------- media ----------
function mediaUrl(path) {
  if (mediaUrls.has(path)) return mediaUrls.get(path);
  const m = pack.sounds.media[path];
  if (!m || !m.bytes || !m.bytes.length) return null;
  const url = URL.createObjectURL(new Blob([m.bytes], { type: path.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav' }));
  mediaUrls.set(path, url);
  return url;
}

function liveDefs() {
  const out = {};
  for (const [id, d] of Object.entries(pack.sounds.defs)) {
    out[id] = d && d.src ? { ...d, src: mediaUrl(d.src) || d.src } : d;
  }
  return out;
}

function useSounds() {
  sound.root = { defs: {} };
  sound.use({ defs: liveDefs() });
}

// ---------- layers ----------
// A def written before layers existed is one shape with its fields at the top,
// and a run of `notes` is that shape struck several times. Both become plain
// layers the first time the def is opened, which plays identically.
function ensureLayers(d) {
  if (!d || d.src || d.layers) return d && d.layers;
  const { shake, ...shape } = d;
  const layers = [];
  if (shape.notes) {
    const step = shape.step || 0;
    shape.notes.forEach((hz, i) => {
      const { notes, step: _s, ...rest } = shape;
      layers.push({ ...rest, sweep: [[hz, 0], [hz, rest.decay || 0.2]], delay: +(i * step).toFixed(3) });
    });
  } else if (shape.wave || shape.noise) {
    const { noise, ...osc } = shape;
    if (osc.wave) layers.push({ ...osc, sweep: osc.sweep || [[440, 0], [440, osc.decay || 0.2]], delay: 0 });
    if (noise) layers.push({ noise: { ...noise }, delay: 0 });
  }
  for (const k of Object.keys(d)) if (k !== 'shake') delete d[k];
  d.layers = layers.length ? layers : [newOsc()];
  if (shake !== undefined) d.shake = shake;
  return d.layers;
}

const layersOf = d => (d && !d.src ? (d.layers || []) : []);
const curLayer = () => layersOf(curDef())[laySel] || null;
const layerColor = k => TL_COLORS[k % TL_COLORS.length];
const layerName = (l, k) => `${isNoise(l) ? 'noise' : (l.wave || 'square')} ${k + 1}`;

// How long a layer sounds for, and where it sits.
const layerDur = l => (isNoise(l) ? l.noise.decay : ((l.notes ? (l.notes.length - 1) * (l.step || 0) : 0) + (l.decay || 0)));
const layerEnd = l => (l.delay || 0) + layerDur(l);

// The pitch a layer runs between, for drawing and for the start/end sliders.
const pitchAt = (l, k) => {
  if (isNoise(l)) return k ? (l.noise.to || l.noise.from) : l.noise.from;
  const s = l.sweep || [[440, 0], [440, 0]];
  return k ? s[s.length - 1][0] : s[0][0];
};
function setPitch(l, k, hz) {
  if (isNoise(l)) { if (k) l.noise.to = hz; else l.noise.from = hz; return; }
  if (!l.sweep) l.sweep = [[hz, 0], [hz, l.decay || 0.2]];
  else l.sweep[k ? l.sweep.length - 1 : 0][0] = hz;
}

// ---------- the sound list ----------
// Shown as one list, or grouped by kind (js/listview.js): synths made here,
// recorded clips, music tracks.
const SOUND_KINDS = ['synth', 'clip', 'track'];
const SOUND_KIND_LABEL = { synth: 'Synth', clip: 'Clip', track: 'Track' };
const sndListView = listView('assetEditorSounds', '#sndView', '#sndList', () => renderSoundList());

function renderSoundList() {
  const ids = Object.keys(pack.sounds.defs).sort();
  const kindOf = id => defKind(pack.sounds.defs[id]);
  sndListView.render(ids, {
    group: kindOf,
    order: k => SOUND_KINDS.indexOf(k),
    label: k => SOUND_KIND_LABEL[k] || k,
    picked: sndSel && pack.sounds.defs[sndSel] ? sndSel : null,
    empty: 'No sounds yet.',
    bad: id => soundProblems(id).length > 0,
    item: (id, grouped) => `<button class="item ${id === sndSel ? 'on' : ''}" data-sid="${esc(id)}"><b>${esc(id)}${warnBadge(soundProblems(id))}</b>${grouped ? '' : `<small>${kindOf(id)}</small>`}</button>`
  });
}

function renderSounds() {
  renderSoundList();
  renderSoundPanels();
}

$('#sndList').addEventListener('click', e => {
  const b = e.target.closest('[data-sid]');
  if (!b) return;
  sndSel = b.dataset.sid;
  laySel = 0;
  ensureLayers(curDef());
  renderSounds();
  playSelected();
});

// ---------- controls ----------
// Numbers are shown the way they are heard rather than the way they are
// stored: a tenth of a second reads as 100ms, a gain of .2 as 20%.
const show = (kind, v) =>
  kind === 'freq' ? Math.round(v) + ' Hz'
  : kind === 'sec' ? (v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s')
  : kind === 'ms' ? Math.round(v) + ' ms'
  : Math.round(v * 100) + '%';

// Pitch is heard by ratio, so its slider is logarithmic: one step near the
// bottom of the range has to be worth far fewer Hz than one near the top.
const toSlider = v => Math.round(Math.log(Math.max(FREQ_MIN, v) / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN) * 1000);
const fromSlider = s => Math.round(FREQ_MIN * (FREQ_MAX / FREQ_MIN) ** (s / 1000));

function ctl(label, key, kind, v, min, max, step) {
  const range = kind === 'freq'
    ? `min="0" max="1000" step="1" value="${toSlider(v)}"`
    : `min="${min}" max="${max}" step="${step}" value="${v}"`;
  return `<label class="ctl"><div class="row"><span>${label}</span><output>${show(kind, v)}</output></div>
    <input type="range" data-s="${key}" data-kind="${kind}" aria-valuetext="${show(kind, v)}" ${range}></label>`;
}

const ctlValue = input => input.dataset.kind === 'freq' ? fromSlider(+input.value) : +input.value;

function setCtlValue(input, v) {
  const text = show(input.dataset.kind, v);
  input.setAttribute('aria-valuetext', text);
  const out = input.parentElement.querySelector('output');
  if (out) out.textContent = text;
}

const waveSeg = l => `<div class="ctl"><span>Waveform</span><div class="seg" role="group" aria-label="Waveform">${
  WAVES.map(w => `<button data-s="wave" data-v="${w}" class="${l.wave === w ? 'on' : ''}">` +
    `<svg viewBox="0 0 26 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="${WAVE_PATHS[w]}"/></svg>${w}</button>`).join('')
  }</div></div>`;

// The objects whose sound properties name this one, each a way back to it.
function soundUsers(id) {
  return pack.objects.filter(o => Object.entries(classDefs(o.cls))
    .some(([k, d]) => d.type === 'sound' && refName(o.props[k]) === id));
}

function renderSoundUsers() {
  const users = sndSel ? soundUsers(sndSel) : [];
  $('#sndUsers').innerHTML = !sndSel ? '' : users.length
    ? 'Used by ' + users.map(u => `<button type="button" class="linkcode" data-goto="${u.id}" title="Open this object">${esc(u.cls)}::${esc(u.name)}</button>`).join(' ')
    : 'No object uses it yet.';
}

$('#sndUsers').addEventListener('click', e => {
  const go = e.target.closest('[data-goto]');
  if (!go) return;
  navJump();
  currentObj = pack.objects.find(o => o.id === go.dataset.goto) || currentObj;
  showTab('gameobjects');
  renderGameObjects();
});

// ---------- the panels ----------
function renderSoundPanels() {
  const d = curDef();
  ensureLayers(d);
  $('#sndTitle').textContent = sndSel || 'Nothing selected';
  renderSoundUsers();
  $('#sndDel').disabled = !sndSel;
  $('#sndPlay').disabled = !sndSel;
  $('#sndCopy').disabled = !sndSel;
  $('#sndPaste').disabled = !d || defKind(d) !== 'synth';

  const layers = layersOf(d);
  if (laySel >= layers.length) laySel = Math.max(0, layers.length - 1);

  renderChips(layers);
  renderLayer(d, layers);
  renderShared(d);
  $('#sndTlHint').textContent = layers.length
    ? 'Drag a layer to move it in time, or drag its right edge to change its length. The line inside each layer shows its pitch (or filter) sweep.'
    : '';
  drawTimeline();
}

function renderChips(layers) {
  $('#sndChips').innerHTML = layers.map((l, k) =>
    `<button class="chip ${k === laySel ? 'on' : ''}" data-lay="${k}"><i style="background:${layerColor(k)}"></i>${esc(layerName(l, k))}</button>`
  ).join('') || '<span class="empty">No layers</span>';
}

$('#sndChips').addEventListener('click', e => {
  const b = e.target.closest('[data-lay]');
  if (!b) return;
  laySel = +b.dataset.lay;
  renderSoundPanels();
});

// Only the chosen layer's own controls, and an oscillator and a burst of
// noise do not have the same ones.
function renderLayer(d, layers) {
  const box = $('#sndLayer');
  const l = layers[laySel];
  const kind = defKind(d);
  const synth = !!d && kind === 'synth';

  $('#layOsc').disabled = !synth;
  $('#layNoise').disabled = !synth;
  $('#laySolo').disabled = !l;
  $('#layDup').disabled = !l;
  $('#layDel').disabled = !l;

  if (!d) { box.innerHTML = '<p class="empty">Pick a sound, or make one.</p>'; return; }
  if (!synth) {
    box.innerHTML = `<label class="ctl"><span>File</span><input class="mono" value="${esc(d.src)}" readonly></label>`
      + (kind === 'clip'
        ? ctl('Volume', 'gain', 'pct', d.gain === undefined ? 1 : d.gain, 0, 1, 0.01)
        : '<p class="hint" style="grid-column:1/-1">A looping track. A level names it as its music.</p>');
    return;
  }
  if (!l) { box.innerHTML = '<p class="empty">No layers left — add an oscillator or some noise.</p>'; return; }

  if (isNoise(l)) {
    box.innerHTML =
        ctl('Filter start', 'from', 'freq', l.noise.from || 3000)
      + ctl('Filter end', 'to', 'freq', l.noise.to || 300)
      + ctl('Length', 'dur', 'sec', l.noise.decay, 0.01, 2, 0.005)
      + ctl('Volume', 'vol', 'pct', l.noise.gain, 0, 1, 0.01)
      + ctl('Delay', 'delay', 'sec', l.delay || 0, 0, 2, 0.005);
  } else {
    box.innerHTML = waveSeg(l)
      + ctl('Start pitch', 'from', 'freq', pitchAt(l, 0))
      + ctl('End pitch', 'to', 'freq', pitchAt(l, 1))
      + ctl('Length', 'dur', 'sec', l.decay || 0.1, 0.01, 2, 0.005)
      + ctl('Volume', 'vol', 'pct', l.gain === undefined ? 0.2 : l.gain, 0, 1, 0.01)
      + ctl('Delay', 'delay', 'sec', l.delay || 0, 0, 2, 0.005)
      + ctl('Attack', 'attack', 'sec', l.attack || 0.001, 0.001, 0.3, 0.001);
  }
}

// The little a def owns rather than any one layer of it.
function renderShared(d) {
  const box = $('#sndProps');
  if (!d) { box.innerHTML = '<p class="empty">Nothing selected.</p>'; return; }
  box.innerHTML = `<label class="ctl"><span>Id the game asks for</span><input data-s="id" value="${esc(sndSel)}"></label>`
    + ctl('Buzz the phone', 'shake', 'ms', d.shake || 0, 0, 200, 5)
    + '<p class="hint" style="grid-column:1/-1">Every sound in the game answers something the player just did, so it can shake the phone with it.</p>';
}

function edited(replay) {
  useSounds();
  savePack();
  renderSoundPanels();
  if (replay) playSelected();
}

// ---------- layer edits ----------
$('#sndLayer').addEventListener('input', e => {
  const k = e.target.dataset.s;
  const d = curDef();
  if (!k || !d) return;
  markUndo();
  const v = ctlValue(e.target);
  const l = curLayer();

  if (defKind(d) !== 'synth') { if (k === 'gain') d.gain = v; }
  else if (k === 'from') setPitch(l, 0, v);
  else if (k === 'to') setPitch(l, 1, v);
  else if (k === 'dur') {
    if (isNoise(l)) l.noise.decay = v;
    else {
      l.decay = v;
      // the bend has to end where the note does, or it would stop short
      if (l.sweep) l.sweep[l.sweep.length - 1][1] = v;
    }
  } else if (k === 'vol') { if (isNoise(l)) l.noise.gain = v; else l.gain = v; }
  else if (k === 'delay') l.delay = v;
  else if (k === 'attack') l.attack = v;
  else return;

  useSounds();
  savePack();
  setCtlValue(e.target, v);
  drawTimeline();
});

$('#sndLayer').addEventListener('click', e => {
  if (e.target.closest('[data-s=wave]') === null) return;
  const l = curLayer();
  if (!l || isNoise(l)) return;
  markUndo();
  l.wave = e.target.closest('[data-s=wave]').dataset.v;
  edited(true);
});

// ---------- adding and removing layers ----------
function addLayer(layer) {
  const d = curDef();
  if (!d || defKind(d) !== 'synth') return;
  markUndo();
  const layers = ensureLayers(d) || d.layers;
  layers.splice(laySel + 1, 0, layer);
  laySel = Math.min(laySel + 1, layers.length - 1);
  edited(true);
}

$('#layOsc').onclick = () => {
  const d = curDef();
  const layers = layersOf(d);
  // a new oscillator starts after what is already there, as the kit does
  const at = layers.length ? Math.max(...layers.map(layerEnd)) : 0;
  addLayer({ ...newOsc(), delay: at > 1.8 ? 0 : +at.toFixed(3) });
};
$('#layNoise').onclick = () => addLayer(newNoise());

$('#layDup').onclick = () => {
  const d = curDef();
  const l = curLayer();
  if (!d || !l) return;
  const copy = JSON.parse(JSON.stringify(l));
  copy.delay = Math.min(2, +((l.delay || 0) + layerDur(l)).toFixed(3));
  addLayer(copy);
};

$('#layDel').onclick = () => {
  const d = curDef();
  const layers = layersOf(d);
  if (!layers.length) return;
  markUndo();
  layers.splice(laySel, 1);
  laySel = Math.max(0, laySel - 1);
  edited(layers.length > 0);
  if (!layers.length) toast('That was the last layer — this sound makes no noise until you add one');
};

// ---------- copying a sound ----------
// Through the real clipboard, as the manifest text the game reads — so it can
// be pasted into a text editor, or into another sound here.

const soundJson = () => JSON.stringify({ [sndSel]: curDef() }, null, 2);

// Forgiving about what it is handed: a manifest fragment, a bare def, a list
// of layers, or a single layer.
function layersFromJson(text) {
  let data = JSON.parse(text);
  if (data && typeof data === 'object' && !Array.isArray(data)
      && !data.layers && !data.src && !data.wave && !data.noise) {
    const keys = Object.keys(data).filter(k => k !== '_comment');
    if (keys.length === 1 && data[keys[0]] && typeof data[keys[0]] === 'object') data = data[keys[0]];
  }
  if (data && data.src) throw new Error('that is a recorded file, not layers');
  const layers = Array.isArray(data) ? data
    : Array.isArray(data && data.layers) ? data.layers
    : (data && (data.wave || data.noise)) ? [data]
    : null;
  if (!layers || !layers.length) throw new Error('no layers in that');
  if (!layers.every(l => l && typeof l === 'object' && (l.wave || l.noise))) throw new Error('a layer must be an oscillator or noise');
  return layers;
}

function applyPastedSound(text) {
  const d = curDef();
  if (!d || defKind(d) !== 'synth') { toast('A recorded sound has no layers', true); return; }
  let layers;
  try { layers = layersFromJson(text); }
  catch (err) { toast('Could not read that: ' + err.message, true); return; }
  markUndo();
  d.layers = JSON.parse(JSON.stringify(layers));
  laySel = 0;
  edited(true);
  toast(`Pasted ${layers.length} layer${layers.length > 1 ? 's' : ''}`);
}

$('#sndCopy').onclick = async () => {
  if (!curDef()) return;
  const text = soundJson();
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${sndSel}`);
  } catch {
    // the clipboard can be refused; the text still has to be reachable
    await ask('Copy this sound', [
      { key: 'json', label: 'Select it all and copy', type: 'textarea', value: text }
    ], 'Done');
  }
};

$('#sndPaste').onclick = async () => {
  let text = null;
  try { text = await navigator.clipboard.readText(); } catch { /* asked for below */ }
  if (!text) {
    const got = await ask('Paste a sound', [
      { key: 'json', label: 'Paste the JSON here', type: 'textarea', value: '' },
      { type: 'note', label: 'Its layers replace the ones this sound has now.' }
    ], 'Paste');
    text = got && got.json;
  }
  if (text) applyPastedSound(text);
};

// Ctrl+C and Ctrl+V go through the browser's own copy and paste events, which
// reach the clipboard without asking permission.
const onSoundsTab = () => !!$('#sndChips').offsetParent;
const typingIn = t => t && t.matches && t.matches('input,textarea,select');

document.addEventListener('copy', e => {
  if (!onSoundsTab() || typingIn(e.target) || $('#paint').open || $('#ask').open) return;
  if (!curDef()) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', soundJson());
  toast(`Copied ${sndSel}`);
});

document.addEventListener('paste', e => {
  if (!onSoundsTab() || typingIn(e.target) || $('#paint').open || $('#ask').open) return;
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  applyPastedSound(text);
});

// Just this layer, so one of several can be judged on its own.
$('#laySolo').onclick = () => {
  const l = curLayer();
  if (!l) return;
  try {
    sound.resume();
    sound.defs.__solo = { layers: [{ ...JSON.parse(JSON.stringify(l)), delay: 0 }] };
    sound.play('__solo');
  } catch (err) { toast('No audio: ' + err.message, true); }
};

// ---------- whole-sound edits ----------
$('#sndProps').addEventListener('input', e => {
  const k = e.target.dataset.s;
  const d = curDef();
  if (!k || !d) return;
  if (k === 'id') {
    const id = e.target.value.trim();
    if (!id || (id !== sndSel && pack.sounds.defs[id])) return;
    const defs = {};
    for (const [key, def] of Object.entries(pack.sounds.defs)) defs[key === sndSel ? id : key] = def;
    pack.sounds.defs = defs;
    // the objects that name it follow it to its new name
    for (const o of soundUsers(sndSel)) {
      for (const [p, d] of Object.entries(classDefs(o.cls))) {
        if (d.type === 'sound' && refName(o.props[p]) === sndSel) o.props[p] = 'sound::' + id;
      }
    }
    sndSel = id;
    useSounds();              // the board plays by id, so it has to learn the new one
    // the field being typed in lives in this panel, so only the list redraws
    renderSoundList();
    $('#sndTitle').textContent = id;
    savePack();
    return;
  }
  if (k !== 'shake') return;
  markUndo();
  const v = ctlValue(e.target);
  d.shake = v || undefined;
  useSounds();
  savePack();
  setCtlValue(e.target, v);
});

// ---------- making and playing ----------
function freeId(base) {
  let id = base, n = 2;
  while (pack.sounds.defs[id]) id = base + n++;
  return id;
}

$('#sndAdd').onclick = () => {
  sndSel = freeId('sound');
  laySel = 0;
  pack.sounds.defs[sndSel] = { layers: [newOsc(988)], shake: 20 };
  useSounds();
  renderSounds();
  savePack();
  playSelected();
};

$('#sndPreset').onclick = async () => {
  const names = Object.keys(SOUND_PRESETS);
  const got = await ask('Start from a preset', [
    { key: 'which', label: 'Preset', type: 'select', options: names, value: names[0] }
  ], 'Add it');
  if (!got || !SOUND_PRESETS[got.which]) return;
  sndSel = freeId(got.which);
  laySel = 0;
  pack.sounds.defs[sndSel] = JSON.parse(JSON.stringify(SOUND_PRESETS[got.which]));
  useSounds();
  renderSounds();
  savePack();
  playSelected();
};

// A pack read in may already name recorded one-shots under clips/; those are
// kept and exported, but music is the only audio brought in here.
$('#sndMusic').onclick = async () => {
  const files = await pickFiles('audio/*', true);
  for (const file of files) {
    const name = slug(file.name.replace(/\.[^.]+$/, '')) || 'track';
    const ext = (file.name.match(/\.[^.]+$/) || ['.wav'])[0].toLowerCase();
    const path = `music/${name}${ext}`;
    pack.sounds.media[path] = { bytes: await readBytes(file) };
    mediaUrls.delete(path);
    const id = freeId(name);
    pack.sounds.defs[id] = { src: path, loop: true };
    sndSel = id;
    laySel = 0;
  }
  useSounds();
  renderSounds();
  savePack();
};

$('#sndDel').onclick = () => {
  if (!sndSel) return;
  markUndo();
  const d = pack.sounds.defs[sndSel];
  delete pack.sounds.defs[sndSel];
  // media nothing names any more is dropped with it, so the zip stays honest
  if (d && d.src && !Object.values(pack.sounds.defs).some(x => x && x.src === d.src)) {
    delete pack.sounds.media[d.src];
    mediaUrls.delete(d.src);
  }
  sndSel = Object.keys(pack.sounds.defs)[0] || null;
  laySel = 0;
  ensureLayers(curDef());
  useSounds();
  renderSounds();
  savePack();
};

let playStart = 0, playEnd = 0;
function playSelected() {
  if (!sndSel) return;
  const d = curDef();
  try {
    const ctx = sound.resume();
    if (!scopeNode) {
      scopeNode = ctx.createAnalyser();
      scopeNode.fftSize = 1024;
      sound.effectsGain.connect(scopeNode);
    }
    if (defKind(d) === 'track') {
      sound.setTrack(sndSel);
      sound.startMusic();
      return;
    }
    sound.musicEl.pause();
    sound.play(sndSel);
    playStart = ctx.currentTime;
    playEnd = playStart + endOf(layersOf(d));
  } catch (err) { toast('No audio: ' + err.message, true); }
}
$('#sndPlay').onclick = playSelected;

// ---------- the timeline ----------
// One bar per layer, at its delay and as long as it sounds, with its pitch
// (or filter) sweep drawn through it. Bars are dragged rather than typed —
// which is the whole point of seeing them.
const tl = $('#sndTl');
const tx = tl.getContext('2d');
let geom = { span: 1, w: 0 };
let dragging = null;

const endOf = layers => Math.max(0.1, ...layers.map(layerEnd));
function niceSpan(layers) {
  const e = endOf(layers) * 1.15;
  return [0.25, 0.5, 1, 1.5, 2, 3, 4].find(s => s >= e) || Math.ceil(e);
}
const xOf = t => PADX + t / geom.span * (geom.w - PADX * 2);
const tOf = x => (x - PADX) / (geom.w - PADX * 2) * geom.span;
const fY = (f, top, h) => {
  const n = Math.log(Math.max(FREQ_MIN, f) / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN);
  return top + h - 4 - n * (h - 8);
};

function roundRect(x, y, w, h, r) {
  tx.beginPath();
  tx.moveTo(x + r, y);
  tx.arcTo(x + w, y, x + w, y + h, r);
  tx.arcTo(x + w, y + h, x, y + h, r);
  tx.arcTo(x, y + h, x, y, r);
  tx.arcTo(x, y, x + w, y, r);
  tx.closePath();
}

function drawTimeline() {
  const d = curDef();
  const layers = layersOf(d);
  const dpr = devicePixelRatio || 1;
  const w = tl.clientWidth || 600;
  const h = AXIS + Math.max(1, layers.length) * ROW + 6;
  if (tl.width !== w * dpr || tl.height !== h * dpr) {
    tl.style.height = h + 'px';
    tl.width = w * dpr;
    tl.height = h * dpr;
  }
  tx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tx.clearRect(0, 0, w, h);
  if (!layers.length) {
    tx.fillStyle = '#a69cc9';
    tx.font = '12px ui-monospace, monospace';
    tx.textAlign = 'center';
    tx.fillText(!d ? 'Pick a sound.' : d.src ? 'A recorded file has no shape to draw.' : 'No layers left.', w / 2, h / 2);
    return;
  }
  if (!dragging) geom.span = niceSpan(layers);
  geom.w = w;

  const step = geom.span <= 0.5 ? 0.05 : geom.span <= 1.5 ? 0.1 : 0.25;
  tx.font = '11px ui-monospace, monospace';
  tx.textBaseline = 'middle';
  for (let t = 0, i = 0; t <= geom.span + 1e-9; t = +(t + step).toFixed(3), i++) {
    const x = xOf(t), major = i % (step === 0.25 ? 2 : 5) === 0;
    tx.strokeStyle = major ? '#3d3263' : '#2b2249';
    tx.lineWidth = 1;
    tx.beginPath(); tx.moveTo(x + .5, AXIS - 4); tx.lineTo(x + .5, h); tx.stroke();
    if (major) {
      tx.fillStyle = '#a69cc9';
      tx.textAlign = x < 30 ? 'left' : 'center';
      tx.fillText(Math.round(t * 1000) + 'ms', x, 9);
    }
  }

  layers.forEach((l, k) => {
    const top = AXIS + k * ROW + 3, bh = ROW - 6;
    const x0 = xOf(l.delay || 0), x1 = Math.max(x0 + 4, xOf(layerEnd(l)));
    const c = layerColor(k);
    const on = k === laySel;
    tx.globalAlpha = on ? 0.26 : 0.14;
    tx.fillStyle = c;
    roundRect(x0, top, x1 - x0, bh, 5); tx.fill();
    tx.globalAlpha = 1;
    tx.strokeStyle = c;
    tx.lineWidth = on ? 2 : 1;
    roundRect(x0 + .5, top + .5, x1 - x0 - 1, bh - 1, 5); tx.stroke();

    if (isNoise(l)) {
      tx.globalAlpha = .35;
      tx.fillStyle = c;
      for (let x = x0 + 3; x < x1 - 2; x += 3) {
        const j = (x - x0) / (x1 - x0);
        const spread = (1 - j) * bh * .45 * Math.min(1, l.noise.gain * 2);
        tx.fillRect(x, top + bh / 2 + (((x * 9301 + 49297) % 233280) / 233280 - .5) * spread * 2, 1.5, 1.5);
      }
      tx.globalAlpha = 1;
    }

    // the pitch, or for noise the filter, as it runs across the bar
    const from = pitchAt(l, 0), to = pitchAt(l, 1);
    tx.strokeStyle = c;
    tx.lineWidth = 2;
    tx.setLineDash(isNoise(l) ? [4, 3] : []);
    tx.beginPath();
    for (let s = 0; s <= 40; s++) {
      const j = s / 40;
      const f = from * (to / from) ** j;
      const x = x0 + j * (x1 - x0), y = fY(f, top, bh);
      s ? tx.lineTo(x, y) : tx.moveTo(x, y);
    }
    tx.stroke();
    tx.setLineDash([]);
    if (on) { tx.fillStyle = c; tx.fillRect(x1 - 4, top + bh / 2 - 7, 3, 14); }
  });

  if (sound.ctx && sound.ctx.currentTime < playEnd) {
    const x = xOf(sound.ctx.currentTime - playStart);
    tx.strokeStyle = '#efe9ff';
    tx.lineWidth = 1.5;
    tx.beginPath(); tx.moveTo(x, AXIS - 4); tx.lineTo(x, h); tx.stroke();
  }
}

function tlHit(e) {
  const layers = layersOf(curDef());
  const r = tl.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const k = Math.floor((y - AXIS) / ROW);
  const l = layers[k];
  if (!l) return null;
  const x0 = xOf(l.delay || 0), x1 = Math.max(x0 + 4, xOf(layerEnd(l)));
  if (x < x0 - 6 || x > x1 + 6) return { k, l, mode: null, x };
  return { k, l, mode: x > x1 - 8 ? 'resize' : 'move', x };
}

tl.addEventListener('pointermove', e => {
  if (dragging) {
    const r = tl.getBoundingClientRect();
    const dt = tOf(e.clientX - r.left) - tOf(dragging.x);
    const l = dragging.l;
    if (dragging.mode === 'move') l.delay = Math.max(0, Math.round((dragging.orig + dt) * 200) / 200);
    else {
      const dur = Math.min(2, Math.max(0.01, Math.round((dragging.orig + dt) * 200) / 200));
      if (isNoise(l)) l.noise.decay = dur;
      else { l.decay = dur; if (l.sweep) l.sweep[l.sweep.length - 1][1] = dur; }
    }
    useSounds();
    renderSoundPanels();
    return;
  }
  const h = tlHit(e);
  tl.style.cursor = !h || !h.mode ? 'default' : h.mode === 'resize' ? 'ew-resize' : 'grab';
});

tl.addEventListener('pointerdown', e => {
  const h = tlHit(e);
  if (!h) return;
  laySel = h.k;
  if (h.mode) {
    markUndo();
    dragging = { l: h.l, mode: h.mode, x: h.x, orig: h.mode === 'move' ? (h.l.delay || 0) : layerDur(h.l) };
    tl.setPointerCapture(e.pointerId);
    tl.style.cursor = h.mode === 'move' ? 'grabbing' : 'ew-resize';
  }
  renderSoundPanels();
});

const endDrag = () => {
  if (!dragging) return;
  dragging = null;
  savePack();
  renderSoundPanels();
  playSelected();
};
tl.addEventListener('pointerup', endDrag);
tl.addEventListener('pointercancel', endDrag);
addEventListener('resize', drawTimeline);

// Delete acts on the layer that is selected, which is the same thing the
// button under the inspector does. Copy and paste are the whole sound, and
// are handled by the browser's own clipboard events above.
document.addEventListener('keydown', e => {
  if ($('#paint').open || $('#ask').open || typingIn(e.target)) return;
  if (!onSoundsTab()) return;
  if (e.ctrlKey || e.metaKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); $('#layDel').click(); }
});

// the waveform as it actually leaves the board
let scopeBuf = null;
function scopeTick() {
  requestAnimationFrame(scopeTick);
  const cv = $('#sndScope');
  if (!cv.offsetParent) return;          // the sounds tab isn't showing
  const g = cv.getContext('2d');
  const w = cv.clientWidth || 600, h = 56;
  if (cv.width !== w) { cv.width = w; cv.height = h; }
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#3d3263';
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  if (scopeNode) {
    if (!scopeBuf || scopeBuf.length !== scopeNode.fftSize) scopeBuf = new Uint8Array(scopeNode.fftSize);
    scopeNode.getByteTimeDomainData(scopeBuf);
    g.strokeStyle = '#6ff0c8';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < scopeBuf.length; i++) {
      const x = i / scopeBuf.length * w, y = (scopeBuf[i] / 128 - 1) * (h / 2 - 3) + h / 2;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  // the playhead only moves while something is sounding
  if (sound.ctx && sound.ctx.currentTime < playEnd + 0.05) drawTimeline();
}
requestAnimationFrame(scopeTick);
