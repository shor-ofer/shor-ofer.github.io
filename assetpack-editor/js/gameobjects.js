// ---------- objects ----------
// What a level places: one of the game's classes, the 2-char codes a map
// block names it by, and a value for each property the class reads. The class
// list and each form come from the game itself — GAME_CLASSES in
// src/js/classes.js, and each class's `editor` block — so a class added to the
// game shows up here with its own form and nothing in this file changes.

let currentObj = null;

const classLabel = C => C.name;

function renderGameObjects() {
  renderGoList();
  renderGoForm();
}

// Two ways to show the list (js/listview.js): every object in one list, or
// grouped by class, each class opened and closed on its own.
const goList = listView('assetEditorObjects', '#goView', '#goList', () => renderGoList());

function renderGoList() {
  const probs = new Map(pack.objects.map(o => [o, objectProblems(o)]));
  const isBad = o => probs.get(o).length > 0;
  // grouped by class, then by name within it — the order in the pack is left alone
  const sorted = [...pack.objects].sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
  goList.render(sorted, {
    group: o => o.cls,
    picked: currentObj,
    bad: isBad,
    empty: 'No objects yet.',
    // in a group the class goes without saying, so an item shows its code
    item: (o, grouped) => `<button class="item ${o === currentObj ? 'on' : ''}" data-goid="${o.id}">
      <b>${objectIcon(o)}${esc(o.name)}${warnBadge(probs.get(o))}</b><small class="${isBad(o) ? 'warn' : ''}">${esc(grouped ? o.code[0] || '—' : o.cls)}</small>
    </button>`
  });
  paintIcons($('#goList'));
}

// ---------- the form ----------
// The code is not chosen: the class fixes its first two characters and the
// object is given the first third character its class has free, so this only
// says what a map block writes and why.
function codeLine(o, C) {
  const v = variantOf(o);
  const siblings = pack.objects.filter(x => x.cls === o.cls);
  const codes = o.code.map(c => `<code class="bigcode">${esc(c)}</code>`).join(' ');
  if (!C) return codes;
  const id = C.takesId
    ? ` In a level its first character is the ${C.editor.label.toLowerCase()}'s ${esc(C.digitMeaning)}: ${esc(C.codes[0].replace('n', '3') + v)} gives 3.`
    : '';
  const which = siblings.length > 1
    ? ` The last character, ${esc(v)}, is which of the pack's ${siblings.length} ${esc(o.cls)} objects this is.`
    : ` The last character, ${esc(v)}, tells it apart from any other ${esc(o.cls)} the pack gets.`;
  return `${codes}<span class="hint">${esc(C.codes.join(' '))} is ${esc(C.name)}'s.${which}${id}</span>`;
}

// The value a list's "+ New…" entry carries: never a real name.
const NEW_ONE = '+new';      // a name no sound or sprite can have

// ---------- the properties, Blender-style ----------
// Each class says where its properties go (src/js/entity.js): a panel per
// `group`, folding away; in each, a line per property — its `short` label on
// the left, its field on the right, ↺ at the end once it differs from the
// default — and the properties that `join` the one before stacked onto it as
// one block, as Blender stacks X, Y and Z.
const sameValue = (a, b) => (typeof a === 'number' || typeof b === 'number') ? Number(a) === Number(b) : String(a ?? '') === String(b ?? '');
const shownValue = (d, v) => d.percent ? `${+(Number(v) * 100).toFixed(2)} %` : `${v === '' ? 'none' : refName(String(v))}${d.unit ? ' ' + d.unit : ''}`;

// The panels the open fold-state is kept in, by group name, for this browser.
const PANEL_SHUT_KEY = 'assetEditorShutPanels';
let shutPanels = new Set();
try { shutPanels = new Set(JSON.parse(localStorage.getItem(PANEL_SHUT_KEY) || '[]')); } catch { /* all open */ }

