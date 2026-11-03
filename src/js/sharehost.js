// This browser's room: every page of the game and its tools runs this, so the
// browser shares its level packs for as long as any of its pages is open,
// whichever page that is.
//
// The pages meet on a BroadcastChannel and queue for a Web Lock. The one
// holding the lock is the master: it alone loads the sharing code and PeerJS,
// and holds the browser's share id on the broker. When it closes or crashes
// the browser hands the lock to the next page at once, with the same id, so
// links go on working. Pages waiting load nothing and do nothing but answer
// when asked how sharing stands (ShareCore.sharingStatus).
//
// A game page gives way: it hands the lock on as soon as it has no friend to
// finish with and some other kind of page is waiting, so the game isn't the
// one sending files. As master anyway, it sends them more gently.
//
// The sharing code runs inside a function, so it can't clash with the engine
// a pack carries, however old. Where there are no locks (plain http) every
// page keeps trying for the id instead. A pack put up somewhere with no share/
// just doesn't share. A page in a frame leaves it to the page around it.
(() => {
  if (window.top !== window || window.wtwShareHost || typeof BroadcastChannel === 'undefined') return;
  window.wtwShareHost = true;

  const CODE = ['/src/js/packstore.js', '/share/core.js', '/share/cards.js'];
  const PEERJS = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js';
  const PLAY_PAUSE = 4;      // ms between a file's pieces while a game is on show
  const room = new BroadcastChannel('wtw-share');
  const isOn = () => { try { return localStorage.getItem('wtwSharing') !== 'off'; } catch { return false; } };
  const isGame = () => !!document.getElementById('game');

  let state = 'waiting', trouble = '', served = 0;
  let line = null;           // while master: its line to friends
  let letGo = null;          // while master: ends it
  let pendingGiveWay = false;
  let woken = [];            // those waiting for the switch

  const tell = (next, why = '') => {
    state = next;
    trouble = why;
    room.postMessage({ t: 'state', state, trouble, page: location.pathname + location.search });
  };
  const switched = () => {
    const all = woken;
    woken = [];
    all.forEach(fn => fn());
    if (!isOn() && letGo) letGo();
  };
  const untilOn = () => new Promise(resolve => {
    const check = () => { if (isOn()) resolve(); else woken.push(check); };
    check();
  });

  // A game page as master hands the lock on, once no friend is being served.
  const giveWay = () => {
    if (!line || !letGo || !isGame() || !navigator.locks) return;
    if (line.busy()) { pendingGiveWay = true; return; }
    pendingGiveWay = false;
    letGo();
  };
  // ... if some other kind of page is waiting for it.
  const askForOthers = () => { if (isGame()) room.postMessage({ t: 'who', from: 'master-of-a-game' }); };

  room.onmessage = e => {
    const m = e.data || {};
    if (m.t === 'who') room.postMessage({ t: 'here', to: m.from, state, trouble, served, game: isGame(), page: location.pathname + location.search });
    else if (m.t === 'switch') switched();
    else if (m.t === 'joined' && !m.game) giveWay();
    else if (m.t === 'here' && m.to === 'master-of-a-game' && !m.game && m.state === 'waiting') giveWay();
  };
  addEventListener('storage', e => { if (e.key === 'wtwSharing') switched(); });

  const loadPeerJs = () => new Promise((resolve, reject) => {
    if (window.Peer) { resolve(); return; }
    document.head.appendChild(Object.assign(document.createElement('script'), { src: PEERJS, onload: resolve, onerror: reject }));
  });
  let core = null;
  async function sharingCode() {
    await loadPeerJs();
    if (core) return core;
    const parts = await Promise.all(CODE.map(async url => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.text();
    }));
    core = new Function(`${parts.join('\n;\n')}\n;return ShareCore;\n//# sourceURL=/share/master.js`)();
    return core;
  }

  async function master() {
    if (!isOn()) return;
    tell('connecting');
    let C;
    try { C = await sharingCode(); }
    catch (err) {
      tell('connecting', 'Could not load the sharing code: ' + err.message + '. Trying again…');
      await new Promise(resolve => setTimeout(resolve, 30000));
      tell('waiting');
      return;
    }
    if (!isOn()) { tell('waiting'); return; }
    await new Promise(resolve => {
      letGo = resolve;
      line = C.host({
        ready: () => { tell('sharing'); askForOthers(); },
        friend: (n, report) => {
          if (report.state === 'ok') served++;
          room.postMessage({ t: 'friend', friend: n, ...report });
        },
        idle: () => { if (pendingGiveWay) giveWay(); },
        trouble: text => tell('connecting', text)
      }, { pause: () => isGame() && !document.hidden ? PLAY_PAUSE : 0 });
    });
    letGo = null;
    pendingGiveWay = false;
    line.close();
    line = null;
    tell('waiting');
  }

  // closing cleanly frees the id on the broker for the next page at once
  addEventListener('pagehide', () => { if (letGo) letGo(); if (line) line.close(); });

  const start = async () => {
    room.postMessage({ t: 'joined', game: isGame() });
    for (;;) {
      await untilOn();
      if (navigator.locks) await navigator.locks.request('wtw-share-line', master);
      else await master();
    }
  };
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
})();
