// Small things every other file here leans on.

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let uidN = 0;
const uid = () => Date.now().toString(36) + (uidN++).toString(36);

// One element names another with the other's kind in front: "sprite::coin",
// "sound::coin" — the same rule src/js/atlas.js reads them by.
const refName = v => {
  const t = String(v ?? '');
  const cut = t.indexOf('::');
  return cut < 0 ? t : t.slice(cut + 2);
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// What a name becomes on disk. Objects, backgrounds and sound ids all end up
// as filenames or JSON keys, so the same rule has to cover all of them.
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Trailing zeros make a manifest hard to read, and the game parses either way.
const num = (v, digits = 2) => {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return Object.is(r, -0) ? 0 : r;
};

const loadImg = src => new Promise((ok, fail) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => fail(new Error('could not read that image'));
  i.src = src;
});

const readURL = file => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => fail(new Error(`could not read ${file.name}`));
  r.readAsDataURL(file);
});

const readBytes = async file => new Uint8Array(await file.arrayBuffer());

// A data: URL back to the bytes a zip entry needs.
function dataUrlBytes(url) {
  const raw = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const canvasBytes = canvas => dataUrlBytes(canvas.toDataURL('image/png'));

function blankCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function cloneCanvas(src) {
  const c = blankCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // the browser reads the blob after the click returns, so it cannot be let go of yet
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', !!bad);
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, bad ? 4000 : 2000);
}

function pickFiles(accept, multiple) {
  return new Promise(ok => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = !!multiple;
    i.onchange = () => ok([...i.files]);
    i.click();
  });
}

// prompt() and confirm() are not available in every host this runs in, and a
// real dialog can ask for more than one thing at a time.
let askSettle = null;       // how the question on screen is answered, while one is

function ask(title, fields, okLabel) {
  const dlg = $('#ask');
  $('#askTitle').textContent = title;
  $('#askOk').textContent = okLabel || 'OK';
  $('#askBody').innerHTML = (fields || []).map((f, i) => {
    const id = 'ask-' + i;
    if (f.type === 'select') {
      return `<label class="ctl"><span>${esc(f.label)}</span><select id="${id}" data-k="${f.key}">` +
        f.options.map(o => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('') + '</select></label>';
    }
    if (f.type === 'note') return `<p class="hint">${esc(f.label)}</p>`;
    if (f.type === 'textarea') {
      return `<label class="ctl"><span>${esc(f.label)}</span>` +
        `<textarea id="${id}" data-k="${f.key}" rows="8" spellcheck="false">${esc(f.value === undefined ? '' : f.value)}</textarea></label>`;
    }
    return `<label class="ctl"><span>${esc(f.label)}</span>` +
      `<input id="${id}" data-k="${f.key}" type="${f.type || 'text'}" value="${esc(f.value === undefined ? '' : f.value)}"></label>`;
  }).join('');

  return new Promise(ok => {
    // Each question answers only for itself. The dialog keeps its last
    // returnValue, so it is emptied first — or Esc, which closes without
    // one, would read as the OK of the question before. And a question still
    // waiting when another opens is settled as cancelled, so its close can't
    // take the new one's answer.
    if (askSettle) askSettle(null);
    const onClose = () => {
      if (dlg.open) return;     // a late close of the showing before; this one is still up
      if (dlg.returnValue !== 'ok') return settle(null);
      const out = {};
      $$('#askBody [data-k]').forEach(el => { out[el.dataset.k] = el.value; });
      settle(out);
    };
    const settle = v => {
      dlg.removeEventListener('close', onClose);
      if (askSettle === settle) askSettle = null;
      ok(v);
    };
    askSettle = settle;
    dlg.addEventListener('close', onClose);
    dlg.returnValue = '';
    if (!dlg.open) dlg.showModal();
    const first = $('#askBody input,#askBody select,#askBody textarea');
    if (first) { first.focus(); if (first.select) first.select(); }
  });
}
