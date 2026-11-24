// PRICE ALERTS: pick a price on the chart and the bot messages you (with Telegram's notification sound) when price gets there.
//
//  1. Tap the bell (PRICE ALERT) in the symbol menu. A gold line appears at the live price.
//  2. Tap the chart where you want the alert, or drag the gold tag up or down, or type the price. Tap SET ALERT.
//  3. The line stays on the chart as a gold dashed line. Drag its tag to move it, or REMOVE it in the card.
//  Quick way, no card needed: HOLD your finger (or the mouse button) on the chart where you want the alert. A line appears with SET and X buttons
//  right on the chart; drag the line to fine tune it, then tap SET. The server watches the price, so it works with the app closed.
//  An alert fires once, then it is gone. The server watches the price, so it works with the app closed.
//
// The alerts live on the server (api/price-alerts), per person. app.js calls: open() when a symbol opens, btnHtml() + toolsHtml() when its
// page is drawn, bind() after that, draw() from chart(), and down() / move() / up() / near() from the chart's pointer handlers.
const PA = (() => {
  const GOLD = '#E3C16A', num = Number.isFinite;
  let sym = null, items = [], panel = false, draft = null, drag = null, tap = null, lastLoad = 0, digits = 2, note = '';
  let qd = null, qt = null, qm = null, qNote = '', qTimer = null, hold = null;   // qm = what the held line becomes: null (not chosen yet: the three chips show), 'alert' (price alert), 'plan' (position box) or 'snipe' (drawing tools); qt = time under the finger                        // quick alert: price of the line made by holding the chart, its message, the hold timer

  const canvas = () => document.getElementById('chart');
  const redraw = () => { const cv = canvas(), c = cv && cv._ctx; if (c) chart(cv, c.s, c.tf, c.name); };
  const env = () => { const cv = canvas(); return cv && cv._pa && cv._pa.env; };
  const live = () => { const E = env(); return E ? (E.price ?? E.last) : NaN; };
  const fmt = v => num(v) ? v.toFixed(digits) : '';
  const curTf = () => { const E = env(); return E ? E.tf : 'm5'; };            // the timeframe shown on the chart right now: where the alert is set
  const side = p => p > live() ? 1 : -1;

  function open(id) { sym = id; items = []; panel = false; draft = null; drag = tap = null; note = ''; qd = null; qNote = ''; clearHold(); load(id); }
  function load(id) {
    lastLoad = Date.now();
    api('/api/price-alerts?symbol=' + encodeURIComponent(id)).then(r => {
      if (sym !== id || drag) return;
      items = r.alerts || []; sync(); redraw();
    }).catch(() => { /* not signed in (outside Telegram): no alerts */ });
  }

  // ---------------------------------------------------------------- card
  const BELL = 'M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 004 0';
  const btnHtmlOld = () => `<button data-pa="panel" class="pabtn${panel ? ' on' : ''}" aria-label="Set a price alert"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${BELL}"/></svg><span>Price alert</span></button>`;
  const toolsHtmlOld = () => `<div class="pplan palert" hidden>
      <div class="pp-head"><b>PRICE ALERT</b><span class="pinfo"></span></div>
      <p class="pa-help">Tap the chart where you want the alert, or drag the gold tag. The bot messages you when price gets there.</p>
      <label class="pf"><span>ALERT PRICE<small class="pa-dist"></small></span><input data-pa-f type="number" inputmode="decimal" step="any" autocomplete="off"></label>
      <div class="pp-msg" role="alert"></div>
      <div class="pp-act"><button data-pa="set" class="pp-go">SET ALERT</button><button data-pa="cancel">CLOSE</button></div>
      <div class="pa-list"></div>
    </div>`;
  const btnHtml = () => '', toolsHtml = () => '';                                // no card and no menu button any more: everything starts from holding the chart
  const root = () => document.querySelector('.palert');

  function sync() {
    const r = root(); if (!r) return;
    r.hidden = !panel;
    const b = document.querySelector('.tmenu .pabtn'); if (b) b.classList.toggle('on', panel);
    if (!panel) return;
    r.querySelector('.pinfo').textContent = items.length ? `${items.length} set` : '';
    const inp = r.querySelector('input[data-pa-f]'); if (document.activeElement !== inp) inp.value = draft !== null ? fmt(draft) : '';
    const L = live(), dist = draft !== null && num(L) && L ? (draft - L) / L * 100 : NaN;
    r.querySelector('.pa-dist').textContent = num(dist) ? `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}% ${dist >= 0 ? 'above' : 'below'} the current price` : 'tap the chart to pick';
    r.querySelector('[data-pa=set]').disabled = draft === null;
    const m = r.querySelector('.pp-msg'); m.textContent = note; m.style.color = /^Alert set/.test(note) ? 'var(--up, #5AFF64)' : '';
    r.querySelector('.pa-list').innerHTML = items.map(a => `<div class="pa-row"><span class="${a.side === 1 ? 'up' : 'down'}">${a.side === 1 ? '&#9650;' : '&#9660;'} ${fmt(a.price)}</span><small>${a.side === 1 ? 'when price rises to it' : 'when price falls to it'}</small><button data-pa="del" data-id="${a.id}">REMOVE</button></div>`).join('');
  }

  function bind() {
    const bar = document.querySelector('.tmenu'), r = root(); if (!bar || !r) return;
    [bar, r].forEach(el => el.addEventListener('click', e => { const b = e.target.closest('button[data-pa]'); if (b && !b.disabled) act(b.dataset.pa, b.dataset.id); }));
    r.querySelector('input[data-pa-f]').addEventListener('input', e => { const v = parseFloat(e.target.value); draft = num(v) && v > 0 ? v : null; note = ''; sync(); redraw(); });
    sync();
  }

  const q10 = () => Math.pow(10, -digits) / 2;
  // One place that makes an alert (the card's SET ALERT and the quick SET button on the chart both come here).
  async function create(price) {
    if (Math.abs(price - live()) < q10()) throw new Error('Pick a price away from the current price.');
    const r = await api('/api/price-alerts', { method: 'POST', body: JSON.stringify({ symbol: sym, price, tf: curTf() }) });
    items.push(r.alert); note = 'Alert set. You will get a message when price gets there.';
    try { window.Telegram.WebApp.HapticFeedback.notificationOccurred('success'); } catch { /* not in Telegram */ }
  }
  function flash(msg) { qNote = msg; clearTimeout(qTimer); qTimer = setTimeout(() => { qNote = ''; redraw(); }, 3500); }
  // Battle plan / Sniper Mode from the held line: the held price is the entry (plan) or the inducement (sniper), the button picks the direction.
  function quickGo(dir) {
    if (qd === null) return;
    const price = qd, t = qt; qd = null; qNote = '';
    if (qm === 'plan' && typeof Pos !== 'undefined') Pos.fromHold(price, dir, t);
    else if (qm === 'snipe' && typeof Snipe !== 'undefined') Snipe.fromHold(price, dir, t);
    sync(); redraw();
  }
  async function quickSet() {
    if (qd === null) return;
    try { await create(qd); qd = null; qNote = ''; sync(); } catch (e) { flash(String(e.message || e)); }
    redraw();
  }
  async function act(a, id) {
    if (a === 'panel') { panel = !panel; note = ''; if (panel && typeof Snipe !== 'undefined') Snipe.close(); if (panel) { if (draft === null) draft = live(); if (!num(draft)) draft = null; } else draft = null; sync(); return redraw(); }
    if (a === 'cancel') { panel = false; draft = null; note = ''; sync(); return redraw(); }
    try {
      if (a === 'set') {
        if (draft === null) return;
        await create(draft); draft = null;
      } else if (a === 'del') {
        await api('/api/price-alerts/delete', { method: 'POST', body: JSON.stringify({ id }) });
        items = items.filter(x => x.id !== id); note = '';
      }
    } catch (e) { note = String(e.message || e); }
    sync(); redraw();
  }

  // ---------------------------------------------------------------- chart hooks
  function draw(g, cv, E) {
    const geo = cv._pa = { env: E, tags: [] };
    digits = E.digits;
    if (Date.now() - lastLoad > 10000 && sym && !drag) load(sym);              // an alert that fired is gone from the server: refresh the list now and then
    const { W, Hh, FS, LH, MONO, Y, taken, tw } = E, th = LH + 6;
    const rows = items.map(a => ({ id: a.id, price: a.price, isDraft: false })); if (panel && draft !== null) rows.push({ id: 'draft', price: draft, isDraft: true });
    if (qd !== null) rows.push({ id: 'quick', price: qd, isDraft: true, quick: true });
    g.font = `700 ${FS}px ${MONO}`; g.textBaseline = 'middle'; g.lineWidth = 1.5;
    for (const r of rows) {
      if (drag && drag.id === r.id && drag.price !== undefined) r.price = drag.price;
      const y0 = Y(r.price), y = Math.max(th / 2 + 2, Math.min(Hh - th / 2 - 2, y0)), off = y0 !== y, up = r.price > live();
      g.strokeStyle = r.isDraft ? '#FFFFFF' : GOLD; g.setLineDash(r.isDraft ? [3, 3] : [7, 4]); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
      if (r.quick && qm === null) {                                               // step 1: only the three chips on the line, nothing under it
        const labs = [['alert', 'PRICE ALERT'], ['plan', 'POSITION BOX'], ['snipe', 'DRAWING TOOLS']], XW = th + 4;
        let pad = 14, gap = 6; const total = () => labs.reduce((n, [, l]) => n + tw(l) - 10 + pad, 0) + gap * labs.length + XW + 8;
        if (total() > W) { pad = 8; gap = 3; }
        let cx = 4;
        for (const [m, lab] of labs) { const cw = tw(lab) - 10 + pad; g.fillStyle = '#FFFFFF'; g.fillRect(cx, y - th / 2, cw, th); g.fillStyle = '#0C1109'; g.fillText(lab, cx + pad / 2, y + .5); geo.tags.push({ id: 'qm-' + m, x: cx, y: y - th / 2, w: cw, h: th }); cx += cw + gap; }
        g.fillStyle = '#B03A2E'; g.fillRect(cx, y - th / 2, XW, th); g.fillStyle = '#fff'; g.fillText('✕', cx + 8, y + .5); geo.tags.push({ id: 'qx', x: cx, y: y - th / 2, w: XW, h: th });
        taken.push({ x: 4, y: y - th / 2, w: cx + XW - 4, h: th });
        continue;
      }
      const text = r.quick && qm !== 'alert' ? `${qm === 'plan' ? 'POSITION BOX' : 'DRAWING TOOLS'} ${r.price.toFixed(E.digits)}` : `${r.isDraft ? 'PRICE ALERT' : 'ALERT'} ${up ? '▲' : '▼'} ${r.price.toFixed(E.digits)}`, w = tw(text) + 4, x = 4, top = y - th / 2;
      g.fillStyle = r.isDraft ? '#FFFFFF' : GOLD; g.globalAlpha = off ? .75 : 1; g.fillRect(x, top, w, th); g.globalAlpha = 1;
      g.fillStyle = '#0C1109'; g.fillText(text, x + 7, y + .5);
      taken.push({ x, y: top, w, h: th }); geo.tags.push({ id: r.id, x, y: top, w, h: th, isDraft: r.isDraft });
      if (!r.isDraft) {                                                           // a saved alert: an X next to its tag removes it
        const bw = th + 4, bx = x + w + 6; g.fillStyle = '#B03A2E'; g.fillRect(bx, top, bw, th); g.fillStyle = '#fff'; g.fillText('✕', bx + 8, y + .5);
        geo.tags.push({ id: 'del-' + r.id, x: bx, y: top, w: bw, h: th }); taken.push({ x: bx, y: top, w: bw, h: th });
      }
      if (r.quick) {                                                              // action buttons next to the tag, mode chips under it, and a message when it did not work
        const btn = (id, label, bg, fg, bx, w0) => { const bw = w0 || tw(label) + 14; g.fillStyle = bg; g.fillRect(bx, top, bw, th); g.fillStyle = fg; g.fillText(label, bx + 7, y + .5); geo.tags.push({ id, x: bx, y: top, w: bw, h: th }); return bw; };
        let bx = x + w + 6;
        if (qm === 'alert') {
          const tooClose = Math.abs(r.price - live()) < q10();
          if (tooClose) { const bw = tw('TOO CLOSE') + 14; g.fillStyle = '#6B7480'; g.fillRect(bx, top, bw, th); g.fillStyle = '#0C1109'; g.fillText('TOO CLOSE', bx + 7, y + .5); bx += bw + 6; }
          else bx += btn('qset', 'SET', '#5AFF64', '#0C1109', bx) + 6;
        } else {
          bx += btn('qa+', qm === 'plan' ? '▲ BUY' : '▲ BULL', '#089981', '#fff', bx) + 6;
          bx += btn('qa-', qm === 'plan' ? '▼ SELL' : '▼ BEAR', '#F23645', '#fff', bx) + 6;
        }
        btn('qx', '✕', '#B03A2E', '#fff', bx, th + 4); bx += th + 4;
        taken.push({ x, y: top, w: bx - x, h: th });
        if (qNote) { g.fillStyle = '#FF8A7A'; g.fillText(qNote, x, Math.min(Hh - 8, top + th + 11)); }
      }
    }
    g.lineWidth = 1; g.textBaseline = 'alphabetic'; g.font = `${FS}px ${MONO}`;
  }

  function local(cv, e) {
    const E = cv._pa.env, r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left - cv.clientLeft) * E.W / cv.clientWidth, y: (e.clientY - r.top - cv.clientTop) * E.Hh / cv.clientHeight };
  }
  const tagAt = (cv, pt, reach) => (cv._pa ? cv._pa.tags : []).find(t => pt.x >= t.x - reach && pt.x <= t.x + t.w + reach && pt.y >= t.y - reach && pt.y <= t.y + t.h + reach) || null;
  const near = (cv, t) => !!(cv._pa && tagAt(cv, local(cv, t), 18));               // a finger on a tag: the page must not scroll
  function down(cv, e) {
    if (!cv._pa) return false;
    const pt = local(cv, e), t = tagAt(cv, pt, e.pointerType === 'mouse' ? 4 : 14), E = cv._pa.env;
    if (t && t.id === 'qset') { quickSet(); return true; }                          // the buttons act at once
    if (t && t.id.startsWith('del-')) { act('del', t.id.slice(4)); return true; }
    if (t && t.id === 'qx') { qd = null; qNote = ''; redraw(); return true; }
    if (t && t.id.startsWith('qm-')) { qm = t.id.slice(3); qNote = ''; redraw(); return true; }                    // pick what the held line becomes
    if (t && (t.id === 'qa+' || t.id === 'qa-')) { quickGo(t.id === 'qa+' ? 1 : -1); return true; }
    if (t) { drag = { id: t.id, pid: e.pointerId }; cv._freeze = { lo: E.lo, hi: E.hi }; tap = null; return true; }
    clearHold();
    if (!panel && pt.x < E.plotW && e.isPrimary !== false)               // hold the chart (about half a second, finger not moving) to make a quick alert
      hold = { pid: e.pointerId, x: e.clientX, y: e.clientY, cv, e: { clientX: e.clientX, clientY: e.clientY }, timer: setTimeout(startHold, 450) };
    tap = panel ? { x: e.clientX, y: e.clientY, pid: e.pointerId } : null;          // with the card open, a tap on the chart picks the price
    return false;
  }
  function clearHold() { if (hold) { clearTimeout(hold.timer); hold = null; } }
  function startHold() {
    const h = hold; hold = null; if (!h || !h.cv._pa || !h.cv.isConnected) return;
    const E = h.cv._pa.env, p = E.toPrice(local(h.cv, h.e).y); if (!(p > 0)) return;
    qd = Math.round(p * Math.pow(10, digits)) / Math.pow(10, digits); qNote = ''; qm = null; qt = E.toTime(local(h.cv, h.e).x);
    drag = { id: 'quick', pid: h.pid, price: qd }; h.cv._freeze = { lo: E.lo, hi: E.hi };   // the finger can keep dragging the line to the exact price
    try { window.Telegram.WebApp.HapticFeedback.impactOccurred('medium'); } catch { /* not in Telegram */ }
    redraw();
  }
  function move(cv, e) {
    if (hold && e.pointerId === hold.pid && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) clearHold();   // it moved: that is a pan, not a hold
    if (!drag || e.pointerId !== drag.pid || !cv._pa) return false;
    const p = cv._pa.env.toPrice(local(cv, e).y); if (!(p > 0)) return true;
    drag.price = Math.round(p * Math.pow(10, digits)) / Math.pow(10, digits);
    if (drag.id === 'draft') { draft = drag.price; sync(); }
    else if (drag.id === 'quick') qd = drag.price;
    redraw(); return true;
  }
  async function up(cv, e) {
    if (hold && e.pointerId === hold.pid) clearHold();
    if (drag && e.pointerId === drag.pid) {
      const d = drag; drag = null; cv._freeze = null;
      if (d.id === 'draft') { if (d.price !== undefined) draft = d.price; sync(); redraw(); return; }
      if (d.id === 'quick') { if (d.price !== undefined) qd = d.price; redraw(); return; }                // the line stays until SET or X
      const a = items.find(x => x.id === d.id);
      if (a && d.price !== undefined && d.price !== a.price) {
        try { const r = await api('/api/price-alerts/update', { method: 'POST', body: JSON.stringify({ id: a.id, price: d.price, tf: curTf() }) }); Object.assign(a, r.alert); note = ''; }
        catch (err) { note = String(err.message || err); }
      }
      sync(); redraw(); return;
    }
    if (tap && tap.pid === e.pointerId) {
      if (e.type === 'pointerup' && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 6 && cv._pa) {
        const p = cv._pa.env.toPrice(local(cv, e).y);
        if (p > 0) { draft = Math.round(p * Math.pow(10, digits)) / Math.pow(10, digits); note = ''; sync(); redraw(); }
      }
      tap = null;
    }
  }
  const close = () => { if (panel) { panel = false; draft = null; sync(); } };
  return { open, btnHtml, toolsHtml, bind, draw, down, move, up, near, close };
})();
