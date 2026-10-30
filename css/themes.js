// ---------- the look, picked ----------
// The tools' own styles are the Classic look; every other look is one more
// stylesheet in css/, loaded last over them (a <link id="themeCss">). The
// pick is kept in this browser, shared by the asset pack creator and the
// level editor, and an open tab follows when another changes it.
//
// Loaded in <head> right after the link, so the look is there before the
// page is drawn; the picker goes into the page's top bar once it is.
(function () {
  const THEMES = [
    { id: 'classic', label: 'Classic', file: '' },
    { id: 'blender', label: 'Blender', file: 'blender.css' },
    { id: 'nightshade', label: 'Nightshade', file: 'nightshade.css' },
    { id: 'arcade', label: 'Arcade', file: 'arcade.css' },
    { id: 'light', label: 'Light', file: 'light.css' }
  ];
  const KEY = 'warmWormTheme';
  const DEFAULT = 'blender';
  const here = document.currentScript ? new URL('.', document.currentScript.src).href : '../css/';

  const read = () => { try { return localStorage.getItem(KEY) || DEFAULT; } catch { return DEFAULT; } };
  const byId = id => THEMES.find(t => t.id === id) || THEMES.find(t => t.id === DEFAULT);

  function apply(id) {
    const t = byId(id);
    const link = document.getElementById('themeCss');
    if (link) {
      if (t.file) { link.href = here + t.file; link.disabled = false; }
      else { link.removeAttribute('href'); link.disabled = true; }
    }
    document.documentElement.dataset.theme = t.id;
    const sel = document.getElementById('themePick');
    if (sel) sel.value = t.id;
  }
  apply(read());

  // the picker: a small box in the top bar, as the name boxes there are
  function mount() {
    const bar = document.querySelector('header.top');
    if (!bar || document.getElementById('themePick')) return;
    const box = document.createElement('div');
    box.className = 'namebox themebox';
    box.title = 'How the tools look — kept in this browser, for the asset pack creator and the level editor alike';
    box.innerHTML = '<span>look</span><select id="themePick" aria-label="Look"></select>';
    const sel = box.querySelector('select');
    sel.innerHTML = THEMES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
    sel.value = byId(read()).id;
    sel.addEventListener('change', () => {
      try { localStorage.setItem(KEY, sel.value); } catch { /* this tab only, then */ }
      apply(sel.value);
    });
    bar.appendChild(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  // another tab picked one
  addEventListener('storage', e => { if (e.key === KEY) apply(read()); });
  window.warmWormThemes = { THEMES, apply };
})();
