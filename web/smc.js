// SMC overlay: market structure, BOS, CHoCH, inducement (IDM, a box on the demand / supply zone of each BOS / CHoCH), liquidity sweeps and equal highs / lows drawn on the symbol chart.
// The marks come from the server's SMC engine (server/smc.js) over a live Server-Sent Events stream (/api/smc/stream), which is fed by the Deriv WebSocket,
// so a BOS or a sweep appears the moment the candle closes, and the forming candle shows a dashed provisional preview.
//
// app.js calls: open(id) when a symbol opens, barHtml() + bind() when its page is drawn, and draw(g, cv, E) from chart() (the main chart only).
const SMC = (() => {
  const KEY = 'bj_smc_v1';
  const COL = { bos: '#6EA8FE', choch: '#FFA94D', idm: '#B197FC', sweep: '#F06292', eq: '#CBD5E1', swing: '#8A94A6' };
  const HIDE = { choch: 1, sweep: 1 };                                // drawn nowhere: CHoCH marks and liquidity sweeps (the engine still tracks them)
  const ZN = ['IDM', 'DISR', 'LIQ'];                                  // the 3 newest IDM zones, newest first: inducement, disruption, liquidity zone
  const LAYERS = [['st', 'STRUCTURE'], ['idm', 'IDM'], ['liq', 'LIQUIDITY']];
  let pref = { on: true, st: true, idm: true, liq: true };
  try { Object.assign(pref, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage blocked: defaults */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch { /* ignore */ } };

  const fresh = (sym) => ({ sym, tf: null, ann: new Map(), live: [], trend: 0, state: 'idle', flash: null, ac: null, tried: 0 });
  let st = fresh(null), lastDraw = 0, raf = 0;

  const redraw = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const cv = document.getElementById('chart'), c = cv && cv._ctx; if (c) chart(cv, c.s, c.tf, c.name); });
  };

  function open(id) { stop(); st = fresh(id); }
  function stop() { if (st.ac) { try { st.ac.abort(); } catch { /* ignore */ } st.ac = null; } }

  // ------------------------------------------------------------ live stream
  const NOTABLE = { bos: 1 };
  function onSnapshot(snap) {
    st.ann = new Map((snap.annotations || []).map((a) => [a.id, a]));
    st.live = snap.live || []; st.trend = snap.trend || 0; st.state = snap.state || 'live';
    redraw();
  }
  function onUpdate(m) {
    for (const a of m.changed || []) {
      const old = st.ann.get(a.id); st.ann.set(a.id, a);
      if (NOTABLE[a.type] || (a.type === 'idm' && a.status === 'swept' && !(old && old.status === 'swept'))) st.flash = { a, at: Date.now() };
    }
    if (st.ann.size > 500) for (const k of st.ann.keys()) { st.ann.delete(k); if (st.ann.size <= 400) break; }
    st.trend = m.trend || 0; st.live = []; redraw();
  }
  function onFrame(ev, data) {
    if (ev === 'snapshot') onSnapshot(data); else if (ev === 'update') onUpdate(data);
    else if (ev === 'live') { st.live = data.live || []; redraw(); }
  }

  async function connect(sym, tf) {
    stop();
    const ac = st.ac = new AbortController(), me = st; st.tf = tf; st.state = 'connecting'; st.tried = Date.now();
    try {
      const res = await fetch(`/api/smc/stream?symbol=${encodeURIComponent(sym)}&tf=${tf}`, { headers: { 'X-Telegram-Init-Data': tg ? tg.initData : '' }, signal: ac.signal });
      if (!res.ok) { me.state = res.status === 404 || res.status === 400 ? 'off' : 'error'; return; }
      const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let k; while ((k = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, k); buf = buf.slice(k + 2);
          const m = /^event: (\w+)\ndata: (.*)$/s.exec(raw);
          if (m && st === me && st.tf === tf) { try { onFrame(m[1], JSON.parse(m[2])); } catch { /* bad frame */ } }
        }
      }
    } catch { /* aborted or dropped: draw() reconnects */ }
    if (st === me && me.ac === ac) { me.ac = null; if (me.state !== 'off') me.state = 'down'; }
  }

  // called on every chart draw: make sure the stream matches the timeframe on screen (and reconnect a dropped one, at most every 3 s)
  function ensure(tf) {
    lastDraw = Date.now();
    if (!st.sym) return;
    if (st.tf !== tf) { st.ann = new Map(); st.live = []; st.flash = null; st.state = 'idle'; connect(st.sym, tf); return; }
    if (!st.ac && st.state !== 'off' && Date.now() - st.tried > 3000) connect(st.sym, tf);
  }
  setInterval(() => { if (st.ac && Date.now() - lastDraw > 25000) stop(); }, 10000);     // chart gone (left the symbol page): close the stream

  // ------------------------------------------------------------ chips under the timeframe buttons
  const barHtml = () => `<div class="chips smcbar" role="group" aria-label="SMC indicator"><button class="chip${pref.on ? ' on' : ''}" data-smc="on" aria-pressed="${pref.on}">SMC</button>` +
    LAYERS.map(([k, name]) => `<button class="chip${pref.on && pref[k] ? ' on' : ''}" data-smc="${k}" aria-pressed="${pref.on && pref[k]}"${pref.on ? '' : ' disabled'}>${name}</button>`).join('') + '</div>';
  function bind() {
    document.querySelectorAll('.smcbar button[data-smc]').forEach((b) => b.onclick = () => {
      const k = b.dataset.smc; pref[k] = !pref[k]; save();
      document.querySelectorAll('.smcbar button[data-smc]').forEach((x) => {
        const kk = x.dataset.smc, on = kk === 'on' ? pref.on : pref.on && pref[kk];
        x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); if (kk !== 'on') x.disabled = !pref.on;
      });
      if (!pref.on) stop(); redraw();
    });
  }

  // ------------------------------------------------------------ drawing
  function draw(g, cv, E) {
    ensure(E.tf);
    if (!pref.on || st.state === 'off') return;
    const { FS, MONO, Y, plotW, step, ivl, cs0, lo, hi } = E, fs = Math.max(9, FS - 1);
    const X = (t) => (t - cs0) / ivl * step + step / 2;
    const tEnd = cs0 + (plotW / step) * ivl, y = (p) => Y(p);
    const items = [...st.ann.values(), ...st.live.filter((a) => !st.ann.has(a.id))];
    g.save(); g.textBaseline = 'alphabetic'; g.lineWidth = 1.2;
    const hit = (a, r) => a.x < r.x + r.w && a.x + a.w > r.x && a.y < r.y + r.h && a.y + a.h > r.y;
    // a label with a dark backing. nudge: when it would sit on another label (ours, the title, the app's own tags) move it up / down to the nearest free slot, or skip it
    const text = (s, x, yy, col, align = 'center', bg = true, alpha = 1, nudge = false) => {
      g.font = `700 ${fs}px ${MONO}`; const w = Math.ceil(g.measureText(s).width) + 6, h = fs + 3;
      let bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x; bx = Math.max(1, Math.min(plotW - w, bx));
      let by = yy - fs;
      if (nudge) {
        let ok = false;
        for (const k of [0, -1, 1, -2, 2, -3, 3]) { const r = { x: bx, y: yy - fs + k * (h + 1), w, h }; if (r.y > 2 && r.y + h < E.Hh - 14 && !E.taken.some((t) => hit(r, t))) { by = r.y; ok = true; break; } }
        if (!ok) return;
      }
      g.globalAlpha = alpha;
      if (bg) { g.fillStyle = 'rgba(0,0,0,.78)'; g.fillRect(bx, by, w, h); }
      g.fillStyle = col; g.textAlign = 'left'; g.fillText(s, bx + 3, by + fs); g.globalAlpha = 1;
      E.taken.push({ x: bx, y: by, w, h });
    };
    const labels = [];                                                // drawn after all lines, most important first: CHoCH > BOS > sweep > IDM
    const label = (prio, ...args) => labels.push({ prio, args });
    const line = (x0, x1, p, col, dash, alpha = 1) => {
      g.globalAlpha = alpha; g.strokeStyle = col; g.setLineDash(dash); g.beginPath(); g.moveTo(x0, Math.round(y(p)) + .5); g.lineTo(x1, Math.round(y(p)) + .5); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    };
    const zr = new Map();                                                                         // zone IDM id -> 0 (IDM), 1 (disruption), 2 (liquidity zone); older zones are not drawn
    items.filter((a) => a.type === 'idm' && a.hi != null && a.status !== 'void').sort((p, q) => q.t0 - p.t0).slice(0, ZN.length).forEach((a, k) => zr.set(a.id, k));
    for (const a of items.sort((p, q) => (p.t1 ?? p.t0) - (q.t1 ?? q.t0))) {
      if (HIDE[a.type]) continue;
      const end = a.t1 ?? (a.type === 'idm' ? tEnd : a.t0);
      if (end < cs0 - ivl || a.t0 > tEnd) continue;                                              // outside the visible candles
      const yy = y(a.price); if (yy < 0 || yy > E.Hh) continue;
      const x0 = Math.max(0, X(a.t0)), x1 = Math.min(plotW, X(end)), pv = a.provisional, al = pv ? .6 : 1, dash = pv ? [2, 3] : null;
      if (a.type === 'swing') {
        if (!pref.st || step < 5 || !/^(HH|HL|LH|LL)$/.test(a.label) || (E.marks && E.marks.has(a.t0 + '|' + a.label))) continue;      // the app already tags its own order flow swings
        const x = X(a.t0); if (x < 4 || x > plotW - 4) continue;
        const hi_ = a.label === 'HH' || a.label === 'LH';
        g.font = `600 ${fs - 1}px ${MONO}`; g.textAlign = 'center'; g.fillStyle = COL.swing; if (hi_ ? yy - 15 > 12 : yy + 16 < E.Hh - 18) g.fillText(a.label, x, hi_ ? yy - 15 : yy + 16);
      } else if (a.type === 'bos' || a.type === 'choch') {
        if (!pref.st) continue;
        const col = COL[a.type], lab = a.label + (pv ? ' …' : '');
        line(x0, x1, a.price, col, dash || (a.type === 'bos' ? [] : [6, 3]), al);
        label(a.type === 'choch' ? 4 : 3, lab, (x0 + x1) / 2, a.dir === 1 ? yy - 4 : yy + fs + 5, col, 'center', true, al, true);
      } else if (a.type === 'idm') {
        if (!pref.idm || a.status === 'void') continue;
        const sw = a.status === 'swept';
        if (a.hi != null && a.lo != null) {
          if (!zr.has(a.id)) continue;
          const nm = ZN[zr.get(a.id)];                                                      // zone mode: the IDM is the demand / supply zone of a BOS / CHoCH
          const yt = Math.round(y(a.hi)), yb = Math.round(y(a.lo)), h = Math.max(2, yb - yt);
          g.globalAlpha = (pv ? .6 : sw ? .75 : 1) * .16; g.fillStyle = COL.idm; g.fillRect(x0, yt, Math.max(2, x1 - x0), h);
          g.globalAlpha = pv ? .6 : sw ? .75 : 1; g.strokeStyle = COL.idm; g.setLineDash([1.5, 3.5]); g.strokeRect(x0 + .5, yt + .5, Math.max(2, x1 - x0), h); g.setLineDash([]); g.globalAlpha = 1;
          label(1, nm + (sw ? ' \u2713' : pv ? ' …' : ''), x0 + 18, a.dir === 1 ? yb + fs + 5 : yt - 4, COL.idm, 'center', true, al, true);
          continue;
        }
        line(x0, x1, a.price, COL.idm, [1.5, 3.5], pv ? .6 : sw ? .75 : 1);
        label(1, 'IDM' + (sw ? ' \u2713' : pv ? ' …' : ''), Math.max(x0 + 18, 22), a.dir === 1 ? yy + fs + 5 : yy - 4, COL.idm, 'center', true, al, true);
      } else if (a.type === 'eq') {
        if (!pref.liq) continue;
        line(x0, x1, a.price, COL.eq, [1.5, 3], .85);
      } else if (a.type === 'sweep') {
        if (!pref.liq) continue;
        const buy = a.side === 'buy', xs = X(a.t1);
        line(x0, Math.min(plotW, xs), a.price, COL.sweep, dash || [3, 3], al);
        if (xs >= 0 && xs <= plotW) {
          const yw = y(a.wick);
          g.globalAlpha = al; g.fillStyle = COL.sweep; g.beginPath(); g.arc(xs, yw + (buy ? -3 : 3), 3, 0, 7); g.fill(); g.globalAlpha = 1;       // the wick tip that took the liquidity
          label(2, (a.label || 'SWEEP') + (pv ? ' …' : ''), xs, buy ? yw - 9 : yw + fs + 8, COL.sweep, 'center', true, al, true);
        }
      }
    }
    labels.sort((p, q) => q.prio - p.prio).forEach((l) => text(...l.args));
    // trend tag and the latest event, top right
    const tr = st.trend, tag = `SMC ${tr === 1 ? '▲ BULL' : tr === -1 ? '▼ BEAR' : '● FLAT'}${st.state === 'live' ? '' : ' · ' + (st.state === 'connecting' ? '...' : st.state === 'idle' ? '...' : 'reconnecting')}`;
    text(tag, plotW - 4, 4 + fs + 6, tr === 1 ? '#26A69A' : tr === -1 ? '#EF5350' : '#787B86', 'right', true);
    if (st.flash && Date.now() - st.flash.at < 12000) {
      const a = st.flash.a, d = new Date(a.t1 * 1000), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      text(`${a.dir === 1 ? '▲' : '▼'} ${a.type === 'idm' ? (ZN[zr.get(a.id)] || 'IDM') + ' \u2713' : a.label} ${hm}`, plotW - 4, 4 + 2 * (fs + 6) + 3, COL[a.type] || '#fff', 'right', true);
      setTimeout(redraw, 12100 - (Date.now() - st.flash.at));
    }
    g.restore();
  }

  return { open, barHtml, bind, draw };
})();
