// SMC overlay: market structure, BOS, inducement (IDM, a box on the demand / supply zone of the BOS: IDM = latest BOS in the trend direction, DISR = the one before, LIQ = before that), liquidity sweeps and equal highs / lows drawn on the symbol chart.
// The marks come from the server's SMC engine (server/smc.js) over a live Server-Sent Events stream (/api/smc/stream), which is fed by the Deriv WebSocket,
// so a BOS or a sweep appears the moment the candle closes, and the forming candle shows a dashed provisional preview.
//
// It also draws the SORK rules run on this SMC order flow (IDM = inducement, DISR = disruption): the key level box (H1), its M5 POI box, the 50% POI and the bjeff zone (M5),
// the QML and the reclamation progress. Those come from the server (/api/smc/flow, polled every few seconds), not from the stream.
//
// app.js calls: open(id) when a symbol opens, barHtml() + bind() when its page is drawn, and draw(g, cv, E) from chart() (the main chart only).
const SMC = (() => {
  const KEY = 'bj_smc_v1';
  const COL = { bos: '#6EA8FE', idm: '#B197FC', sweep: '#F06292', eq: '#CBD5E1', swing: '#8A94A6', kl: '#FFD166', qml: '#FF8A65', adv: '#FFF59D', dead: '#8A94A6', rec: '#69F0AE' };
  // BOS lines + labels: H1 = the BOS that carry the IDM and the DISR and every BOS after them; H4 = every BOS in view; no BOS on any other timeframe (M5). Swing labels (HH / HL / LH / LL) are not drawn at all.
  const HIDE = { sweep: 1 };                                          // drawn nowhere: liquidity sweeps (the engine still tracks them)
  const ZN = { idm: 'IDM', disr: 'DISR', liq: 'LIQ' };                // zone roles set by the engine (latest BOS in the trend direction, the one before, the one before that)
  const EXT = { idm: 1, disr: 1 };                                    // these boxes run on to the right, slightly past the forming candle
  const LAYERS = [['st', 'STRUCTURE'], ['idm', 'IDM'], ['kl', 'KEY LEVEL'], ['liq', 'LIQUIDITY']];
  let pref = { on: true, st: true, idm: true, kl: true, liq: true };
  try { Object.assign(pref, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage blocked: defaults */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch { /* ignore */ } };

  // Two streams: `main` = the timeframe on screen, `ref` = the H1 stream that the M5 chart follows (H1 trend and H1 IDM / DISR / LIQ zones). Other timeframes need no ref.
  const feed = () => ({ tf: null, ann: new Map(), live: [], trend: 0, state: 'idle', ac: null, tried: 0 });
  const fresh = (sym) => ({ sym, main: feed(), ref: feed(), flash: null, flow: { state: null, at: 0, busy: false, off: false } });
  let st = fresh(null), lastDraw = 0, raf = 0;
  const REF = { m5: 'h1' };                                           // chart timeframe -> the timeframe whose trend and zones it shows

  const redraw = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const cv = document.getElementById('chart'), c = cv && cv._ctx; if (c) chart(cv, c.s, c.tf, c.name); });
  };

  function open(id) { stop(); st = fresh(id); }
  function halt(f) { if (f.ac) { try { f.ac.abort(); } catch { /* ignore */ } f.ac = null; } }
  function stop() { halt(st.main); halt(st.ref); }

  // ------------------------------------------------------------ live stream
  const NOTABLE = { bos: 1 };
  function onSnapshot(f, snap) {
    f.ann = new Map((snap.annotations || []).map((a) => [a.id, a]));
    f.live = snap.live || []; f.trend = snap.trend || 0; f.state = snap.state || 'live';
    redraw();
  }
  function onUpdate(f, m) {
    for (const a of m.changed || []) {
      const old = f.ann.get(a.id); f.ann.set(a.id, a);
      if ((NOTABLE[a.type] && f === st.main && f.tf === 'h1') || (a.type === 'idm' && a.status === 'swept' && !(old && old.status === 'swept'))) st.flash = { a, at: Date.now() };
    }
    if (f.ann.size > 500) for (const k of f.ann.keys()) { f.ann.delete(k); if (f.ann.size <= 400) break; }
    f.trend = m.trend || 0; f.live = []; redraw();
  }
  function onFrame(f, ev, data) {
    if (ev === 'snapshot') onSnapshot(f, data); else if (ev === 'update') onUpdate(f, data);
    else if (ev === 'live') { f.live = data.live || []; redraw(); }
  }

  async function connect(f, sym, tf) {
    halt(f);
    const ac = f.ac = new AbortController(), me = st; f.tf = tf; f.state = 'connecting'; f.tried = Date.now();
    try {
      const res = await fetch(`/api/smc/stream?symbol=${encodeURIComponent(sym)}&tf=${tf}`, { headers: { 'X-Telegram-Init-Data': tg ? tg.initData : '' }, signal: ac.signal });
      if (!res.ok) { f.state = res.status === 404 || res.status === 400 ? 'off' : 'error'; return; }
      const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let k; while ((k = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, k); buf = buf.slice(k + 2);
          const m = /^event: (\w+)\ndata: (.*)$/s.exec(raw);
          if (m && st === me && f.tf === tf) { try { onFrame(f, m[1], JSON.parse(m[2])); } catch { /* bad frame */ } }
        }
      }
    } catch { /* aborted or dropped: draw() reconnects */ }
    if (st === me && f.ac === ac) { f.ac = null; if (f.state !== 'off') f.state = 'down'; }
  }

  // keep one feed on the wanted timeframe (null = none): switch, or reconnect a dropped stream (at most every 3 s)
  function keep(f, tf) {
    if (!tf) { if (f.tf) { halt(f); Object.assign(f, feed()); } return; }
    if (f.tf !== tf) { Object.assign(f, feed()); connect(f, st.sym, tf); return; }
    if (!f.ac && f.state !== 'off' && Date.now() - f.tried > 3000) connect(f, st.sym, tf);
  }
  // The SORK rules on the SMC order flow (key level, M5 POI, 50% POI, bjeff zone, QML, reclamation): read from the server at most every 5 s while the chart is on screen.
  async function loadFlow() {
    const fl = st.flow, me = st;
    if (fl.busy || fl.off || Date.now() - fl.at < 5000) return;
    fl.busy = true; fl.at = Date.now();
    try {
      const res = await fetch(`/api/smc/flow?symbol=${encodeURIComponent(st.sym)}`, { headers: { 'X-Telegram-Init-Data': tg ? tg.initData : '' } });
      if (res.status === 404) fl.off = true;                                  // SMC flow is switched off on the server
      else if (res.ok) { const j = await res.json(); if (st === me) { fl.state = j.state || null; redraw(); } }
    } catch { /* offline: try again later */ }
    fl.busy = false;
  }

  // called on every chart draw: make sure the streams match the timeframe on screen
  function ensure(tf) {
    lastDraw = Date.now();
    if (!st.sym) return;
    if (pref.on && pref.kl && (tf === 'h1' || tf === 'm5')) loadFlow();
    if (st.main.tf !== tf) st.flash = null;
    keep(st.main, tf); keep(st.ref, REF[tf] || null);
  }
  setInterval(() => { if ((st.main.ac || st.ref.ac) && Date.now() - lastDraw > 25000) stop(); }, 10000);     // chart gone (left the symbol page): close the streams

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
    if (!pref.on || st.main.state === 'off') return;
    const follow = !!REF[E.tf], rf = follow ? st.ref : null;                   // M5: trend and IDM / DISR / LIQ zones come from the H1 stream
    const { FS, MONO, Y, plotW, step, ivl, cs0, lo, hi } = E, fs = Math.max(9, FS - 1);
    const X = (t) => (t - cs0) / ivl * step + step / 2;
    const tEnd = cs0 + (plotW / step) * ivl, y = (p) => Y(p);
    const mf = st.main, items = [...mf.ann.values(), ...mf.live.filter((a) => !mf.ann.has(a.id))].filter((a) => !(follow && a.type === 'idm'));
    if (rf) items.push(...[...rf.ann.values()].filter((a) => a.type === 'idm'));
    g.save(); g.textBaseline = 'alphabetic'; g.lineWidth = 1.2;
    const hit = (a, r) => a.x < r.x + r.w && a.x + a.w > r.x && a.y < r.y + r.h && a.y + a.h > r.y;
    // a label with a dark backing. nudge: when it would sit on another label (ours, the title, the app's own tags) move it up / down to the nearest free slot, or skip it
    const text = (s, x, yy, col, align = 'center', bg = true, alpha = 1, nudge = false, lim = plotW) => {
      g.font = `700 ${fs}px ${MONO}`; const w = Math.ceil(g.measureText(s).width) + 6, h = fs + 3;
      let bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x; bx = Math.max(1, Math.min(lim - w, bx));
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
    const labels = [];                                                // drawn after all lines, most important first: BOS > sweep > IDM
    const label = (prio, ...args) => labels.push({ prio, args });
    const line = (x0, x1, p, col, dash, alpha = 1) => {
      g.globalAlpha = alpha; g.strokeStyle = col; g.setLineDash(dash); g.beginPath(); g.moveTo(x0, Math.round(y(p)) + .5); g.lineTo(x1, Math.round(y(p)) + .5); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    };
    const padR = Math.min(E.W - 2, plotW + Math.max(54, step * 4));                                 // right edge of the IDM / DISR boxes: past the forming candle
    items.sort((p, q) => (p.t1 ?? p.t0) - (q.t1 ?? q.t0));
    // BOS from this candle time on are drawn. H1: from the DISR's BOS (no DISR yet: from the IDM's BOS), so the IDM, the DISR and every BOS after them. H4: all. Other timeframes: none.
    const zs = items.filter((a) => a.type === 'idm' && a.zone && a.status !== 'void' && (a.role === 'idm' || a.role === 'disr'));
    const zd = zs.find((a) => a.role === 'disr') || zs.find((a) => a.role === 'idm');
    const bosFrom = E.tf === 'h4' ? -Infinity : E.tf === 'h1' && zd ? zd.bos_t : Infinity;
    for (const a of items) {
      if (HIDE[a.type]) continue;
      const ext = a.type === 'idm' && a.zone && EXT[a.role] && a.status !== 'void';                // IDM / DISR box: keeps going to the right, taken or not
      const end = ext ? tEnd : a.t1 ?? (a.type === 'idm' ? tEnd : a.t0);
      if (end < cs0 - ivl || a.t0 > tEnd) continue;                                              // outside the visible candles
      const yy = y(a.price); if (yy < 0 || yy > E.Hh) continue;
      const x0 = Math.max(0, X(a.t0)), x1 = ext ? padR : Math.min(plotW, X(end)), pv = a.provisional, al = pv ? .6 : 1, dash = pv ? [2, 3] : null;
      if (a.type === 'swing') {
        continue;                                                                                // swing labels (HH / HL / LH / LL) are not drawn
      } else if (a.type === 'bos') {
        if (!pref.st || (a.t1 ?? a.t0) < bosFrom) continue;
        const col = COL.bos, lab = 'BOS' + (pv ? ' …' : '');
        line(x0, x1, a.price, col, dash || [], al);
        label(3, lab, (x0 + x1) / 2, a.dir === 1 ? yy - 4 : yy + fs + 5, col, 'center', true, al, true);
      } else if (a.type === 'idm') {
        if (!pref.idm || a.status === 'void') continue;
        const sw = a.status === 'swept';
        if (a.hi != null && a.lo != null) {
          const nm = ZN[a.role]; if (!nm) continue;                                         // zone mode: the demand / supply zone of a BOS, named by its role
          const yt = Math.round(y(a.hi)), yb = Math.round(y(a.lo)), h = Math.max(2, yb - yt);
          g.globalAlpha = (pv ? .6 : sw ? .75 : 1) * .16; g.fillStyle = COL.idm; g.fillRect(x0, yt, Math.max(2, x1 - x0), h);
          g.globalAlpha = pv ? .6 : sw ? .75 : 1; g.strokeStyle = COL.idm; g.setLineDash([1.5, 3.5]); g.strokeRect(x0 + .5, yt + .5, Math.max(2, x1 - x0), h); g.setLineDash([]); g.globalAlpha = 1;
          if (ext) label(1, nm + (sw ? ' \u2713' : pv ? ' …' : ''), padR - 3, Math.round((yt + yb) / 2) + fs / 2 - 1, COL.idm, 'right', true, al, true, padR);   // inside the box, after the forming candle
          else label(1, nm + (sw ? ' \u2713' : pv ? ' …' : ''), x0 + 18, a.dir === 1 ? yb + fs + 5 : yt - 4, COL.idm, 'center', true, al, true);
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
    // SORK rules on the SMC order flow. H1 chart: the key level box and the QML. M5 chart: the key level POI box (from the M5 order block), its 50% POI and the bjeff zone.
    const fs_ = st.flow.state;
    if (pref.kl && fs_ && Array.isArray(fs_.overlays) && (E.tf === 'h1' || E.tf === 'm5')) {
      const mine = (o) => o.type === 'box' && (E.tf === 'h1' ? o.grp === 'k' || o.label === 'QML' : o.grp === 'k5' || o.label === '50% POI' || o.label === 'bjeff zone');
      for (const o of fs_.overlays.filter(mine)) {
        if (o.t0 > tEnd) continue;
        const dead = o.tone === 'dead', low = /low probability/.test(o.label || '');
        const nm = o.label === 'QML' ? 'QML' : o.label === '50% POI' ? '50% POI' : o.label === 'bjeff zone' ? 'BJEFF ZONE' : 'KEY LEVEL' + (low ? ' (LOW PROB)' : '');
        const col = dead ? COL.dead : o.label === 'QML' ? COL.qml : o.label === '50% POI' ? COL.adv : o.label === 'bjeff zone' ? COL.rec : COL.kl;
        const x0 = Math.max(0, X(o.t0)), yt = Math.round(y(o.hi)), yb = Math.round(y(o.lo)), h = Math.max(2, yb - yt);
        if (yb < 0 || yt > E.Hh) continue;
        const al = dead ? .45 : 1;
        g.globalAlpha = al * .15; g.fillStyle = col; g.fillRect(x0, yt, Math.max(2, padR - x0), h);
        g.globalAlpha = al; g.strokeStyle = col; g.setLineDash(o.label === '50% POI' ? [4, 3] : dead ? [2, 3] : []); g.strokeRect(x0 + .5, yt + .5, Math.max(2, padR - x0), h); g.setLineDash([]); g.globalAlpha = 1;
        label(5, nm + (dead ? ' \u2717' : ''), padR - 3, Math.round((yt + yb) / 2) + fs / 2 - 1, col, 'right', true, al, true, padR);
      }
      // reclamation: a tick where it completed, and the step it is on (of 5) while it is in progress
      for (const r of fs_.r || []) {
        if (r.last_complete) {
          const xr = X(r.last_complete) + step, ym = y((r.lo + r.hi) / 2);
          if (xr > 4 && xr < plotW - 4 && ym > 6 && ym < E.Hh - 14) label(4, 'RECLAIM \u2713', xr, ym - 6, COL.rec, 'center', true, 1, true);
        }
      }
    }
    labels.sort((p, q) => q.prio - p.prio).forEach((l) => text(...l.args));
    const prog = fs_ && pref.kl && (E.tf === 'h1' || E.tf === 'm5') ? (fs_.r || []).filter((r) => r.state > 0) : [];
    if (prog.length) text(`RECLAIM ${Math.max(...prog.map((r) => r.state))}/5`, plotW - 4, 4 + 3 * (fs + 6) + 6, COL.rec, 'right', true);
    // trend tag and the latest event, top right
    const tf_ = rf || mf, tr = tf_.trend, tag = `SMC${follow ? ' H1' : ''} ${tr === 1 ? '▲ BULL' : tr === -1 ? '▼ BEAR' : '● FLAT'}${tf_.state === 'live' ? '' : ' · ' + (tf_.state === 'connecting' ? '...' : tf_.state === 'idle' ? '...' : 'reconnecting')}`;
    text(tag, plotW - 4, 4 + fs + 6, tr === 1 ? '#26A69A' : tr === -1 ? '#EF5350' : '#787B86', 'right', true);
    if (st.flash && Date.now() - st.flash.at < 12000) {
      const a = st.flash.a, d = new Date(a.t1 * 1000), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      text(`${a.dir === 1 ? '▲' : '▼'} ${a.type === 'idm' ? (ZN[a.role] || 'IDM') + ' \u2713' : a.label} ${hm}`, plotW - 4, 4 + 2 * (fs + 6) + 3, COL[a.type] || '#fff', 'right', true);
      setTimeout(redraw, 12100 - (Date.now() - st.flash.at));
    }
    g.restore();
  }

  return { open, barHtml, bind, draw };
})();
