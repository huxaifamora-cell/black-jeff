// Live radar scope (PPI display). Canvas, no dependencies.
// Bearing = fixed slot per symbol (stable, no overlaps). Range = how far the symbol still is from a trade:
// Only symbols that are READY to trade are painted (inner ring); BUILDING and QUIET symbols never appear on the scope.
// The scope chrome is white on a black face, so it never clashes with the green BUY / red SELL contacts.
// The beam sweeps once every 6 s; a contact lights up when the beam crosses it and then fades like phosphor.
const Radar = (() => {
  const SWEEP = 6, SCOPE = '255,255,255', GREEN = '90,255,100', RED = '255,105,85';   // SCOPE = radar chrome (white); GREEN/RED = buy/sell contacts only
  let raf = 0, stop = null;

  function contacts(symbols) {
    const n = symbols.length || 1;
    return symbols.map((s, i) => {
      if (s.status !== 'ready') return null;
      const range = 0.34;                                                                         // 0..1 of the scope radius: inner ring
      const wob = ((i * 7919) % 13) / 13 * 0.05;                                               // tiny fixed offset, keeps neighbours apart
      return { s, ang: (i / n) * Math.PI * 2, r: Math.min(.94, range + wob), ready: true,
        buy: !!(s.plan && s.plan.dir === 1), lit: -1, px: 0, py: 0 };
    }).filter(Boolean);
  }

  function mount(cv, readout, symbols, onPick) {
    unmount();
    const list = contacts(symbols), reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const g = cv.getContext('2d');
    let W = 0, cx = 0, cy = 0, R = 0, dpr = 1;
    const size = () => {
      dpr = Math.max(window.devicePixelRatio || 1, 2); W = Math.min(cv.parentElement.clientWidth - 16, 560);          // minus the scope's 8px side padding
      cv.style.width = W + 'px'; cv.style.height = W + 'px'; cv.width = W * dpr; cv.height = W * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = cy = W / 2; R = W / 2 - 22;
    };
    size();
    const ro = window.ResizeObserver ? new ResizeObserver(size) : null; if (ro) ro.observe(cv.parentElement);
    const t0 = performance.now();
    const pos = (c) => { c.px = cx + Math.sin(c.ang) * c.r * R; c.py = cy - Math.cos(c.ang) * c.r * R; };   // bearing 0 = up, clockwise

    function frame(now) {
      if (!cv.isConnected) { unmount(); return; }
      const tt = (now - t0) / 1000, beam = reduce ? 0 : ((tt % SWEEP) / SWEEP) * Math.PI * 2;   // beam bearing, clockwise from up
      g.clearRect(0, 0, W, W);
      // scope face
      g.fillStyle = '#000'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
      // range rings and spokes
      g.lineWidth = 1; g.strokeStyle = `rgba(${SCOPE},.28)`;
      for (let i = 1; i <= 4; i++) { g.beginPath(); g.arc(cx, cy, R * i / 4, 0, 7); g.stroke(); }
      g.strokeStyle = `rgba(${SCOPE},.16)`;
      for (let a = 0; a < 12; a++) { const t = a * Math.PI / 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(t) * R, cy - Math.cos(t) * R); g.stroke(); }
      // inbound zone (ready ring) tint
      g.strokeStyle = `rgba(${SCOPE},.18)`; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, R * .34, 0, 7); g.stroke(); g.lineWidth = 1;
      // sweep: fading wedge behind the beam
      const a0 = beam - Math.PI / 2;                                                             // canvas angle of the beam
      if (g.createConicGradient) {
        const cg = g.createConicGradient(a0 - 1.25, cx, cy);
        cg.addColorStop(0, `rgba(${SCOPE},0)`); cg.addColorStop(.2, `rgba(${SCOPE},.34)`); cg.addColorStop(.2001, `rgba(${SCOPE},0)`);
        g.fillStyle = cg; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0 - 1.25, a0); g.closePath(); g.fill();
      } else { g.fillStyle = `rgba(${SCOPE},.12)`; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0 - .6, a0); g.fill(); }
      g.strokeStyle = `rgba(${SCOPE},.95)`; g.lineWidth = 2; g.shadowColor = `rgb(${SCOPE})`; g.shadowBlur = 8;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); g.stroke(); g.shadowBlur = 0; g.lineWidth = 1;
      // contacts
      g.font = '700 14px "JetBrains Mono", ui-monospace, monospace'; g.textBaseline = 'middle';
      const taken = [];
      list.forEach(c => {
        pos(c);
        const dAng = (((beam - c.ang) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);           // radians since the beam passed it
        if (reduce) c.lit = 0; else if (dAng < 0.12 && c.lit !== tt) c.lit = tt;                   // beam on it: re-light
        const age = reduce ? 0 : Math.min(1, dAng / (Math.PI * 2));
        const glow = 1 - age * .1;                                    // ready contacts stay bright; only a faint pulse as the beam passes
        const col = c.buy ? GREEN : RED;
        // trail of the last positions is the same point: draw a ping ring just after the hit
        const since = reduce ? 9 : (tt - c.lit); if (since >= 0 && since < 1.2) { g.strokeStyle = `rgba(${col},${.8 * (1 - since / 1.2)})`; g.beginPath(); g.arc(c.px, c.py, 6 + since * 22, 0, 7); g.stroke(); }
        // no arrow marker: the callsign itself marks the contact (the ping ring still shows when the beam hits it)
        const txt = c.s.short + (c.ready ? (c.buy ? ' \u25B2' : ' \u25BC') : ''), w = g.measureText(txt).width;
        let lx = Math.min(Math.max(c.px - w / 2, 4), W - 4 - w), ly = c.py;
        for (let n = 0; n < 8 && taken.some(r => lx < r.x + r.w && lx + w > r.x && Math.abs(ly - r.y) < 16); n++) ly += 16;      // nudged away from other callsigns
        taken.push({ x: lx, y: ly, w });
        g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.95)'; g.strokeText(txt, lx, ly); g.lineWidth = 1;   // black halo for legibility
        g.fillStyle = `rgba(${col},${glow})`; g.shadowColor = `rgb(${col})`; g.shadowBlur = 6; g.fillText(txt, lx, ly); g.shadowBlur = 0;
        c.hit = { x: c.px, y: c.py };
      });
      g.restore();
      // bezel, bearing ticks and labels
      g.strokeStyle = `rgba(${SCOPE},.7)`; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke(); g.lineWidth = 1;
      for (let d = 0; d < 360; d += 5) {
        const t = d * Math.PI / 180, l = d % 30 === 0 ? 10 : d % 10 === 0 ? 6 : 3;
        g.strokeStyle = `rgba(${SCOPE},${d % 30 === 0 ? .85 : .45})`; g.beginPath();
        g.moveTo(cx + Math.sin(t) * R, cy - Math.cos(t) * R); g.lineTo(cx + Math.sin(t) * (R - l), cy - Math.cos(t) * (R - l)); g.stroke();
      }
      g.fillStyle = `rgba(${SCOPE},.85)`; g.font = '500 9px "JetBrains Mono", ui-monospace, monospace'; g.textAlign = 'center';
      for (let d = 0; d < 360; d += 30) { const t = d * Math.PI / 180, lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d).padStart(3, '0');
        g.fillText(lab, cx + Math.sin(t) * (R + 11), cy - Math.cos(t) * (R + 11)); }
      g.fillStyle = `rgba(${SCOPE},.5)`; g.font = '500 8px "JetBrains Mono", ui-monospace, monospace'; g.textAlign = 'left';
      g.fillText('READY', cx + 4, cy - R * .34 - 3);
      g.textAlign = 'center';
      // centre mark (own station)
      g.strokeStyle = `rgba(${SCOPE},.9)`; g.beginPath(); g.moveTo(cx - 6, cy); g.lineTo(cx + 6, cy); g.moveTo(cx, cy - 6); g.lineTo(cx, cy + 6); g.stroke();
      g.textAlign = 'start';
      if (readout) readout(beam, list);
      raf = requestAnimationFrame(frame);
    }
    const pick = e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 28; list.forEach(c => { const d = Math.hypot(c.px - x, c.py - y); if (d < bd) { bd = d; best = c; } });
      if (best) onPick(best.s.id);
    };
    cv.addEventListener('click', pick);
    cv.onkeydown = e => { if (e.key === 'Enter' && list.length) onPick(list[0].s.id); };
    raf = requestAnimationFrame(frame);
    stop = () => { cancelAnimationFrame(raf); cv.removeEventListener('click', pick); if (ro) ro.disconnect(); };
  }
  function unmount() { if (stop) { stop(); stop = null; } cancelAnimationFrame(raf); }
  return { mount, unmount };
})();
