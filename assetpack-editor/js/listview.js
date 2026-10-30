// ---------- a left list, shown two ways ----------
// Every item in one list, or grouped — an accordion, each group opened and
// closed on its own, the group of an item opening when that item is picked.
// The view and the open groups are kept in this browser, per list.
//
//   const v = listView('assetEditorObjects', '#goView', '#goList', renderGoList);
//   v.render(items, { group: o => o.cls, order, label, item: (o, grouped) => html,
//                     picked, bad, empty })
//
// A switch's buttons say their view in data-view: 'list', or the grouped one.
function listView(key, segSel, boxSel, rerender) {
  const v = { view: 'list', open: new Set(), shown: null };
  try {
    v.view = localStorage.getItem(key + 'View') || 'list';
    v.open = new Set(JSON.parse(localStorage.getItem(key + 'Open') || '[]'));
  } catch { /* the defaults, then */ }
  const keep = () => {
    try {
      localStorage.setItem(key + 'View', v.view);
      localStorage.setItem(key + 'Open', JSON.stringify([...v.open]));
    } catch { /* not kept */ }
  };

  $(segSel).addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (!b || b.dataset.view === v.view) return;
    v.view = b.dataset.view;
    keep();
    rerender();
  });
  // 'toggle' doesn't bubble, so it is caught on the way down
  $(boxSel).addEventListener('toggle', e => {
    const d = e.target.closest && e.target.closest('.lgroup');
    if (!d) return;
    if (d.open) v.open.add(d.dataset.group); else v.open.delete(d.dataset.group);
    keep();
  }, true);

  v.render = (items, o) => {
    $$(segSel + ' button').forEach(b => b.classList.toggle('on', b.dataset.view === v.view));
    const box = $(boxSel);
    if (!items.length) { box.innerHTML = `<p class="empty">${o.empty}</p>`; return; }
    if (v.view === 'list') { box.innerHTML = items.map(x => o.item(x, false)).join(''); return; }
    const groups = new Map();
    for (const x of items) {
      const g = o.group(x);
      (groups.get(g) || groups.set(g, []).get(g)).push(x);
    }
    const names = [...groups.keys()].sort((a, b) => o.order ? o.order(a) - o.order(b) : a.localeCompare(b));
    // a newly picked item's group opens; one closed after stays closed
    if (o.picked && o.picked !== v.shown) v.open.add(o.group(o.picked));
    v.shown = o.picked;
    box.innerHTML = names.map(g => {
      const list = groups.get(g);
      const bad = o.bad ? list.filter(o.bad).length : 0;
      return `<details class="lgroup" data-group="${esc(g)}" ${v.open.has(g) ? 'open' : ''}>
        <summary><span class="${bad ? 'warn' : ''}">${esc(o.label ? o.label(g) : g)}</span>${bad ? `<span class="wbadge" title="${bad} with problems">${bad}</span>` : ''}<span class="n">${list.length}</span></summary>
        <div class="items">${list.map(x => o.item(x, true)).join('')}</div>
      </details>`;
    }).join('');
  };
  return v;
}