function propPanels(o) {
  const C = gameClass(o.cls);
  const defs = classDefs(o.cls);
  const groups = new Map((C ? C.propGroups() : ['Properties']).map(g => [g, []]));
  for (const [k, d] of Object.entries(defs)) {
    const g = d.group || 'Properties';
    (groups.get(g) || groups.set(g, []).get(g)).push([k, d]);
  }
  return [...groups].filter(([, list]) => list.length).map(([g, list]) => {
    // a line, and those joined onto it, are one block
    const blocks = [];
    for (const kd of list) {
      if (kd[1].join && blocks.length) blocks[blocks.length - 1].push(kd);
      else blocks.push([kd]);
    }
    return `<details class="ppanel" data-pgroup="${esc(g)}" ${shutPanels.has(g) ? '' : 'open'}><summary>${esc(g)}</summary>
      ${blocks.map(b => `<div class="pblock${b.length > 1 ? ' joined' : ''}">${b.map(([k, d]) => propLine(o, k, d)).join('')}</div>`).join('')}
    </details>`;
  }).join('');
}

// One property's line: label, field, ↺.
function propLine(o, k, d) {
  const v = o.props[k];
  // a property naming something the pack hasn't got wears the mark too
  const prob = k === 'sprite'
    ? (objectProblems(o).find(p => p.startsWith('its sprite')) || null)
    : propProblem(o, k, d);
  const hasDefault = d.default !== undefined && !(d.default === '' && ['sprite', 'part'].includes(d.type));
  const changed = hasDefault && !sameValue(v, d.default);
  const tip = [d.label || k, k, hasDefault ? 'default ' + shownValue(d, d.default) : '', d.optional ? 'optional' : ''].filter(Boolean).join(' · ');
  const label = d.type === 'bool' ? '' : esc(d.short || d.label || k);
  return `<div class="pline" title="${esc(tip)}">
    <span class="plabel">${label}${warnBadge(prob && [prob])}</span>
    <div class="pfield">${propField(o, k, d)}</div>
    <button type="button" class="preset" data-reset="${k}" title="Back to the default: ${esc(hasDefault ? shownValue(d, d.default) : '')}" aria-label="Reset" ${changed ? '' : 'hidden'}>↺</button>
  </div>`;
}

