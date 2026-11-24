// SNIPER MODE: you set the order flow yourself (direction + the inducement and disruption POIs) and the bot watches the rest of SORK for you.
//
//  1. Tap SNIPER MODE in the symbol menu. Two boxes appear on the chart: INDUCEMENT and DISRUPTION (start from the bot's own reading when it has one).
//  2. Pick the direction, then drag each box: the top and bottom squares set its price range, the round handle on its left edge moves it
//     to where the POI formed (that time matters: the bot only looks at candles after it). You can also type the prices.
//  3. Tap ARM. From then on the bot messages you privately (with a chart picture) for every new event on this symbol:
//     break of structure, change of structure, reclamation, key level, QML, bjeff zone, and the invalidation of your disruption (that ends the flow).
//  Arming again replaces your flow on this symbol. The flow lives on the server (api/sniper), per person, so it works with the app closed.
//
// app.js calls: open() when a symbol opens, btnHtml() + toolsHtml() when its page is drawn, bind() after that, draw() from chart(),
// and down() / move() / up() / near() from the chart's pointer handlers.
const Snipe = (() => {
  const COL = { ind: '#FFFFFF', dis: '#F5D547' }, NAME = { ind: 'INDUCEMENT', dis: 'DISRUPTION' }, num = Number.isFinite;
  let sym = null, flow = null, suggest = null, panel = false, draft = null, drag = null, lastLoad = 0, digits = 2, note = '', busy = false, noteTimer = null;

  const canvas = () => document.getElementById('chart');
  const redraw = () => { const cv = canvas(), c = cv && cv._ctx; if (c) chart(cv, c.s, c.tf, c.name); };
  const env = () => { const cv = canvas(); return cv && cv._sn && cv._sn.env; };
  const fmt = v => num(v) ? v.toFixed(digits) : '';
  const copy = f => ({ dir: f.dir, ind: { ...f.ind }, dis: { ...f.dis } });

  function open(id) { sym = id; flow = suggest = draft = drag = null; panel = false; note = ''; load(id); }
  function load(id) {
    lastLoad = Date.now();
    api('/api/sniper?symbol=' + encodeURIComponent(id)).then(r => {
      if (sym !== id || drag) return;
      flow = r.flow && r.flow.status === 'active' ? r.flow : null; suggest = r.suggest || null;
      if (!flow && r.flow && r.flow.status === 'ended' && !note) note = 'Your last order flow on this symbol is over (price went beyond your disruption). Set a new one.';
      sync(); redraw();
    }).catch(() => { /* not signed in (outside Telegram): no Sniper Mode */ });
  }

  // A starting draft: the bot's own reading when it matches the direction, else two thin boxes below (bullish) or above (bearish) the price.
  function starter(dir) {
    const E = env();
    if (suggest && suggest.dir === dir) return copy(suggest);
    if (!E) return null;
    const last = E.price ?? E.last, a = (E.atr && (E.tf === 'm5' ? E.atr.m5 : E.atr.h1)) || (E.hi - E.lo) / 12, th = Math.max(a * .5, (E.hi - E.lo) * .05), tA = E.toTime(E.plotW * .78), tB = E.toTime(E.plotW * .5);
    const at = off => dir === 1 ? { lo: last - off - th, hi: last - off } : { lo: last + off, hi: last + off + th };
    return { dir, ind: { ...at(a * 1.5), t: tA }, dis: { ...at(a * 4.5), t: tB } };
  }

  // Held-chart shortcut: the held price is the inducement (a thin box centred on it, from the held candle on), the disruption sits a few ATR beyond it.
  // The card opens with this draft so the boxes can still be dragged before arming.
  function fromHold(price, dir, t) {
    const E = env(); if (!E || !(price > 0)) return;
    const a = (E.atr && (E.tf === 'm5' ? E.atr.m5 : E.atr.h1)) || (E.hi - E.lo) / 12, th = Math.max(a * .5, (E.hi - E.lo) * .05), off = a * 3;
    const box = (c, tt) => ({ lo: c - th / 2, hi: c + th / 2, t: tt });
    const tI = Number.isFinite(t) ? t : E.toTime(E.plotW * .78);
    draft = { dir, ind: box(price, tI), dis: box(price - dir * off, tI - 12 * E.ivl) };
    panel = true; note = '';
    if (typeof Pos !== 'undefined') Pos.close(); if (typeof PA !== 'undefined') PA.close();
    sync(); redraw();
    const cv = document.getElementById('chart'); if (cv && cv.scrollIntoView) cv.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- card
  const SCOPE = 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 100 6 3 3 0 000-6zM5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2';
  const btnHtmlOld = () => `<button data-sn="panel" class="snbtn${panel ? ' on' : ''}" aria-label="Open Sniper Mode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SCOPE}"/></svg><span>Sniper mode</span></button>`;
  const btnHtml = () => '', toolsHtml = () => '';                              // no card and no menu button any more: Draw starts from holding the chart
  const toolsHtmlOld = () => `<div class="pplan snipe" hidden>
      <div class="pp-head"><b>SNIPER MODE</b><span class="pinfo"></span></div>
      <p class="pa-help">Set your own order flow: pick the direction and drag the two boxes on the chart. Then arm it. The bot messages you for every new break of structure, change of structure, reclamation, key level and QML, and when your disruption is invalidated.</p>
      <div class="pp-dir"><button data-sn="bull">BULLISH FLOW</button><button data-sn="bear">BEARISH FLOW</button></div>
      <div class="pp-grid">
        <label class="pf"><span>INDUCEMENT HIGH</span><input data-sn-f="ind.hi" type="number" inputmode="decimal" step="any" autocomplete="off"></label>
        <label class="pf"><span>INDUCEMENT LOW</span><input data-sn-f="ind.lo" type="number" inputmode="decimal" step="any" autocomplete="off"></label>
        <label class="pf"><span>DISRUPTION HIGH</span><input data-sn-f="dis.hi" type="number" inputmode="decimal" step="any" autocomplete="off"></label>
        <label class="pf"><span>DISRUPTION LOW</span><input data-sn-f="dis.lo" type="number" inputmode="decimal" step="any" autocomplete="off"></label>
      </div>
      <button data-sn="suggest" class="sn-sug" hidden>USE THE BOT'S READING</button>
      <p class="pp-sum"></p>
      <div class="pp-msg" role="alert"></div>
      <div class="pp-act"><button data-sn="arm" class="pp-go">ARM SNIPER MODE</button><button data-sn="stop" class="pp-del" hidden>STOP</button><button data-sn="close">CLOSE</button></div>
    </div>`;
  const root = () => document.querySelector('.snipe');
  const get = (o, path) => path.split('.').reduce((x, k) => x[k], o);

  function sync() {
    const r = root(); if (!r) return;
    r.hidden = !panel;
    const b = document.querySelector('.tmenu .snbtn'); if (b) { b.classList.toggle('on', panel); b.classList.toggle('armed', !!flow); }
    if (!panel) return;
    r.querySelector('.pinfo').textContent = flow ? 'ARMED' : draft ? 'NOT ARMED' : '';
    r.querySelector('[data-sn=bull]').classList.toggle('on', !!draft && draft.dir === 1);
    r.querySelector('[data-sn=bear]').classList.toggle('on', !!draft && draft.dir === -1);
    r.querySelectorAll('input[data-sn-f]').forEach(i => { if (document.activeElement !== i) i.value = draft ? fmt(get(draft, i.dataset.snF)) : ''; });
    r.querySelector('[data-sn=suggest]').hidden = !(suggest && draft && !(draft.dir === suggest.dir && draft.ind.lo === suggest.ind.lo && draft.dis.lo === suggest.dis.lo));
    r.querySelector('[data-sn=arm]').disabled = !draft || busy;
    r.querySelector('[data-sn=arm]').textContent = flow ? 'RE-ARM WITH THESE' : 'ARM SNIPER MODE';
    r.querySelector('[data-sn=stop]').hidden = !flow;
    r.querySelector('.pp-sum').textContent = flow ? 'Armed. The bot is watching this symbol for you and will message you here in Telegram.' : '';
    const m = r.querySelector('.pp-msg'); m.textContent = note; m.style.color = /^Armed|^Sniper/.test(note) ? 'var(--up, #5AFF64)' : '';
  }

  function bind() {
    const bar = document.querySelector('.tmenu'), r = root(); if (!bar || !r) return;
    [bar, r].forEach(el => el.addEventListener('click', e => { const b = e.target.closest('button[data-sn]'); if (b && !b.disabled) act(b.dataset.sn); }));
    r.querySelectorAll('input[data-sn-f]').forEach(i => i.addEventListener('input', e => {
      const v = parseFloat(e.target.value); if (!draft || !(num(v) && v > 0)) return;
      const [k, f] = i.dataset.snF.split('.'); draft[k][f] = v; note = ''; redraw();
    }));
    sync();
  }

  async function act(a) {
    if (a === 'panel') {
      panel = !panel; note = '';
      if (panel) { if (typeof Pos !== 'undefined') Pos.close(); if (typeof PA !== 'undefined') PA.close(); draft = flow ? copy(flow) : starter(suggest ? suggest.dir : 1); } else draft = null;
      sync(); return redraw();
    }
    if (a === 'close') { panel = false; draft = null; note = ''; sync(); return redraw(); }
    if (a === 'bull' || a === 'bear') { const dir = a === 'bull' ? 1 : -1; if (draft && draft.dir === dir) return; draft = starter(dir); note = ''; sync(); return redraw(); }
    if (a === 'suggest') { if (suggest) { draft = copy(suggest); note = ''; sync(); redraw(); } return; }
    try {
      busy = true; sync();
      if (a === 'arm') {
        if (!draft) return;
        const r = await api('/api/sniper', { method: 'POST', body: JSON.stringify({ symbol: sym, dir: draft.dir, ind: draft.ind, dis: draft.dis }) });
        flow = r.flow; draft = null; panel = false; note = 'Armed. You will get a message here for every new event on this symbol.';
      } else if (a === 'stop' && flow) {
        await api('/api/sniper/delete', { method: 'POST', body: JSON.stringify({ id: flow.id }) });
        flow = null; draft = null; panel = false; note = 'Draw is off for this symbol.';
      }
    } catch (e) { note = String(e.message || e); }
    busy = false; sync(); redraw();
  }

  // ---------------------------------------------------------------- chart hooks
  function draw(g, cv, E) {
    const geo = cv._sn = { env: E, handles: [], btns: [] };
    digits = E.digits;
    if (Date.now() - lastLoad > 15000 && sym && !drag && !panel) load(sym);          // a flow that ended on the server shows up here
    const shown = panel ? draft : flow;
    if (note && !noteTimer) noteTimer = setTimeout(() => { note = ''; noteTimer = null; redraw(); }, 6000);
    if (note) { g.font = `700 ${E.FS}px ${E.MONO}`; g.fillStyle = /^Armed|^Draw/.test(note) ? '#5AFF64' : '#FF8A7A'; g.textBaseline = 'alphabetic'; const words = note.split(' '), lines = [''], mw = E.plotW - 10;
      for (const w of words) { const t = (lines[lines.length - 1] + ' ' + w).trim(); if (g.measureText(t).width > mw && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = t; }
      lines.slice(0, 3).forEach((l, i, a) => g.fillText(l, 6, E.Hh - 8 - (a.length - 1 - i) * (E.FS + 3))); }
    if (!shown) return;
    const { FS, MONO, Y } = E, X = t => (t - E.cs0) / E.ivl * E.step + E.step / 2, editing = panel;
    g.font = `700 ${FS}px ${MONO}`; g.textBaseline = 'middle';
    for (const k of ['dis', 'ind']) {
      const b = shown[k], yT = Y(b.hi), yB = Y(b.lo), x0 = Math.max(0, Math.min(E.plotW - 4, X(b.t) - E.step / 2)), w = E.plotW - x0, col = COL[k];
      g.globalAlpha = editing ? .18 : .12; g.fillStyle = col; g.fillRect(x0, yT, w, yB - yT); g.globalAlpha = 1;
      g.strokeStyle = col; g.lineWidth = editing ? 1.5 : 1; g.setLineDash(editing ? [6, 3] : []); g.strokeRect(x0 + .5, yT + .5, w - 1, yB - yT - 1); g.setLineDash([]);
      const text = `${NAME[k]} ${flow && !editing ? '· YOURS' : ''}`.trim();
      g.fillStyle = col; g.fillText(text, x0 + 32, yT - FS * .7 - 2 < 0 ? yB + FS * .8 + 3 : yT - FS * .7 - 2);          // label sits just above the box (below it at the very top)
      if (editing) {                                                                 // handles: top / bottom edge squares and a round move handle
        const hs = [{ k: 'top', x: x0 + 14, y: yT - 7 }, { k: 'bottom', x: x0 + 14, y: yB + 7 }, { k: 'move', x: Math.max(x0, 10), y: (yT + yB) / 2 }];   // squares sit just outside the edges so thin boxes keep three separate handles
        for (const h of hs) {
          g.fillStyle = '#0C1109'; g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
          if (h.k === 'move') g.arc(h.x, h.y, 7, 0, 7); else g.rect(h.x - 6, h.y - 6, 12, 12);
          g.fill(); g.stroke(); geo.handles.push({ id: k, k: h.k, x: h.x, y: h.y });
        }
      }
    }
    // buttons, right-aligned just above the inducement box: ARM and X while you are placing it, a STOP button once it is armed
    { const b = shown.ind, th = E.LH + 6, yT = Y(b.hi), by = Math.max(2, Math.min(E.Hh - th - 2, yT - th - 6 - (E.FS + 4)));
      const btns = editing ? [['arm', busy ? 'ARMING...' : flow ? 'RE-ARM' : 'ARM', '#5AFF64', '#0C1109'], ['close', '✕', '#B03A2E', '#fff']] : [['stop', 'STOP', '#B03A2E', '#fff']];
      let bx = E.plotW - 4; g.textBaseline = 'middle';
      for (const [id, lab, bg, fg] of btns.reverse()) { const w = Math.ceil(g.measureText(lab).width) + 16; bx -= w; g.fillStyle = bg; g.fillRect(bx, by, w, th); g.fillStyle = fg; g.fillText(lab, bx + 8, by + th / 2 + .5); geo.btns.push({ id, x: bx, y: by, w, h: th }); bx -= 6; }
      if (!editing) { g.fillStyle = '#5AFF64'; g.fillText('DRAW ARMED', bx - Math.ceil(g.measureText('DRAW ARMED').width) + 2, by + th / 2 + .5); } }
    g.lineWidth = 1; g.textBaseline = 'alphabetic'; g.font = `${FS}px ${MONO}`;
  }

  function local(cv, e) {
    const E = cv._sn.env, r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left - cv.clientLeft) * E.W / cv.clientWidth, y: (e.clientY - r.top - cv.clientTop) * E.Hh / cv.clientHeight };
  }
  const handleAt = (cv, pt, reach) => {
    if (!panel || !cv._sn) return null; let best = null, bd = reach;
    for (const h of cv._sn.handles) { const d = Math.hypot(h.x - pt.x, h.y - pt.y); if (d <= bd) { bd = d; best = h; } }
    return best;
  };
  const btnAt = (cv, pt, reach) => (cv._sn ? cv._sn.btns : []).find(b => pt.x >= b.x - reach && pt.x <= b.x + b.w + reach && pt.y >= b.y - reach && pt.y <= b.y + b.h + reach) || null;
  const near = (cv, t) => !!(cv._sn && (handleAt(cv, local(cv, t), 24) || btnAt(cv, local(cv, t), 6)));              // a finger on a handle: the page must not scroll
  function down(cv, e) {
    if (!cv._sn) return false;
    const bt = btnAt(cv, local(cv, e), e.pointerType === 'mouse' ? 2 : 8); if (bt) { act(bt.id); return true; }
    if (!panel || !draft) return false;
    const pt = local(cv, e), h = handleAt(cv, pt, e.pointerType === 'mouse' ? 11 : 22), E = cv._sn.env;
    if (!h) return false;
    drag = { id: h.id, k: h.k, pid: e.pointerId, start: { ...draft[h.id] }, price0: E.toPrice(pt.y), time0: E.toTime(pt.x) };
    cv._freeze = { lo: E.lo, hi: E.hi };                                             // keep the price scale still while dragging
    return true;
  }
  function move(cv, e) {
    if (!drag || e.pointerId !== drag.pid || !cv._sn || !draft) return false;
    const E = cv._sn.env, pt = local(cv, e), price = E.toPrice(pt.y), dP = price - drag.price0, dT = E.toTime(pt.x) - drag.time0, s0 = drag.start, b = draft[drag.id];
    const gap = Math.max(Math.pow(10, -E.digits), (E.hi - E.lo) * .004), q = v => Math.round(v * Math.pow(10, E.digits)) / Math.pow(10, E.digits);
    if (drag.k === 'top') b.hi = q(Math.max(price, b.lo + gap));
    else if (drag.k === 'bottom') b.lo = q(Math.min(price, b.hi - gap));
    else { b.lo = q(s0.lo + dP); b.hi = q(s0.hi + dP); b.t = Math.max(1, s0.t + dT); }
    sync(); redraw(); return true;
  }
  function up(cv, e) { if (drag && e.pointerId === drag.pid) { drag = null; cv._freeze = null; sync(); redraw(); } }
  const close = () => { if (panel) { panel = false; draft = null; sync(); } };
  const isOpen = () => panel;
  return { open, fromHold, btnHtml, toolsHtml, bind, draw, down, move, up, near, close, isOpen };
})();
