// Long / short position boxes for the symbol chart (a risk : reward planning tool).
//
//  BUY / SELL   drops a new box at the live price. Green = target zone, red = stop zone.
//  Handles      (shown on the selected box): left-top/bottom square = drag the stop or the target,
//               left-middle = move the whole box, right-middle = change its width.
//  Risk:reward  The stop is the risk, the target sits at  entry +/- rr x risk.  Change rr by typing it,
//               with the - / + buttons, or by dragging the target handle (it snaps to .5 steps).
//               Dragging the stop keeps rr, so the target follows.
//  Boxes are anchored to TIME and PRICE, so they stay put when you switch M5 / H1 / H4 or zoom and pan.
//  They are kept per symbol in localStorage. Lock freezes the selected box, the eye hides or shows all of them.
//
// app.js calls: open() when a symbol opens, toolsHtml() + bind() when its page is drawn, extent() and draw() from
// chart(), and down() / move() / up() / hover() / near() from the chart's pointer handlers.
const Pos = (() => {
  const KEY = 'bj_pos_v1', GREEN = '#3CB371', RED = '#B22222', BLUE = '#4A7CFF', MIN_RR = 0.1, MAX_RR = 50, MAX_BOXES = 20;
  const num = Number.isFinite, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let sym = null, items = [], sel = null, hidden = false, rrUser = null, rrEngine = 2, drag = null, tap = null;

  const ok = p => p && typeof p.id === 'string' && (p.dir === 1 || p.dir === -1) && [p.t0, p.t1, p.entry, p.sl, p.rr].every(num) && p.rr > 0 && p.entry !== p.sl && p.t1 > p.t0;
  const read = () => { try { const o = JSON.parse(localStorage.getItem(KEY)); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
  function save() {
    try {
      const o = read(); o.syms = o.syms && typeof o.syms === 'object' ? o.syms : {};
      if (sym) { if (items.length) o.syms[sym] = { items, sel }; else delete o.syms[sym]; }
      o.hidden = hidden; o.rr = rrUser; localStorage.setItem(KEY, JSON.stringify(o));
    } catch { /* storage not available: the boxes then last until the page is closed */ }
  }
  const cur = () => items.find(p => p.id === sel) || null;
  const rrNow = () => rrUser ?? rrEngine;
  const tpOf = p => p.entry + p.dir * p.rr * Math.abs(p.entry - p.sl);
  const canvas = () => document.getElementById('chart');
  const redraw = () => { const cv = canvas(), c = cv && cv._ctx; if (c) chart(cv, c.s, c.tf, c.name); };

  function open(id) {
    sym = id; drag = tap = null;
    const o = read(), e = o.syms && o.syms[id];
    items = e && Array.isArray(e.items) ? e.items.filter(ok) : [];
    sel = items.some(p => p.id === (e && e.sel)) ? e.sel : items.length ? items[items.length - 1].id : null;
    hidden = !!o.hidden; rrUser = num(o.rr) && o.rr >= MIN_RR && o.rr <= MAX_RR ? o.rr : null;
  }

  // ---------------------------------------------------------------- toolbar
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const IC = {
    up: 'M12 5l8 10H4z', down: 'M12 19L4 9h16z',
    unlock: 'M7 11V8a5 5 0 019.6-2M5 11h14v10H5z', lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z',
    del: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
    eyeoff: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM3 3l18 18',
  };
  const toolsHtml = () => `<div class="pills ptools" role="toolbar" aria-label="Position box">
    <button data-p="buy" class="pb-buy" aria-label="Add a long position box">${svg(IC.up)}BUY</button>
    <button data-p="sell" class="pb-sell" aria-label="Add a short position box">${svg(IC.down)}SELL</button>
    <button data-p="lock" aria-label="Lock or unlock the selected box"></button>
    <button data-p="del" aria-label="Delete the selected box">${svg(IC.del)}</button>
    <button data-p="eye" aria-label="Show or hide all boxes"></button>
    <span class="prr"><span>R:R</span><button data-p="rr-" aria-label="Lower the ratio">&minus;</button><input type="number" inputmode="decimal" step="0.1" min="${MIN_RR}" max="${MAX_RR}" aria-label="Risk reward ratio"><button data-p="rr+" aria-label="Raise the ratio">+</button></span></div>`;

  function sync() {
    const root = document.querySelector('.ptools'); if (!root) return;
    const p = cur(), q = s => root.querySelector(s);
    q('[data-p=lock]').innerHTML = svg(p && p.locked ? IC.lock : IC.unlock);
    q('[data-p=lock]').disabled = q('[data-p=del]').disabled = !p;
    q('[data-p=lock]').classList.toggle('on', !!(p && p.locked));
    q('[data-p=eye]').innerHTML = svg(hidden ? IC.eyeoff : IC.eye);
    q('[data-p=eye]').classList.toggle('on', hidden);
    const inp = q('input'); if (document.activeElement !== inp) inp.value = String(Math.round((p ? p.rr : rrNow()) * 100) / 100);
  }
  function bind() {
    const root = document.querySelector('.ptools'); if (!root) return;
    root.addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (b && !b.disabled) act(b.dataset.p); });
    const inp = root.querySelector('input');
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (v >= MIN_RR && v <= MAX_RR) setRR(v); });   // live while typing
    inp.addEventListener('change', () => { const v = parseFloat(inp.value); setRR(num(v) ? clamp(v, MIN_RR, MAX_RR) : (cur() || { rr: rrNow() }).rr); });
    sync();
  }
  function setRR(v) {
    rrUser = Math.round(v * 100) / 100; const p = cur(); if (p) p.rr = rrUser;
    save(); sync(); redraw();
  }
  function act(a) {
    const p = cur();
    if (a === 'buy' || a === 'sell') return add(a === 'buy' ? 1 : -1);
    if (a === 'rr+' || a === 'rr-') {                                    // step along the .5 grid, from wherever rr is now
      const r = (p ? p.rr : rrNow()) * 2;
      return setRR(clamp((a === 'rr+' ? Math.floor(r + 1e-9) + 1 : Math.ceil(r - 1e-9) - 1) / 2, MIN_RR, MAX_RR));
    }
    if (a === 'eye') hidden = !hidden;
    else if (a === 'lock' && p) p.locked = !p.locked;
    else if (a === 'del' && p) { items = items.filter(i => i !== p); sel = items.length ? items[items.length - 1].id : null; }
    save(); sync(); redraw();
  }
  function add(dir) {
    const cv = canvas(), E = cv && cv._pos && cv._pos.env; if (!E) return;
    // stop distance: one ATR of this timeframe, but never less than two label heights on screen, so the plates have room
    const ppx = (E.hi - E.lo) / (E.Hh - 14 - E.TOP), risk = Math.max((E.atr && E.atr[E.tf]) || 0, ppx * E.LH * 2), entry = E.price ?? E.last;
    if (!num(entry) || !(risk > 0)) return;
    // time slot: the right third of the screen first, then the middle, then the left, so new boxes do not pile up
    const n = Math.max(4, Math.round(E.plotW / E.step * .3)), span = n * E.ivl;
    let t0 = E.toTime(E.plotW * .7);
    for (const f of [.7, .35, .05]) { const t = E.toTime(E.plotW * f); if (!items.some(p => p.t0 < t + span && p.t1 > t)) { t0 = t; break; } }
    hidden = false; if (items.length >= MAX_BOXES) items.shift();
    const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), dir, t0, t1: t0 + span, entry, sl: entry - dir * risk, rr: rrNow() };
    items.push(p); sel = p.id; save(); sync(); redraw();
  }
  function select(id) { sel = id; save(); sync(); redraw(); }

  // ---------------------------------------------------------------- chart hooks
  // price range that the boxes visible in [a, b] (candle times) need, so chart() can keep them on screen
  function extent(a, b) {
    if (hidden) return null; let lo = Infinity, hi = -Infinity;
    for (const p of items) { if (p.t1 < a || p.t0 > b) continue; lo = Math.min(lo, p.sl, p.entry, tpOf(p)); hi = Math.max(hi, p.sl, p.entry, tpOf(p)); }
    return lo <= hi ? [lo, hi] : null;
  }

  function draw(g, cv, E) {
    const geo = cv._pos = { env: E, items: [] };
    if (num(E.rrPlan) && E.rrPlan > 0) rrEngine = E.rrPlan;
    if (hidden || !items.length) return;
    const { W, Hh, FS, LH, MONO, Y, taken } = E, d = E.digits, th = LH + 3, now = E.price ?? E.last;
    const X = t => (t - E.cs0) / E.ivl * E.step + E.step / 2;
    g.font = `${FS}px ${MONO}`; g.textBaseline = 'middle'; g.setLineDash([]);
    const wid = ls => Math.max(...ls.map(E.tw));
    const tag = (tiers, cx, top, bg, room) => {                            // white text on a coloured plate, kept inside the canvas
      const lines = tiers.find(ls => wid(ls) <= room) || tiers[tiers.length - 1];     // longest wording that fits the box width
      const w = wid(lines), h = lines.length * LH + 3, x = clamp(cx - w / 2, 2, W - w - 2);
      g.fillStyle = bg; g.fillRect(x, top, w, h); g.fillStyle = '#fff';
      lines.forEach((t, i) => g.fillText(t, x + 5, top + 1.5 + i * LH + LH / 2 + .5));
      taken.push({ x, y: top, w, h });
    };
    for (const p of items.slice().sort((a, b) => (a.id === sel) - (b.id === sel))) {      // the selected box is drawn last, on top
      const a = X(p.t0), b = X(p.t1), L = Math.max(0, Math.min(a, b)), R = Math.min(W, Math.max(a, b));
      if (R <= 0 || L >= W || R - L < 1) continue;
      const risk = Math.abs(p.entry - p.sl), tp = tpOf(p), yE = Y(p.entry), yS = Y(p.sl), yT = Y(tp), isSel = p.id === sel, cx = (L + R) / 2;
      const zone = (y, fill, line) => {
        const top = Math.min(yE, y), h = Math.abs(y - yE);
        g.fillStyle = fill; g.fillRect(L, top, R - L, h); g.strokeStyle = line; g.lineWidth = isSel ? 1.5 : 1; g.strokeRect(L + .5, top, R - L - 1, h);
      };
      zone(yT, 'rgba(60,179,113,.20)', 'rgba(60,179,113,.85)'); zone(yS, 'rgba(178,34,34,.26)', 'rgba(214,72,72,.85)');
      g.strokeStyle = 'rgba(237,235,216,.9)'; g.lineWidth = 1; g.beginPath(); g.moveTo(L, yE); g.lineTo(R, yE); g.stroke();
      // Target / Stop plates sit just outside the far edge of their zone (inside it when there is no room)
      const lab = (name, price, yO, bg) => {
        const dist = Math.abs(price - p.entry), base = `${name}: ${dist.toFixed(d)} (${(dist / Math.abs(p.entry) * 100).toFixed(2)}%)`;
        let top = yO < yE ? yO - th : yO + 2;
        if (top < 1) top = yO + 2; else if (top + th > Hh - 1) top = yO - th;
        tag([[`${base} ${Math.round(dist * Math.pow(10, d))} pts`], [base], [`${name} ${dist.toFixed(d)}`]], cx, top, bg, R - L + 16);
      };
      lab('Target', tp, yT, GREEN); lab('Stop', p.sl, yS, RED);
      // middle plate on the entry line: live P/L in R multiples (green in profit, red in loss) and the ratio
      const pl = num(now) ? p.dir * (now - p.entry) / risk : 0;
      const plTxt = `P/L ${pl < 0 ? '-' : '+'}${Math.abs(pl).toFixed(2)}R`;
      tag([[`Entry ${p.entry.toFixed(d)} | ${plTxt}`, `Risk/profit ratio: ${p.rr.toFixed(2)}`], [plTxt, `R:R ${p.rr.toFixed(2)}`]], cx, yE - LH - 2, pl >= 0 ? GREEN : RED, R - L + 16);
      const hs = [];
      if (isSel && !p.locked) {
        const lx = Math.max(7, L), rx = Math.min(W - 7, R), vy = y => clamp(y, 6, Hh - 6);
        hs.push({ k: 'sl', x: lx, y: vy(yS) }, { k: 'tp', x: lx, y: vy(yT) }, { k: 'move', x: lx, y: vy(yE) }, { k: 'width', x: rx, y: vy(yE) });
        g.lineWidth = 1.5; g.strokeStyle = BLUE; g.fillStyle = '#0C1109';
        hs.forEach(h => { g.fillRect(h.x - 5, h.y - 5, 10, 10); g.strokeRect(h.x - 5, h.y - 5, 10, 10); });
      }
      geo.items.push({ id: p.id, handles: hs, body: { x: L, y: Math.min(yS, yT), w: R - L, h: Math.abs(yS - yT) } });
    }
    g.lineWidth = 1; g.textBaseline = 'alphabetic'; g.font = `${FS}px ${MONO}`;
  }

  // ---------------------------------------------------------------- pointer handling
  // pointer position in chart coordinates (the canvas has borders and may be scaled by CSS)
  function local(cv, e) {
    const E = cv._pos.env, r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left - cv.clientLeft) * E.W / cv.clientWidth, y: (e.clientY - r.top - cv.clientTop) * E.Hh / cv.clientHeight };
  }
  function handleAt(cv, pt, reach) {
    const geo = cv._pos; if (!geo || hidden) return null; let best = null, bd = reach;
    for (const it of geo.items) if (it.id === sel) for (const h of it.handles) { const dd = Math.hypot(h.x - pt.x, h.y - pt.y); if (dd <= bd) { bd = dd; best = { id: it.id, k: h.k }; } }
    return best;
  }
  const bodyAt = (cv, pt) => {
    const geo = cv._pos; if (!geo || hidden) return null;
    for (let i = geo.items.length - 1; i >= 0; i--) { const b = geo.items[i].body; if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return geo.items[i].id; }
    return null;
  };
  const reachFor = e => e.pointerType === 'mouse' || e.type === 'mousemove' ? 11 : 22;     // fingers get a bigger target
  // true when this touch starts on a handle (app.js then stops the page from scrolling under the finger)
  function near(cv, t) { if (!cv._pos) return false; return !!handleAt(cv, local(cv, t), 24); }
  // pointer went down: true = a handle was grabbed (no panning), false = let the chart pan as usual
  function down(cv, e) {
    if (!cv._pos || hidden) return false;
    const pt = local(cv, e), h = handleAt(cv, pt, reachFor(e)), E = cv._pos.env;
    if (h) {
      const p = items.find(i => i.id === h.id); if (!p || p.locked) return false;
      drag = { id: p.id, k: h.k, pid: e.pointerId, start: { ...p }, price0: E.toPrice(pt.y), time0: E.toTime(pt.x) };
      cv._freeze = { lo: E.lo, hi: E.hi };                                // keep the price scale still while dragging
      tap = null; return true;
    }
    const id = bodyAt(cv, pt); tap = id ? { id, x: e.clientX, y: e.clientY, pid: e.pointerId } : null;
    return false;
  }
  function move(cv, e) {
    if (!drag || e.pointerId !== drag.pid) return false;
    const p = items.find(i => i.id === drag.id); if (!p || !cv._pos) { drag = null; return true; }
    const E = cv._pos.env, pt = local(cv, e), s0 = drag.start, price = E.toPrice(pt.y), dP = price - drag.price0, dT = E.toTime(pt.x) - drag.time0;
    const minRisk = Math.max(Math.pow(10, -E.digits), (E.hi - E.lo) * .002);
    if (drag.k === 'move') { p.entry = s0.entry + dP; p.sl = s0.sl + dP; p.t0 = s0.t0 + dT; p.t1 = s0.t1 + dT; }
    else if (drag.k === 'width') p.t1 = Math.max(p.t0 + E.ivl, E.toTime(pt.x));
    else if (drag.k === 'sl') p.sl = p.dir > 0 ? Math.min(price, p.entry - minRisk) : Math.max(price, p.entry + minRisk);
    else if (drag.k === 'tp') {                                           // the target handle sets the ratio
      let r = clamp(p.dir * (price - p.entry) / Math.abs(p.entry - p.sl), MIN_RR, MAX_RR); const g5 = Math.round(r * 2) / 2;
      if (Math.abs(r - g5) < .06 && g5 >= MIN_RR) r = g5;                 // snap to 1, 1.5, 2 ... when close
      p.rr = rrUser = Math.round(r * 100) / 100;
    }
    sync(); redraw(); return true;
  }
  function up(cv, e) {
    if (drag && e.pointerId === drag.pid) { drag = null; cv._freeze = null; save(); sync(); redraw(); return; }
    if (tap && tap.pid === e.pointerId) {                                 // a tap (not a pan) on another box selects it
      if (e.type === 'pointerup' && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 6 && tap.id !== sel) select(tap.id);
      tap = null;
    }
  }
  function hover(cv, e) {                                                 // mouse only: show which handle is under the pointer
    if (!cv._pos || drag) return;
    const h = handleAt(cv, local(cv, e), 11);
    cv.style.cursor = !h ? 'grab' : h.k === 'move' ? 'move' : h.k === 'width' ? 'ew-resize' : 'ns-resize';
  }

  return { open, toolsHtml, bind, sync, extent, draw, down, move, up, hover, near };
})();
