// Sector map for ONE symbol: a to-scale map of its SORK picture. North = higher price, the vertical scale is real price.
// Zones are territory (order flow POIs, key level, QML, 50% POI, bjeff zones), lines are boundaries (H4 BOS, entry, SL, TP),
// the route runs from NOW through S, O, R to K. Distances are in H1 ATR so "how far is the target" is readable at a glance.
function symMap(v) {
  const s = v.state; if (!s || s.price == null) return '';
  const d = s.digits ?? 3, W = 366, H = 450, X0 = 48, TOP = 34, BOT = H - 20;
  const E = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f = x => Number(x).toFixed(d), price = s.price, atr = (s.atr && s.atr.h1) || Math.abs(price) * .002 || 1;
  const COL = { done: '#8FD14F', now: '#E3C16A', todo: '#5d6a4c', up: '#8FD14F', dn: '#E8745A', gold: '#E3C16A', tan: '#C2A06A', o: '#5FA35A', qml: '#B58A3A', dead: '#D2603F', bj: '#6FD0C4' };
  const K = s.k && s.k.active, kLive = !!(K && !K.invalidated), S = s.s, pois = ((s.o && s.o.pois) || []).filter(p => p.role !== 'plq');
  const zones = [], lines = [];
  pois.forEach(p => {
    const r = (s.r || []).find(x => x.role === p.role);
    zones.push({ id: 'o-' + p.role, lo: p.lo, hi: p.hi, col: COL.o, title: 'O  ' + p.role.toUpperCase(), sub: r ? (r.state ? `RECLAIM ${r.state}/5` : r.last_complete ? 'RECLAIMED' : 'WATCHING') : '', step: 'O' });
  });
  if (K) zones.push({ id: 'k', lo: K.lo, hi: K.hi, col: K.invalidated ? COL.dead : COL.tan, title: `K  ${K.type} ${K.dir === 1 ? 'BUY' : 'SELL'}`, sub: K.invalidated ? 'INVALIDATED' : K.high_prob ? `HIGH PROB · ${K.wicks} WICK` : 'LOW PROB, NOT TRADED', step: 'K', key: true });
  if (s.qml) zones.push({ id: 'q', lo: s.qml.lo, hi: s.qml.hi, col: s.qml.invalidated_t ? COL.dead : COL.qml, title: `QML ${s.qml.dir === 1 ? 'BUY' : 'SELL'}`, sub: s.qml.invalidated_t ? 'INVALIDATED' : s.qml.at_liquidity ? 'AT LIQUIDITY' : 'NO LIQUIDITY', dash: false });
  if (s.adv) {
    zones.push({ id: 'a', lo: s.adv.half[0], hi: s.adv.half[1], col: COL.gold, title: '50% POI', sub: s.adv.entered_t ? 'PRICE ENTERED' : 'ADVANCED KL', dash: true });
    s.adv.zones.forEach((z, i) => zones.push({ id: 'b' + i, lo: z.lo, hi: z.hi, col: COL.bj, title: 'BJEFF ZONE', sub: z.active_t ? 'ACTIVE' : 'WAITING', dash: false }));
  }
  if (S && S.valid && S.level != null) lines.push({ id: 's', y: S.level, col: S.trend === 1 ? COL.up : COL.dn, title: `S  H1 BOS ${S.trend === 1 ? '▲' : '▼'}`, sub: S.slq ? 'SLQ' : 'NO SLQ', dash: '5 4', step: 'S' });
  const pl = kLive && K.high_prob && K.plan ? K.plan : null;
  if (pl) {
    lines.push({ id: 'tp', y: pl.tp, col: COL.up, title: `TP 1:${pl.rr}`, sub: '', dash: '2 4' });
    lines.push({ id: 'en', y: pl.entry, col: COL.gold, title: K.dir === 1 ? 'BUY LIMIT' : 'SELL LIMIT', sub: '', dash: '' });
    lines.push({ id: 'sl', y: pl.sl, col: COL.dn, title: 'STOP LOSS', sub: '', dash: '2 4' });
  }
  // visible price window: the trade picture first, the rest only if it is near
  const core = [price]; if (pl) core.push(pl.tp, pl.sl, pl.entry); if (K) core.push(K.lo, K.hi);
  if (core.length === 1) { const near = [...zones.map(z => (z.lo + z.hi) / 2), ...lines.map(l => l.y)].filter(y => Math.abs(y - price) < 25 * atr); core.push(...near); if (core.length === 1) core.push(price + 3 * atr, price - 3 * atr); }
  let lo = Math.min(...core), hi = Math.max(...core); const pad = Math.max((hi - lo) * .1, 1.5 * atr);
  const fl = lo - pad - 4 * atr, fh = hi + pad + 4 * atr;                       // features beyond this are drawn as edge arrows
  const near = y => y >= fl && y <= fh;
  const inz = zones.filter(z => near(z.lo) && near(z.hi)), inl = lines.filter(l => near(l.y));
  const off = [...zones.filter(z => !inz.includes(z)).map(z => ({ y: (z.lo + z.hi) / 2, t: z.title.replace(/\s+/g, ' ') })), ...lines.filter(l => !inl.includes(l)).map(l => ({ y: l.y, t: l.title }))];
  const all = [price, ...inz.flatMap(z => [z.lo, z.hi]), ...inl.map(l => l.y)];
  lo = Math.min(...all) - (Math.max(...all) - Math.min(...all)) * .06 - .3 * atr; hi = Math.max(...all) + (Math.max(...all) - Math.min(...all)) * .06 + .3 * atr;
  const Y = p => BOT - (p - lo) / (hi - lo) * (BOT - TOP);
  // terrain: contour lines at round prices
  const raw = (hi - lo) / 7, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 5, 10].map(m => m * mag).find(x => x >= raw) || raw;
  let out = `<defs><pattern id="sm-h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" stroke="#fff" stroke-width="1.2" stroke-opacity=".45"/></pattern>
    <pattern id="sm-t" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".7" fill="#3A4A2A"/></pattern></defs>
    <rect x="${X0}" y="${TOP}" width="${W - X0}" height="${BOT - TOP}" fill="url(#sm-t)"/>`;
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const y = Y(p), major = Math.abs(Math.round(p / step)) % 5 === 0;
    out += `<path d="M${X0} ${y}H${W}" stroke="#3A4A2A" stroke-opacity="${major ? .95 : .55}" stroke-width="${major ? 1.2 : .8}"/><text x="${X0 - 4}" y="${y + 3}" text-anchor="end" font-family="JetBrains Mono" font-size="8.5" fill="#7d866a">${E(Number(p.toFixed(d)))}</text>`;
  }
  // zones (largest first so small ones stay visible on top)
  [...inz].sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo)).forEach(z => {
    let yy = Y(z.hi), h = Y(z.lo) - yy; if (h < 5) { yy -= (5 - h) / 2; h = 5; }
    out += z.dash ? `<rect x="${X0}" y="${yy}" width="${W - X0}" height="${h}" fill="none" stroke="${z.col}" stroke-width="1.5" stroke-dasharray="6 4"/>`
      : `<rect x="${X0}" y="${yy}" width="${W - X0}" height="${h}" fill="${z.col}" fill-opacity="${z.key ? .3 : .2}" stroke="${z.col}" stroke-width="${z.key ? 2 : 1.2}"/><rect x="${X0}" y="${yy}" width="${W - X0}" height="${h}" fill="url(#sm-h)" opacity=".5"/>`;
  });
  inl.forEach(l => { out += `<path d="M${X0} ${Y(l.y)}H${W}" stroke="${l.col}" stroke-width="${l.id === 'en' ? 2 : 1.6}" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''}/>`; });
  // route: NOW -> S -> O -> R -> K, each waypoint sits on the real level of that concept
  const st = v.steps, find = k => st.find(x => x.k === k);
  const oz = inz.filter(z => z.step === 'O'), rz = oz.find(z => /RECLAIM \d/.test(z.sub)) || oz[0], kz = inz.find(z => z.step === 'K'), sl = inl.find(l => l.step === 'S');
  const mid = z => (z.lo + z.hi) / 2, wp = [
    { k: 'S', y: sl ? sl.y : null }, { k: 'O', y: oz[0] ? mid(oz[0]) : null }, { k: 'R', y: rz ? mid(rz) : null }, { k: 'K', y: kz ? mid(kz) : null }].map((w, i) => ({ ...w, x: 266 + i * 24, state: find(w.k).state }));
  wp.forEach((w, i) => { if (w.y == null) { const a = wp.slice(0, i).reverse().find(q => q.y != null), b = wp.slice(i + 1).find(q => q.y != null); w.y = a && b ? (a.y + b.y) / 2 : a ? a.y : b ? b.y : price; w.est = true; } });
  const pts = [{ x: 352, y: price }, ...wp], px = p => Y(p.y);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ok = i === 1 ? wp[0].state === 'done' : b.state === 'done', cy = (px(a) + px(b)) / 2;
    out += `<path d="M${a.x} ${px(a)}C${a.x - 14} ${cy} ${b.x + 14} ${cy} ${b.x} ${px(b)}" stroke="${ok ? COL.done : COL.tan}" stroke-width="2.6" fill="none" ${ok ? '' : 'stroke-dasharray="7 5"'} stroke-linecap="round"/>`;
  }
  // labels as tags in the left column, stacked so they never overlap
  const tags = [...inz.map(z => ({ y: Y(z.hi), fy: Y((z.lo + z.hi) / 2), col: z.col, t1: z.title, t2: `${f(z.lo)} – ${f(z.hi)}${z.sub ? ' · ' + z.sub : ''}`, dist: (mid(z) - price) / atr })),
    ...inl.map(l => ({ y: Y(l.y) - 8, fy: Y(l.y), col: l.col, t1: l.title, t2: `${f(l.y)}${l.sub ? ' · ' + l.sub : ''}`, dist: (l.y - price) / atr }))].sort((a, b) => a.y - b.y);
  const TH = 26; let last = TOP - TH - 2; tags.forEach(t => { t.y = Math.max(t.y, last + TH + 2); last = t.y; });
  for (let i = tags.length - 1, lim = BOT - TH; i >= 0; i--) { if (tags[i].y > lim) tags[i].y = lim; lim = tags[i].y - TH - 2; }
  const TW = 190;
  tags.forEach(t => {
    const dist = (t.dist >= 0 ? '+' : '') + t.dist.toFixed(1) + ' ATR', x = X0 + 3;
    out += `<g><path d="M${x + TW} ${t.y + TH / 2}L${x + TW + 6} ${t.fy}" stroke="${t.col}" stroke-width="1" opacity=".9"/><circle cx="${x + TW + 6}" cy="${t.fy}" r="2" fill="${t.col}"/>
      <rect x="${x}" y="${t.y}" width="${TW}" height="${TH}" rx="2" fill="#0C1109" fill-opacity=".92" stroke="${t.col}"/>
      <text x="${x + 5}" y="${t.y + 10}" font-family="Rajdhani, sans-serif" font-weight="700" font-size="12" letter-spacing=".5" fill="${t.col}" textLength="${Math.min(t.t1.length * 6.4, 112)}" lengthAdjust="spacingAndGlyphs">${E(t.t1)}</text>
      <text x="${x + 5}" y="${t.y + 21}" font-family="JetBrains Mono, monospace" font-size="8" fill="#C9CDB6" textLength="${Math.min(t.t2.length * 4.9, TW - 10)}" lengthAdjust="spacingAndGlyphs">${E(t.t2)}</text>
      <text x="${x + TW - 4}" y="${t.y + 10}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="8.5" fill="#A0A78A">${dist}</text></g>`;
  });
  // waypoints
  wp.forEach(w => {
    const c = COL[w.state], y = px(w);
    if (w.k === 'K') out += `<path d="M${w.x} ${y}V${y - 26}" stroke="${c}" stroke-width="2"/><path d="M${w.x} ${y - 26}H${w.x + 18}L${w.x + 13} ${y - 20}L${w.x + 18} ${y - 14}H${w.x}Z" fill="${c}"/>`;
    out += `<g transform="translate(${w.x} ${y})"><rect x="-10" y="-10" width="20" height="20" rx="2" fill="#0C1109" stroke="${c}" stroke-width="2" ${w.est ? 'stroke-dasharray="3 2"' : ''}/><text y="4" text-anchor="middle" font-family="JetBrains Mono" font-weight="700" font-size="11" fill="${c}">${w.k}</text></g>`;
  });
  // NOW marker: own position, pulsing ring, price plate on the axis
  const py = Y(price);
  out += `<path d="M${X0} ${py}H${W}" stroke="#F4F2E2" stroke-width="1" stroke-dasharray="1 3" opacity=".8"/>
    <g transform="translate(352 ${py})"><circle r="9" fill="none" stroke="#F4F2E2" stroke-width="1.2"><animate attributeName="r" values="5;13" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;0" dur="1.8s" repeatCount="indefinite"/></circle><circle r="4.5" fill="#F4F2E2"/></g>
    <rect x="0" y="${py - 8}" width="${X0 - 2}" height="16" rx="2" fill="#F4F2E2"/><text x="${(X0 - 2) / 2}" y="${py + 3.5}" text-anchor="middle" font-family="JetBrains Mono" font-weight="700" font-size="9" fill="#10150C">${f(price)}</text>`;
  // edge arrows for things beyond the map
  let nu = 0, nd = 0;
  off.sort((a, b) => b.y - a.y).forEach(o => { const up = o.y > price, n = ((o.y - price) / atr).toFixed(0), y = up ? TOP + 11 + 11 * nu++ : BOT - 4 - 11 * nd++;
    out += `<text x="${W - 4}" y="${y}" text-anchor="end" font-family="JetBrains Mono" font-size="8.5" fill="#A0A78A">${up ? '\u25B2' : '\u25BC'} ${E(o.t)} off map ${up ? '+' : ''}${n} ATR</text>`; });
  // frame, title, scale and north arrow
  out += `<rect x="${X0}" y="${TOP}" width="${W - X0}" height="${BOT - TOP}" fill="none" stroke="#C2A06A" stroke-opacity=".6"/>
    <text x="${X0}" y="${TOP - 10}" font-family="Rajdhani" font-weight="700" font-size="13" letter-spacing="2" fill="#EDEBD8">SECTOR MAP · ${E(v.short)}</text>
    <text x="${W - 2}" y="${TOP - 10}" text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="#A0A78A">1 H1 ATR = ${f(atr)}</text>
    <g transform="translate(24 ${TOP - 14})"><path d="M0 8V-6M-4 -2L0 -8L4 -2" stroke="#E3C16A" stroke-width="1.5" fill="none"/><text y="19" x="0" text-anchor="middle" font-family="JetBrains Mono" font-size="8" fill="#E3C16A">N</text></g>
    <g transform="translate(${X0} ${H - 6})" font-family="JetBrains Mono" font-size="8.5" fill="#A0A78A"><rect y="-8" width="8" height="8" fill="${COL.done}"/><text x="12">CLEARED</text><rect x="62" y="-8" width="8" height="8" fill="${COL.now}"/><text x="74">IN PROGRESS</text><rect x="144" y="-8" width="8" height="8" fill="${COL.todo}"/><text x="156">TO DO</text></g>`;
  return out;
}