// The field alone, by the property's declared type.
function propField(o, k, d) {
  const v = o.props[k];
  const options = (list, prefix) => {
    const vals = list.map(n => prefix + n);
    if (v && !vals.includes(v)) vals.unshift(v);            // keep what it says, even if it's gone
    // the value keeps its kind in front (sound::coin); the label is just the name
    return ['', ...vals].map(x => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${x ? esc(refName(x)) + (list.includes(refName(x)) ? '' : ' — missing') : '— none'}</option>`).join('');
  };
  // what names something: its picker full width, then ↗ to open it (as a
  // double-click on the picker does too); a sound has ▶ to hear it as well
  const openBtn = `<button type="button" class="btn sm refopen" data-open="${k}" title="Open it" aria-label="Open it" ${v ? '' : 'disabled'}>↗</button>`;
  const refRow = (picker, extra = '') => `<div class="refrow">${picker}${extra}${openBtn}</div>`;
  // a number with its unit inside, a share as a percentage
  const num = step => {
    const shown = d.percent ? +(Number(v) * 100).toFixed(2) : v;
    const unit = d.percent ? '%' : (d.unit || '');
    return `<div class="pnum${unit ? ' hasunit' : ''}"><input type="number" step="${d.percent ? 'any' : step}" data-prop="${k}" ${d.percent ? 'data-pct="1"' : ''} value="${esc(shown)}">${unit ? `<span class="u">${esc(unit)}</span>` : ''}</div>`;
  };
  switch (d.type) {
    case 'int': return num(1);
    case 'float': return num('any');
    case 'bool': return `<label class="toggle"><input type="checkbox" data-prop="${k}" ${v ? 'checked' : ''}> ${esc(d.short || d.label || k)}</label>`;
    case 'color': return `<input type="color" data-prop="${k}" value="${esc(v || '#ffffff')}">`;
    case 'choice': return `<select data-prop="${k}">${(d.options || []).map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    case 'sound':
      // its list starts with a new one and none, then the pack's sounds
      return refRow(`<select data-prop="${k}" data-ref="${k}" title="Pick a sound — or none, or a new one made from this one">${options(Object.keys(pack.sounds.defs), 'sound::')
        .replace('<option value="" ', `<option value="${NEW_ONE}">+ New sound…</option><option value="" `)}</select>`,
        `<button type="button" class="btn sm refopen" data-play="${k}" title="Play it" aria-label="Play" ${v ? '' : 'disabled'}>▶</button>`);
    case 'sprite': {
      // a picker of its own rather than a <select>, which can't show the icons
      const cur = refName(v);
      const missing = v && !spriteByName(cur) ? ' — missing' : '';
      return refRow(`<div class="sprpick">
        <button type="button" class="sprbtn" data-sprbtn="${k}" data-ref="${k}" aria-haspopup="listbox" title="Pick a sprite — or none, or a new one">${spriteIcon(cur)}<span class="nm">${esc(cur || '— none')}${missing}</span><span class="caret">▾</span></button>
      </div>`);
    }
    case 'background': return refRow(`<select data-prop="${k}" data-ref="${k}">${options(pack.backgrounds.map(b => b.name), 'background::')}</select>`);
    case 'object': {
      // another of the pack's objects, of the class the property wants
      const of = pack.objects.filter(x => x !== o && (!d.class || x.cls === d.class)).map(x => x.name).sort();
      return refRow(`<select data-prop="${k}" data-ref="${k}">${options(of, 'object::')}</select>`);
    }
    case 'part': {
      // a picker like the sprite's, each part shown by its first frame
      const sn = refName(o.props.sprite), s = spriteByName(sn);
      const missing = v && !(s && s.parts.some(p => p.name === v)) ? ' — missing' : '';
      return refRow(`<div class="sprpick">
        <button type="button" class="sprbtn" data-partbtn="${k}" data-ref="${k}" aria-haspopup="listbox" title="Pick a part">${v ? partIcon(sn, v) : ''}<span class="nm">${esc(v || '— none')}${missing}</span><span class="caret">▾</span></button>
      </div>`);
    }
    default: return `<input data-prop="${k}" value="${esc(v ?? '')}">`;
  }
}

function renderGoForm() {
  const o = currentObj;
  const box = $('#goForm');
  if (!o) {
    $('#goTitle').textContent = 'Object';
    box.innerHTML = '<p class="empty">Pick an object, or make one.</p>';
    drawGoPreview();
    return;
  }
  const C = gameClass(o.cls);
  const defs = classDefs(o.cls);
  const problems = objectProblems(o);
  $('#goTitle').textContent = `${o.cls}::${o.name}`;
  box.innerHTML = `
    <div class="insp">
      <label class="ctl"><span>Name</span><input data-g="name" value="${esc(o.name)}" spellcheck="false"></label>
      <label class="ctl"><span>Class</span><select data-g="cls">
        ${C ? '' : `<option selected>${esc(o.cls)} — not in the game</option>`}
        ${GAME_CLASSES.map(K => `<option value="${K.name}" ${K.name === o.cls ? 'selected' : ''}>${esc(classLabel(K))}</option>`).join('')}
      </select></label>
      ${C && !C.codes.length ? `<p class="hint" style="grid-column:1/-1">No map block places ${esc(C.editor.label.toLowerCase())}: ${C.editor.player
        ? 'she is the player, and a level says only where she starts. The game takes the one Worm object in the pack.'
        : 'the game makes it itself.'}</p>` : `
      <div class="ctl" style="grid-column:1/-1"><span>${o.code.length > 1 ? 'Codes' : 'Code'} — what a map block writes to place it</span>
        <div class="codes">${codeLine(o, C)}</div>
      </div>`}
    </div>
    <h3 class="subh">${esc(o.cls)} properties</h3>
    <div class="ppanels">${propPanels(o)}</div>
    ${problems.length ? `<ul class="hint probs">${[
      ...problems
    ].map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    <div class="row gap" style="margin-top:12px">
      ${C && C.editor.player ? '' : `<button class="btn sm" data-g="duplicate" title="A copy of this object, with all its property values, under a new name and the next free code">⧉ Duplicate</button>`}
      <button class="btn sm danger" data-g="delete">Delete this object</button></div>`;
  paintIcons(box);
  fitPropPanels();
  drawGoPreview();
}

// The object's form scrolls as one in the middle panel, which runs from
// where it starts to the bottom of the window.
function fitPropPanels() {
  const f = $('#goForm');
  if (!f || !f.offsetParent) return;
  const top = f.getBoundingClientRect().top + window.scrollY;
  f.style.maxHeight = Math.max(240, window.innerHeight - top - 18) + 'px';
}
addEventListener('resize', fitPropPanels);

// The sprite it wears, as the game would show it: the part a property picks
// if it has one (a plant's bud), its first frame otherwise.
function drawGoPreview() {
  const cv = $('#goPv');
  const o = currentObj;
  stopParticlePreview();
  cv.style.width = cv.style.height = '';
  if (o && o.cls === 'ParticleSystem') { startParticlePreview(o); return; }
  const s = o && spriteByName(refName(o.props.sprite));
  const C = o && gameClass(o.cls);
  if (!s || !s.frames.length) {
    cv.width = cv.height = 1;
    $('#goAbout').textContent = o ? 'No sprite to show yet — pick one below.' : '';
    return;
  }
  const partProp = Object.entries(classDefs(o.cls)).find(([, d]) => d.type === 'part');
  const part = partProp && s.parts.find(p => p.name === o.props[partProp[0]]);
  const frame = (part && framesOfPart(s, part.id)[0]) || bodyFrames(s)[0] || s.frames[0];
  const z = Math.max(1, Math.min(8, Math.floor(200 / Math.max(s.fw, s.fh))));
  cv.width = s.fw * z;
  cv.height = s.fh * z;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(frameCanvas(s, frame), 0, 0, cv.width, cv.height);
  const base = C && Object.getPrototypeOf(C);
  $('#goAbout').textContent = C
    ? `${s.name}${part ? ' · ' + part.name : ''} · ${C.name}${base && base !== Entity ? ' is a ' + base.name : ''} · stands at ${C.cellAnchor.map(n => n * 100 + '%').join(', ')} of its cell`
    : s.name;
}

// A particle system is shown running: streaming if it streams, otherwise
// bursting over and over, so a change to any property shows at once. It stops
// when the tab is left and starts again when it is drawn. It is drawn at the
// size the game shows it on a desktop screen — PREVIEW_GAME_PX screen pixels
// a game unit, the game's ART_SCALE — over a faint grid of its tiles.
const PREVIEW_GAME_PX = 2;
let particlePv = null;

function stopParticlePreview() {
  if (particlePv) cancelAnimationFrame(particlePv.raf);
  particlePv = null;
}

function startParticlePreview(o) {
  const cv = $('#goPv'), stage = $('#goStage');
  // in game units, as much as the stage has room for at the game's scale
  const room = stage.clientWidth - parseFloat(getComputedStyle(stage).paddingLeft) * 2;
  const W = Math.max(TILE * 2, Math.min(TILE * 6, Math.floor(room / PREVIEW_GAME_PX))), H = TILE * 4;
  const k = PREVIEW_GAME_PX * (window.devicePixelRatio || 1);
  cv.width = Math.round(W * k);
  cv.height = Math.round(H * k);
  cv.style.width = W * PREVIEW_GAME_PX + 'px';
  cv.style.height = H * PREVIEW_GAME_PX + 'px';
  const g = cv.getContext('2d');
  const p = o.props;
  const cloud = new ParticleCloud(p, Math.round(W / 2), Math.round(H * 0.55));
  const s = spriteByName(refName(p.sprite));
  const fr = s && s.frames.length && frameCanvas(s, s.frames[0]);
  const art = fr ? { size: Math.max(s.fw, s.fh), draw: g2 => g2.drawImage(fr, -s.fw / 2, -s.fh / 2) } : null;
  const run = { raf: 0 };
  const tick = () => {
    if (particlePv !== run) return;
    if (!cv.isConnected || !cv.offsetParent) { particlePv = null; return; }   // the tab was left
    // as it does placed in a level; one that only bursts when named, every second
    if (p.rate > 0 || p.interval > 0) cloud.run();
    else if (cloud.wait-- <= 0) { cloud.wait = 59; cloud.emit(p.count); }
    cloud.step();
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#151922';
    g.fillRect(0, 0, W, H);
    // the tiles, for size, and where it stands: the point it throws from
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1 / k;
    g.beginPath();
    for (let x = (cloud.x % TILE); x < W; x += TILE) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = (cloud.y % TILE); y < H; y += TILE) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.moveTo(cloud.x - 4, cloud.y); g.lineTo(cloud.x + 4, cloud.y);
    g.moveTo(cloud.x, cloud.y - 4); g.lineTo(cloud.x, cloud.y + 4);
    g.stroke();
    cloud.paint(g, art);
    run.raf = requestAnimationFrame(tick);
  };
  particlePv = run;
  tick();
  const named = `bursts ${p.count} when another object names it (a coin's takeParticles, a rock's breakParticles)`;
  $('#goAbout').textContent = p.rate > 0 ? `Placed in a level it streams ${p.rate} a frame; it ${named}`
    : p.interval > 0 ? `Placed in a level it bursts ${p.count} every ${p.interval} frames; it also ${named}`
    : `Placed in a level it shows nothing (no rate, no interval); it ${named} — shown here once a second`;
}

// ---------- editing ----------
$('#goList').addEventListener('click', e => {
  const b = e.target.closest('[data-goid]');
  if (!b) return;
  currentObj = pack.objects.find(o => o.id === b.dataset.goid) || null;
  renderGameObjects();
});

// Names are keys in objects.json, so they keep to letters, digits, _ and -.
const objName = s => String(s).trim().replace(/[^A-Za-z0-9_-]+/g, '');

function setProp(o, k, v) {
  const d = classDefs(o.cls)[k] || {};
  markUndo();
  o.props[k] = v;
  // a new sprite has other parts to choose from, and its own icon
  // a picker's button shows what it holds, so it is drawn again
  if (['sprite', 'part', 'object', 'sound', 'background'].includes(d.type)) renderGoForm(); else drawGoPreview();
  renderGoList();
  savePack();
}

$('#goForm').addEventListener('input', e => {
  const o = currentObj;
  if (!o) return;
  const k = e.target.dataset.prop;
  if (k && e.target.value === NEW_ONE) {
    e.target.value = o.props[k] || '';      // the list shows what it is until the new one is
    newSoundFor(o, k);
    return;
  }
  if (k) {
    const d = classDefs(o.cls)[k] || {};
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.dataset.pct) { v = parseFloat(v) / 100; if (!Number.isFinite(v)) return; }
    else if (d.type === 'int') { v = parseInt(v, 10); if (!Number.isFinite(v)) return; }
    else if (d.type === 'float') { v = parseFloat(v); if (!Number.isFinite(v)) return; }
    setProp(o, k, v);
    const reset = e.target.closest('.pline') && e.target.closest('.pline').querySelector('[data-reset]');
    if (reset && d.default !== undefined) reset.hidden = sameValue(o.props[k], d.default);
    return;
  }
  if (e.target.dataset.g === 'name') {
    markUndo();
    const was = o.name;
    o.name = objName(e.target.value) || o.name;
    // whatever names it (a coin's takeParticles) follows it to its new name
    if (o.name !== was) for (const x of pack.objects) for (const [k, v] of Object.entries(x.props)) {
      if (v === 'object::' + was) x.props[k] = 'object::' + o.name;
    }
    $('#goTitle').textContent = `${o.cls}::${o.name}`;
    renderGoList();
    savePack();
  }
});

$('#goForm').addEventListener('change', e => {
  const o = currentObj;
  if (!o) return;
  if (e.target.dataset.g === 'name') { e.target.value = o.name; return; }
  if (e.target.dataset.g === 'cls') {
    markUndo();
    o.cls = e.target.value;
    fillProps(o);                                   // what still applies is kept
    setVariant(o, freeVariant(o.cls, o));           // and the new class's code
    renderGameObjects();
    savePack();
  }
});

// A new sprite for this object, named after it — coin3's is sprite::coin3, a
// second sprite property's coin3Worn — worn at once and opened on the Sprites
// tab to be drawn. One undo takes the lot back.
async function newSpriteFor(o, k) {
  const base = k === 'sprite' ? o.name : o.name + k[0].toUpperCase() + k.slice(1);
  let name = base, n = 2;
  while (spriteByName(name)) name = base + n++;
  const s = await askNewSprite(name);
  if (!s) return;
  navJump();
  name = s.name;
  markUndo();
  pack.sprites.push(s);
  o.props[k] = 'sprite::' + name;
  current = s;
  showTab('objects');
  renderObjects();
  renderGoList();
  savePack();
  toast(`Made sprite::${name} for ${o.name} — add its frames`);
}

// A new sound for this object, named after it and what the property is for —
// coin2's pickSound is coin2Pick, a beetle's stompSound beetleStomp. It starts
// as a copy of the sound the property had, so it is a variant to tweak rather
// than a blank beep, and opens on the Sounds tab. One undo takes it back.
function newSoundFor(o, k) {
  navJump();
  const what = k === 'sound' ? '' : k.replace(/Sound$/, '');
  const base = o.name + (what ? what[0].toUpperCase() + what.slice(1) : '');
  const id = freeId(base);
  const from = refName(o.props[k]);
  const was = pack.sounds.defs[from];
  markUndo();
  pack.sounds.defs[id] = was ? structuredClone(was) : { layers: [newOsc(988)], shake: 20 };
  o.props[k] = 'sound::' + id;
  sndSel = id;
  laySel = 0;
  useSounds();
  showTab('sounds');
  renderGoForm();
  savePack();
  toast(was ? `Made sound::${id}, a copy of sound::${from} to change` : `Made sound::${id}`);
}

// A sprite on the Sprites tab, chosen there as if clicked in its list.
function openSprite(name) {
  const s = spriteByName(name);
  if (!s) { toast(name ? `There is no sprite called ${name}` : 'No sprite picked yet', true); return; }
  closeSpritePicker();
  current = s;
  showTab('objects');
  renderObjects();
  const item = $(`#objList [data-oid="${s.id}"]`);
  if (item) item.scrollIntoView({ block: 'nearest' });
}

// Double-click a sprite picker to go to the sprite it holds; a part picker
// goes to the object's own sprite, where its parts are.
// 'toggle' doesn't bubble, so it is caught on the way down
$('#goForm').addEventListener('toggle', e => {
  const d = e.target.closest && e.target.closest('.ppanel');
  if (!d) return;
  if (d.open) shutPanels.delete(d.dataset.pgroup); else shutPanels.add(d.dataset.pgroup);
  try { localStorage.setItem(PANEL_SHUT_KEY, JSON.stringify([...shutPanels])); } catch { /* not kept */ }
}, true);

// What a property names, opened where it is made: a sprite (or the sprite a
// part is of) on the Sprites tab, a sound on the Sounds tab, an object here,
// a background on its tab.
function openRef(o, k) {
  const d = classDefs(o.cls)[k] || {};
  const v = o.props[k];
  if (!v) return;
  closeSpritePicker();
  navJump();                 // ← Back comes here
  if (d.type === 'sprite') openSprite(refName(v));
  else if (d.type === 'part') openSprite(refName(o.props.sprite));
  else if (d.type === 'sound') {
    if (!pack.sounds.defs[refName(v)]) { toast(`There is no sound called ${refName(v)}`, true); return; }
    sndSel = refName(v);
    laySel = 0;
    showTab('sounds');
  } else if (d.type === 'object') {
    const to = objectByName(refName(v));
    if (!to) { toast(`There is no object called ${refName(v)}`, true); return; }
    currentObj = to;
    renderGameObjects();
  } else if (d.type === 'background') showTab('backgrounds');
}

// a double-click on any picker opens what it names, as its ↗ does
$('#goForm').addEventListener('dblclick', e => {
  const o = currentObj;
  const r = o && e.target.closest('[data-ref]');
  if (!r) return;
  e.preventDefault();
  openRef(o, r.dataset.ref);
});

// The sprite picker's list: every sprite with its icon, the current one marked.
function closeSpritePicker() { $$('.sprlist').forEach(l => l.remove()); }

function openSpritePicker(btn) {
  const o = currentObj;
  const k = btn.dataset.sprbtn;
  const cur = refName(o.props[k]);
  closeSpritePicker();
  const list = document.createElement('div');
  list.className = 'sprlist';
  list.setAttribute('role', 'listbox');
  // first a new one and none, then the pack's sprites
  list.innerHTML = [
    `<button type="button" role="option" class="spropt spronew" data-newsprite="${k}"><span>+ New sprite…</span></button>`,
    `<button type="button" role="option" class="spropt ${!cur ? 'on' : ''}" data-sprset="${k}" data-v="" aria-selected="${!cur}"><span>— none</span></button>`,
    ...pack.sprites.map(s => `
    <button type="button" role="option" class="spropt ${s.name === cur ? 'on' : ''}" data-sprset="${k}" data-v="sprite::${esc(s.name)}"
      aria-selected="${s.name === cur}">${spriteIcon(s.name)}<span>${esc(s.name)}</span></button>`)
  ].join('');
  btn.parentElement.appendChild(list);
  paintIcons(list);
  const focus = list.querySelector('.on') || list.querySelector('button');
  if (focus) focus.focus();
}

// The same list for a part prop: the parts of the object's sprite.
function openPartPicker(btn) {
  const o = currentObj;
  const k = btn.dataset.partbtn;
  const cur = o.props[k] || '';
  const sn = refName(o.props.sprite), s = spriteByName(sn);
  closeSpritePicker();
  const list = document.createElement('div');
  list.className = 'sprlist';
  list.setAttribute('role', 'listbox');
  const parts = s ? s.parts.filter(p => !p.glow) : [];
  list.innerHTML = [
    `<button type="button" role="option" class="spropt ${!cur ? 'on' : ''}" data-sprset="${k}" data-v="" aria-selected="${!cur}"><span>—</span></button>`,
    ...parts.map(p => `
    <button type="button" role="option" class="spropt ${p.name === cur ? 'on' : ''}" data-sprset="${k}" data-v="${esc(p.name)}"
      aria-selected="${p.name === cur}">${partIcon(sn, p.name)}<span>${esc(p.name)}</span><small>${framesOfPart(s, p.id).length} fr</small></button>`)
  ].join('') + (parts.length ? '' : '<p class="empty">Its sprite has no parts — pick a sprite first.</p>');
  btn.parentElement.appendChild(list);
  paintIcons(list);
  const focus = list.querySelector('.on') || list.querySelector('button');
  if (focus) focus.focus();
}

document.addEventListener('click', e => { if (!e.target.closest('.sprpick')) closeSpritePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSpritePicker(); });

$('#goForm').addEventListener('click', e => {
  const o = currentObj;
  if (!o) return;
  const sb = e.target.closest('[data-sprbtn]');
  if (sb) {
    if ($('.sprlist')) closeSpritePicker(); else openSpritePicker(sb);
    return;
  }
  const pb = e.target.closest('[data-partbtn]');
  if (pb) {
    const open = pb.parentElement.querySelector('.sprlist');
    closeSpritePicker();
    if (!open) openPartPicker(pb);
    return;
  }
  const opt = e.target.closest('[data-sprset]');
  if (opt) { closeSpritePicker(); setProp(o, opt.dataset.sprset, opt.dataset.v); return; }
  const ns = e.target.closest('[data-newsprite]');
  if (ns) { closeSpritePicker(); newSpriteFor(o, ns.dataset.newsprite); return; }
  const nd = e.target.closest('[data-newsound]');
  if (nd) { newSoundFor(o, nd.dataset.newsound); return; }
  const rs = e.target.closest('[data-reset]');
  if (rs) {
    const d = classDefs(o.cls)[rs.dataset.reset] || {};
    setProp(o, rs.dataset.reset, d.default);
    renderGoForm();
    return;
  }
  const op = e.target.closest('[data-open]');
  if (op) { openRef(o, op.dataset.open); return; }
  const play = e.target.closest('[data-play]');
  if (play) { sound.play(o.props[play.dataset.play]); return; }
  const g = e.target.dataset.g;
  if (g === 'duplicate') {
    // coin → coin2, or the next number free; coin2 → coin3
    const stem = o.name.replace(/\d+$/, '');
    let n = 2, name;
    do name = stem + n++; while (objectByName(name));
    markUndo();
    const copy = { id: uid(), name, cls: o.cls, code: [], props: JSON.parse(JSON.stringify(o.props)) };
    setVariant(copy, freeVariant(copy.cls, copy));
    pack.objects.splice(pack.objects.indexOf(o) + 1, 0, copy);
    currentObj = copy;
    renderGameObjects();
    savePack();
    toast(`Made ${name}, a copy of ${o.name}${copy.code.length ? ' — its code is ' + copy.code.join(' ') : ''}`);
    return;
  }
  if (g === 'delete') {
    markUndo();
    const at = pack.objects.indexOf(o);
    pack.objects.splice(at, 1);
    currentObj = pack.objects[at] || pack.objects[at - 1] || null;
    renderGameObjects();
    savePack();
    toast('Object deleted — Ctrl+Z brings it back');
  }
});

// A new object starts from a class, then a name; its sprite is the one of the
// same name if there is one, and its code its class's, with the first third
// character the class has free.
$('#goAdd').onclick = async () => {
  if (!GAME_CLASSES.length) { toast('The game offers no classes', true); return; }
  const labels = GAME_CLASSES.map(classLabel);
  const got = await ask('New object', [
    { key: 'cls', label: 'Class — what it does in the game', type: 'select', options: labels, value: labels[0] },
    { key: 'name', label: 'Name', value: '' },
    { type: 'note', label: 'Its code comes from the class, and its properties too; set them once it is made.' }
  ], 'Make it');
  if (!got) return;
  const C = GAME_CLASSES[labels.indexOf(got.cls)];
  let name = objName(got.name) || C.name.toLowerCase();
  const base = name;
  let n = 2;
  while (objectByName(name)) name = base + n++;
  const sprite = spriteByName(name) || spriteByName(C.name.toLowerCase()) || pack.sprites[0];
  markUndo();
  const o = newGameObject(name, C.name, sprite && sprite.name);
  pack.objects.push(o);
  currentObj = o;
  showTab('gameobjects');
  renderGameObjects();
  savePack();
};
