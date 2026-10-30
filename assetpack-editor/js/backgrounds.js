// ---------- backgrounds ----------
// Each one is a tiling sprite plus the colour and distance a level gets when
// it picks that sprite, which is what assetpack.json offers the level editor.

function renderBackgrounds() {
  $('#bgList').innerHTML = pack.backgrounds.map(b => `
    <div class="bgcard" data-bid="${b.id}">
      <div class="bgprev" style="background-image:url(${b.src});background-color:${b.color}"></div>
      <div class="bgmeta">
        <div class="row gap"><input type="text" data-b="name" value="${esc(b.name)}" aria-label="Name">
          <button class="x" data-b="del" title="Remove" aria-label="Remove">×</button></div>
        <div class="row gap"><input type="color" data-b="color" value="${b.color}" aria-label="Colour behind it">
          <span class="mono">${esc(b.file)}</span><span class="grow"></span>
          <button class="btn sm" data-b="edit" title="Paint on it">✎ Edit</button>
          <button class="btn sm" data-b="replace" title="Swap in another image, keeping the rest">Replace…</button></div>
        <label class="ctl"><div class="row"><span>Distance</span><output>${num(b.scroll)}</output></div>
          <input type="range" data-b="scroll" min="0" max="1" step="0.05" value="${b.scroll}"></label>
      </div>
    </div>`).join('') || '<p class="empty">No backgrounds yet.</p>';
}

$('#bgList').addEventListener('input', e => {
  const card = e.target.closest('[data-bid]');
  const k = e.target.dataset.b;
  if (!card || !k) return;
  markUndo();
  const b = pack.backgrounds.find(x => x.id === card.dataset.bid);
  if (k === 'name') b.name = e.target.value;
  else if (k === 'color') b.color = e.target.value;
  else if (k === 'scroll') {
    b.scroll = +e.target.value;
    e.target.parentElement.querySelector('output').textContent = num(b.scroll);
  }
  if (k === 'color') card.querySelector('.bgprev').style.backgroundColor = b.color;
  savePack();
});

$('#bgList').addEventListener('click', async e => {
  const act = e.target.dataset.b;
  const card = e.target.closest('[data-bid]');
  if (!card || (act !== 'del' && act !== 'edit' && act !== 'replace')) return;
  const b = pack.backgrounds.find(x => x.id === card.dataset.bid);
  if (act === 'edit') { editBackground(b).catch(err => toast(err.message, true)); return; }
  if (act === 'replace') {
    const [file] = await pickFiles('image/*');
    if (!file) return;
    const src = await pngURL(file);
    markUndo();
    b.src = src;
    renderBackgrounds();
    savePack();
    return;
  }
  markUndo();
  pack.backgrounds = pack.backgrounds.filter(b => b.id !== card.dataset.bid);
  renderBackgrounds();
  savePack();
});

$('#bgAdd').onclick = async () => {
  const files = await pickFiles('image/*', true);
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const base = slug(file.name.replace(/\.[^.]+$/, '')) || 'background';
    let file_ = base + '.png';
    let n = 2;
    while (pack.backgrounds.some(b => b.file === file_)) file_ = `${base}-${n++}.png`;
    pack.backgrounds.push({
      id: uid(),
      file: file_,
      name: base.replace(/(^|-)([a-z])/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase()),
      color: '#140c1c',
      scroll: 0.3,
      src: await pngURL(file)
    });
  }
  renderBackgrounds();
  savePack();
};

// The pack writes every background as a .png, so whatever comes in is redrawn
// as one: a JPEG's bytes under a .png name would not load in the game.
async function pngURL(file) {
  const img = await loadImg(await readURL(file));
  const c = blankCanvas(img.naturalWidth, img.naturalHeight);
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}

// A background opens in the pixel editor as a one-frame stand-in object, and
// every settled stroke is written straight back to it. Its arrow buttons wrap
// the pixels round the edges, which is how a tile is made to repeat cleanly.
async function editBackground(b) {
  const img = await loadImg(b.src);
  const part = { id: 'bg', name: 'background', color: '#ffffff' };
  const f = { id: 'bg-' + b.id, src: b.src, partId: part.id };
  const stand = { name: b.name, fw: img.naturalWidth, fh: img.naturalHeight, frames: [f], parts: [part] };
  dropFrameCanvas(f.id);
  await attachFrame(stand, f);
  openPaint(stand, f, {
    single: true,
    onSave: g => {
      b.src = g.src;
      const prev = $(`#bgList [data-bid="${b.id}"] .bgprev`);
      if (prev) prev.style.backgroundImage = `url(${b.src})`;
    }
  });
}

$('#bgDraw').onclick = async () => {
  const got = await ask('Draw a background', [
    { key: 'name', label: 'Name', value: 'Sky' },
    { key: 'w', label: 'Width (pixels)', type: 'number', value: 64 },
    { key: 'h', label: 'Height (pixels)', type: 'number', value: 64 },
    { type: 'note', label: 'It tiles in both directions, so a small square that repeats cleanly goes a long way.' }
  ], 'Draw it');
  const w = got && parseInt(got.w, 10), h = got && parseInt(got.h, 10);
  if (!w || !h || w < 1 || h < 1 || w > 1024 || h > 1024) { if (got) toast('Pick a size from 1 to 1024', true); return; }
  markUndo();
  const base = slug(got.name) || 'background';
  let file = base + '.png';
  let n = 2;
  while (pack.backgrounds.some(b => b.file === file)) file = `${base}-${n++}.png`;
  const b = { id: uid(), file, name: got.name.trim() || 'Background', color: '#140c1c', scroll: 0.3, src: blankCanvas(w, h).toDataURL('image/png') };
  pack.backgrounds.push(b);
  renderBackgrounds();
  savePack();
  editBackground(b).catch(err => toast(err.message, true));
};

// Clicking a preview opens it at 1:1, tiled the way a level will draw it,
// so the strip on the card isn't the only look you get at it.
$('#bgList').addEventListener('click', e => {
  const prev = e.target.closest('.bgprev');
  if (!prev) return;
  const b = pack.backgrounds.find(x => x.id === prev.closest('[data-bid]').dataset.bid);
  $('#bvName').textContent = b.name;
  $('#bvSize').textContent = '';
  const img = new Image();
  img.onload = () => { $('#bvSize').textContent = `${img.naturalWidth} × ${img.naturalHeight}`; };
  img.src = b.src;
  $('#bvStage').style.backgroundColor = b.color;
  $('#bvStage').style.backgroundImage = `url(${b.src})`;
  $('#bgview').showModal();
});

$('#bvClose').onclick = () => $('#bgview').close();
$('#bgview').addEventListener('click', e => { if (e.target === $('#bgview')) $('#bgview').close(); });
