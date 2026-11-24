// BATTLE PLAN: long / short position boxes on the symbol chart.
//
//  The plan is three prices: ENTRY, STOP LOSS and TAKE PROFIT. The risk:reward ratio is simply what those prices work out to
//  (reward / risk). Nothing is fixed: change any price and the ratio follows; type a ratio and the take profit moves to match.
//
//  1. Tap BATTLE PLAN, pick LONG or SHORT, check the three prices, tap DEPLOY ON CHART.
//  2. The box appears on the chart (teal = profit zone, red = loss zone; the stop / entry / target prices are tags on the price axis). Drag its corner squares to adjust:
//     top/bottom-left square = stop or target, middle-left = move the whole box, right square = width.
//     Tap a box to select it; the plan card then shows and edits that box.
//  Boxes are anchored to time and price (they stay put across M5 / H1 / H4, zoom and pan) and are saved per symbol in localStorage.
//
// app.js calls: open() when a symbol opens, toolsHtml() + bind() when its page is drawn, extent() and draw() from chart(),
// and down() / move() / up() / hover() / near() from the chart's pointer handlers.
const Pos = (() => {
  const KEY = 'bj_pos_v1', GREEN = '#089981', RED = '#F23645', GREY = '#787B86', BLUE = '#4A7CFF', MAX_BOXES = 20;
  const num = Number.isFinite, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), r2 = v => Math.round(v * 100) / 100;
  let sym = null, items = [], sel = null, hidden = false, rrLast = null, drag = null, tap = null, draft = null, panel = false, digits = 2;

  const ok = p => p && typeof p.id === 'string' && (p.dir === 1 || p.dir === -1) && [p.t0, p.t1, p.entry, p.sl, p.tp].every(num)
    && p.t1 > p.t0 && p.dir * (p.entry - p.sl) > 0 && p.dir * (p.tp - p.entry) > 0;
  // boxes saved by the first version stored a fixed ratio instead of a take profit: convert them
  const upgrade = p => p && p.tp === undefined && num(p.rr) ? { ...p, tp: p.entry + p.dir * p.rr * Math.abs(p.entry - p.sl) } : p;
  const read = () => { try { const o = JSON.parse(localStorage.getItem(KEY)); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
  function save() {
    try {
      const o = read(); o.syms = o.syms && typeof o.syms === 'object' ? o.syms : {};
      if (sym) { if (items.length) o.syms[sym] = { items, sel }; else delete o.syms[sym]; }
      o.hidden = hidden; o.rrLast = rrLast; localStorage.setItem(KEY, JSON.stringify(o));
    } catch { /* storage not available: the boxes then last until the page is closed */ }
  }
  const cur = () => items.find(p => p.id === sel) || null;
  const work = () => cur() || draft;                                   // the plan the card is showing: the selected box, else the new-plan draft
  const riskOf = p => Math.abs(p.entry - p.sl), rewardOf = p => Math.abs(p.tp - p.entry);
  const rrOf = p => rewardOf(p) / riskOf(p);
  const canvas = () => document.getElementById('chart');
  const env = () => { const cv = canvas(); return cv && cv._pos && cv._pos.env; };
  const redraw = () => { const cv = canvas(), c = cv && cv._ctx; if (c) chart(cv, c.s, c.tf, c.name); };

  function open(id) {
    sym = id; drag = tap = null; panel = false;
    const o = read(), e = o.syms && o.syms[id];
    items = (e && Array.isArray(e.items) ? e.items : []).map(upgrade).filter(ok);
    sel = items.some(p => p.id === (e && e.sel)) ? e.sel : items.length ? items[items.length - 1].id : null;
    hidden = !!o.hidden; rrLast = num(o.rrLast) && o.rrLast > 0 ? o.rrLast : null; draft = null;
  }

  // ---------------------------------------------------------------- plan card
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const IC = {
    aim: 'M12 2v5M12 17v5M2 12h5M17 12h5M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z', eyeoff: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM3 3l18 18',
  };
  const field = (f, label, hint) => `<label class="pf"><span>${label}<small>${hint}</small></span><input data-f="${f}" type="number" inputmode="decimal" step="any" autocomplete="off"></label>`;
  // the BATTLE PLAN button itself lives in the mini menu that app.js draws (.tmenu); this is the card it opens
  const toolsHtml = () => `<div class="pplan" hidden>
      <div class="pp-head"><b>BATTLE PLAN</b><span class="pp-mode"></span><span class="pinfo"></span><button data-p="eye" aria-label="Show or hide all plan boxes"></button></div>
      <div class="pp-dir"><button data-p="long">&#9650; BULLISH <small>(buy)</small></button><button data-p="short">&#9660; BEARISH <small>(sell)</small></button></div>
      <div class="pp-grid">${field('entry', 'ENTRY', 'where you get in')}${field('sl', 'STOP LOSS', 'where you admit you are wrong')}${field('tp', 'TAKE PROFIT', 'where you cash out')}
        <label class="pf pf-rr"><span>RISK : REWARD<small>follows the prices above</small></span><em>1 :</em><input data-f="rr" type="number" inputmode="decimal" step="any" autocomplete="off"></label></div>
      <div class="pp-msg" role="alert"></div>
      <div class="pp-act"><button data-p="deploy" class="pp-go">DEPLOY ON CHART</button><button data-p="new">NEW PLAN</button><button data-p="lock"></button><button data-p="del" class="pp-del">REMOVE</button></div>
    </div>`;

  function sync() {
    const root = document.querySelector('.pplan'); if (!root) return;
    const w = work(), q = s => root.querySelector(s), tb = document.querySelector('.tmenu');
    root.hidden = !panel; if (tb) tb.querySelector('.planbtn').classList.toggle('on', panel);
    root.querySelector('.pinfo').textContent = items.length ? `${items.length} on chart` : '';
    const eye = root.querySelector('[data-p=eye]'); eye.innerHTML = svg(hidden ? IC.eyeoff : IC.eye); eye.classList.toggle('on', hidden); eye.disabled = !items.length;
    if (!panel || !w) return;
    q('.pp-mode').textContent = sel ? 'plan on the chart' : 'new plan';
    q('[data-p=long]').classList.toggle('on', w.dir === 1); q('[data-p=short]').classList.toggle('on', w.dir === -1);
    const vals = { entry: w.entry, sl: w.sl, tp: w.tp, rr: num(w.entry + w.sl + w.tp) ? r2(rrOf(w)) : NaN };
    root.querySelectorAll('input[data-f]').forEach(i => { if (document.activeElement !== i) { const v = vals[i.dataset.f]; i.value = num(v) ? (i.dataset.f === 'rr' ? String(v) : v.toFixed(digits)) : ''; } });
    q('[data-p=deploy]').hidden = !!sel;
    ['new', 'lock', 'del'].forEach(k => { q(`[data-p=${k}]`).hidden = !sel; });
    q('[data-p=lock]').textContent = cur() && cur().locked ? 'UNLOCK' : 'LOCK';
  }
  const msg = t => { const m = document.querySelector('.pp-msg'); if (m) m.textContent = t || ''; };

  // a fresh draft: live price as entry, one ATR of stop (never less than two label heights on screen), target at the last ratio you used
  function suggest(dir) {
    const E = env(); if (E) digits = E.digits;
    const entry = E ? (E.price ?? E.last) : NaN, ppx = E ? (E.hi - E.lo) / (E.Hh - 14 - E.TOP) : NaN;
    const risk = E ? Math.max((E.atr && E.atr[E.tf]) || 0, ppx * E.LH * 2) : NaN;
    return { dir, entry, sl: entry - dir * risk, tp: entry + dir * risk * (rrLast ?? 1) };
  }
  function problem(n) {
    if (![n.entry, n.sl, n.tp].every(num)) return 'Fill in all three prices.';
    if (!(n.dir * (n.entry - n.sl) > 0)) return n.dir > 0 ? 'For a BULLISH plan the stop loss must be below the entry.' : 'For a BEARISH plan the stop loss must be above the entry.';
    if (!(n.dir * (n.tp - n.entry) > 0)) return n.dir > 0 ? 'For a BULLISH plan the take profit must be above the entry.' : 'For a BEARISH plan the take profit must be below the entry.';
    return '';
  }
  function onField(f, raw) {
    const w = work(); if (!w) return; const v = parseFloat(raw);
    if (!num(v)) return msg('Type a number.');
    const n = { ...w };
    if (f === 'rr') { if (!(v > 0)) return msg('The ratio must be above zero.'); n.tp = n.entry + n.dir * v * riskOf(n); } else n[f] = v;
    const err = problem(n); if (err) return msg(err);
    w.entry = n.entry; w.sl = n.sl; w.tp = n.tp; msg('');
    if (sel) { rrLast = rrOf(w); save(); redraw(); }
    sync();
  }
  function setDir(d) {
    const w = work(); if (!w || w.dir === d) return;
    w.sl = 2 * w.entry - w.sl; w.tp = 2 * w.entry - w.tp; w.dir = d; msg('');     // mirror the plan around the entry, same distances
    if (sel) { save(); redraw(); }
    sync();
  }
  function deploy() {
    const E = env(), n = draft; if (!E || !n) return msg('The chart is not ready yet.');
    const err = problem(n); if (err) return msg(err);
    // time slot: right third of the screen first, then the middle, then the left, so new boxes do not pile up
    const cnt = Math.max(4, Math.round(E.plotW / E.step * .3)), span = cnt * E.ivl;
    let t0 = E.toTime(E.plotW * .7);
    for (const f of [.7, .35, .05]) { const t = E.toTime(E.plotW * f); if (!items.some(p => p.t0 < t + span && p.t1 > t)) { t0 = t; break; } }
    hidden = false; if (items.length >= MAX_BOXES) items.shift();
    const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), dir: n.dir, t0, t1: t0 + span, entry: n.entry, sl: n.sl, tp: n.tp };
    items.push(p); sel = p.id; rrLast = rrOf(p); draft = null; panel = false; msg(''); save(); sync(); redraw();   // close the card so the chart is in view
    const cv = canvas(); if (cv && cv.scrollIntoView) cv.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function bind() {
    const bar = document.querySelector('.tmenu'), root = document.querySelector('.pplan'); if (!bar || !root) return;
    if (panel && !cur() && !draft) draft = suggest(1);
    [bar, root].forEach(el => el.addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (b && !b.disabled) act(b.dataset.p); }));
    root.querySelectorAll('input[data-f]').forEach(i => {
      i.addEventListener('input', () => onField(i.dataset.f, i.value));
      i.addEventListener('blur', () => { msg(''); sync(); });                // leaving a field with a bad value snaps it back to the last good one
    });
    sync();
  }
  function act(a) {
    const p = cur();
    if (a === 'panel') { panel = !panel; if (panel && typeof Snipe !== 'undefined') Snipe.close(); if (panel && !p && !draft) draft = suggest(1); msg(''); return sync(); }
    if (a === 'long') return setDir(1);
    if (a === 'short') return setDir(-1);
    if (a === 'deploy') return deploy();
    if (a === 'new') { draft = suggest(p ? p.dir : 1); sel = null; msg(''); save(); sync(); return redraw(); }
    if (a === 'eye') hidden = !hidden;
    else if (a === 'lock' && p) p.locked = !p.locked;
    else if (a === 'del' && p) { items = items.filter(i => i !== p); sel = items.length ? items[items.length - 1].id : null; if (!sel) draft = suggest(p.dir); }
    save(); sync(); redraw();
  }
  // Held-chart shortcut: the held price is the entry, the stop is one ATR away (same as the card's starter) and the target follows your last ratio.
  function fromHold(price, dir) {
    const base = suggest(dir), risk = Math.abs(base.entry - base.sl);
    if (!num(price) || !num(risk) || risk <= 0) { panel = true; draft = suggest(dir); msg('Set the stop loss and take profit.'); return sync(); }
    draft = { dir, entry: price, sl: price - dir * risk, tp: price + dir * risk * (rrLast ?? 1) };
    if (typeof Snipe !== 'undefined') Snipe.close();
    deploy();
  }
  function select(id) { sel = id; msg(''); save(); sync(); redraw(); }

  // ---------------------------------------------------------------- chart hooks
  // price range that the boxes visible in [a, b] (candle times) need, so chart() can keep them on screen
  function extent(a, b) {
    if (hidden) return null; let lo = Infinity, hi = -Infinity;
    for (const p of items) { if (p.t1 < a || p.t0 > b) continue; lo = Math.min(lo, p.sl, p.entry, p.tp); hi = Math.max(hi, p.sl, p.entry, p.tp); }
    return lo <= hi ? [lo, hi] : null;
  }

  function draw(g, cv, E) {
    const geo = cv._pos = { env: E, items: [] };
    digits = E.digits;
    if (hidden || !items.length) return;
    const { W, Hh, FS, LH, MONO, Y, taken } = E, d = E.digits;
    const X = t => (t - E.cs0) / E.ivl * E.step + E.step / 2;
    g.font = `${FS}px ${MONO}`; g.textBaseline = 'middle'; g.setLineDash([]);
    // Simple position box (like the TradingView position tool): two flat zones, a thin entry line, and the stop / entry / target
    // prices as tags on the right-hand price axis. No outlines, no text inside the box. Tags show for the selected box only.
    const axisTag = (price, y, bg) => {
      const text = price.toFixed(d), w = E.tw(text), h = LH + 2, top = clamp(y - h / 2, 1, Hh - h - 1), x = W - w - 2;
      g.fillStyle = bg; g.fillRect(x, top, w, h); g.fillStyle = '#fff'; g.fillText(text, x + 5, top + h / 2 + .5);
      taken.push({ x, y: top, w, h });
    };
    for (const p of items.slice().sort((a, b) => (a.id === sel) - (b.id === sel))) {      // the selected box is drawn last, on top
      const a = X(p.t0), b = X(p.t1), L = Math.max(0, Math.min(a, b)), R = Math.min(W, Math.max(a, b));
      if (R <= 0 || L >= W || R - L < 1) continue;
      const yE = Y(p.entry), yS = Y(p.sl), yT = Y(p.tp), isSel = p.id === sel;
      g.fillStyle = 'rgba(8,153,129,.24)'; g.fillRect(L, Math.min(yE, yT), R - L, Math.abs(yT - yE));       // profit zone: teal
      g.fillStyle = 'rgba(242,54,69,.24)'; g.fillRect(L, Math.min(yE, yS), R - L, Math.abs(yS - yE));       // loss zone: red
      g.strokeStyle = 'rgba(178,181,190,.75)'; g.lineWidth = 1; g.beginPath(); g.moveTo(L, yE); g.lineTo(R, yE); g.stroke();
      if (isSel) { axisTag(p.sl, yS, RED); axisTag(p.tp, yT, GREEN); axisTag(p.entry, yE, GREY); }
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
    const gap = Math.max(Math.pow(10, -E.digits), (E.hi - E.lo) * .002);                 // stop and target can never cross the entry
    if (drag.k === 'move') { p.entry = s0.entry + dP; p.sl = s0.sl + dP; p.tp = s0.tp + dP; p.t0 = s0.t0 + dT; p.t1 = s0.t1 + dT; }
    else if (drag.k === 'width') p.t1 = Math.max(p.t0 + E.ivl, E.toTime(pt.x));
    else if (drag.k === 'sl') p.sl = p.dir > 0 ? Math.min(price, p.entry - gap) : Math.max(price, p.entry + gap);
    else if (drag.k === 'tp') p.tp = p.dir > 0 ? Math.max(price, p.entry + gap) : Math.min(price, p.entry - gap);
    sync(); redraw(); return true;
  }
  function up(cv, e) {
    if (drag && e.pointerId === drag.pid) { const p = cur(); if (p) rrLast = rrOf(p); drag = null; cv._freeze = null; save(); sync(); redraw(); return; }
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

  const isOpen = () => panel;
  const close = () => { panel = false; sync(); };
  return { open, isOpen, close, fromHold, toolsHtml, bind, sync, extent, draw, down, move, up, hover, near };
})();
