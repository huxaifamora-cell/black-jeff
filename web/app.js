const tg = window.Telegram && Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const view = document.getElementById('view');
let tab = 'symbols', current = null, timer = null, tf = 'm5', concept = '';

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json',
    'X-Telegram-Init-Data': tg ? tg.initData : '' } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}
const T = t => new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const N = (x, d = 3) => x == null ? '-' : Number(x).toFixed(d);
const P = (x, d) => `<span class="px">${N(x, d)}</span>`;     // price or level, styled
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const arrow = t => t === 1 ? '<span class="arr up" title="Uptrend">&#9650;</span>' : t === -1 ? '<span class="arr down" title="Downtrend">&#9660;</span>' : '<span class="arr mut">-</span>';

document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  setTab(b.dataset.tab);
});
function setTab(t) {
  tab = t; current = null; clearInterval(timer);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (tg) tg.BackButton.hide();
  ({ symbols: renderSymbols, alerts: renderAlerts, guide: renderGuide })[t]();
}

// ------------------------------------------------------------ symbols
// ---- tactical radar: only symbols that are ready to trade are drawn, as markers on the map
const SLOTS = [[80, 110], [230, 90], [290, 210], [120, 250], [200, 340], [60, 330], [310, 330], [170, 190], [310, 120], [40, 200]];
function slotFor(id, used) {                           // a stable spot per symbol, so markers do not jump around
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  for (let i = 0; i < SLOTS.length; i++) { const k = (h + i) % SLOTS.length; if (!used.has(k)) { used.add(k); return SLOTS[k]; } }
  return SLOTS[h % SLOTS.length];
}
const pin = (x, y, s) => { const c = s.plan && s.plan.dir === 1 ? '#8FD14F' : '#E8745A', w = Math.max(48, s.short.length * 8 + 22);
  return `<g class="pin" data-id="${s.id}" transform="translate(${x} ${y})" tabindex="0" role="button" aria-label="${esc(s.name)}"><path d="M0 0L-9 -16H9Z" fill="${c}"/><rect x="${-w / 2}" y="-38" width="${w}" height="22" rx="3" fill="${c}"/><text y="-23" text-anchor="middle" font-family="JetBrains Mono" font-weight="700" font-size="11" fill="#10150C">${esc(s.short)} ${s.plan && s.plan.dir === 1 ? '&#9650;' : '&#9660;'}</text></g>`; };
let radarTab = 'ready';
async function renderSymbols() {
  view.innerHTML = '<p class="mut">Loading...</p>';
  try {
    const [{ symbols }, al] = await Promise.all([api('/api/symbols'), api('/api/alerts?limit=1').catch(() => ({ alerts: [] }))]);
    const G = { ready: symbols.filter(s => s.status === 'ready'), building: symbols.filter(s => s.status === 'building'), quiet: symbols.filter(s => s.status === 'quiet') }, ready = G.ready;
    const row = s => {
      const buy = s.plan && s.plan.dir === 1, cls = s.status === 'ready' ? (buy ? 'buy' : 'sell') : s.status === 'building' ? 'build' : '';
      const label = s.status === 'ready' ? `${buy ? 'BUY' : 'SELL'} SETUP READY` : s.status === 'building' ? 'BUILDING' : 'QUIET';
      const sub = !s.available ? 'not on Deriv' : s.price == null ? 'waiting for data'
        : s.status === 'ready' ? `${s.plan.type} &middot; entry ${N(s.plan.entry, s.digits)}` : (s.next ? esc(s.next) : 'No setup');
      return `<button class="rrow ${cls}" data-id="${s.id}"><span class="mid"><b>${esc(s.short)}</b><span class="st ${cls || 'quiet'}">${label}</span>${s.qml ? '<span class="tag alt">QML</span>' : ''}<br><span class="small">${sub}</span></span>
        <span><span class="px">${s.price != null ? N(s.price, s.digits) : ''}</span>${arrow(s.trend)}</span></button>`;
    };
    const used = new Set();
    const map = `<svg class="map" viewBox="0 0 366 400" role="img" aria-label="Tactical radar: symbols ready to trade">${MAP_BG}${ready.map(s => { const [x, y] = slotFor(s.id, used); return pin(x, y, s); }).join('')}` +
      (ready.length ? '' : '<text x="183" y="205" text-anchor="middle" font-family="Rajdhani" font-weight="700" font-size="20" letter-spacing="3" fill="#A0A78A">NO TARGETS READY</text><text x="183" y="226" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="#A0A78A">STANDING BY</text>') + '</svg>';
    const last = al.alerts && al.alerts[0];
    view.innerHTML = `<h3 style="margin-top:0">Tactical radar</h3>${map}
      <div class="legend"><span><i style="background:#8FD14F"></i>BUY READY</span><span><i style="background:#E8745A"></i>SELL READY</span></div>` +
      `<div class="rtabs" role="tablist">${[['ready', 'Ready to trade'], ['building', 'Building'], ['quiet', 'Quiet']].map(([k, t]) => `<button role="tab" class="${radarTab === k ? 'on' : ''}" data-rt="${k}">${t} <span>${G[k].length}</span></button>`).join('')}</div>` +
      (G[radarTab].length ? G[radarTab].map(row).join('') : `<p class="mut">${{ ready: 'No symbols are ready to trade.', building: 'Nothing is building right now.', quiet: 'No quiet symbols.' }[radarTab]}</p>`) +
      (last ? `<div class="latest"><span>LATEST</span><span style="flex:1">${esc(last.title)}</span><span class="mut">${T(last.ts)}</span></div>` : '') +
      '<p class="small">Only symbols with a valid, high probability key level (RBS/SBR) are on the map. Arrow = H4 trend.</p>';
    view.querySelectorAll('.rtabs button').forEach(b => b.onclick = () => { radarTab = b.dataset.rt; renderSymbols(); });
    view.querySelectorAll('.rrow').forEach(b => b.onclick = () => openSymbol(b.dataset.id));
    view.querySelectorAll('.pin').forEach(g => { g.onclick = () => openSymbol(g.dataset.id); g.onkeydown = e => { if (e.key === 'Enter') openSymbol(g.dataset.id); }; });
  } catch (e) { view.innerHTML = `<p class="down">${esc(e.message)}</p>`; }
}

// ------------------------------------------------------------ symbol page
function openSymbol(id) {
  current = id; tf = 'm5'; clearInterval(timer);
  if (tg) { tg.BackButton.show(); tg.BackButton.onClick(() => setTab(tab === 'alerts' ? 'alerts' : 'symbols')); }
  loadSymbol(); timer = setInterval(loadSymbol, 30000);
}
async function loadSymbol() {
  if (!current) return;
  try {
    const [v, al] = await Promise.all([api('/api/symbol/' + current), api('/api/alerts?symbol=' + current + '&limit=15')]);
    drawSymbol(v, al.alerts);
  } catch (e) { view.innerHTML = `<p class="down">${esc(e.message)}</p>`; }
}
function drawSymbol(v, alerts) {
  const s = v.state, d = s ? s.digits : 3;
  let h = `<div class="row"><button class="back" id="back">&#8249; ${esc(v.short)}</button><span class="px">${s && s.price != null ? N(s.price, d) : ''}</span>${arrow(s && s.s ? s.s.trend : null)}</div><div class="small">${esc(v.name)}</div>`;
  if (!v.available) h += '<p class="down">This symbol was not found on Deriv, so it is not monitored.</p>';
  const goBack = () => setTab(tab === 'alerts' ? 'alerts' : 'symbols');
  if (!s) { view.innerHTML = h + '<p class="mut">Waiting for the first data...</p>'; document.getElementById('back').onclick = goBack; return; }
  const wasOpen = !!view.querySelector('details.more[open]');       // keep "Full details" open across refreshes
  const NAME = { S: 'STRUCTURE', O: 'ORDER FLOW', R: 'RECLAMATION', K: 'KEY LEVEL' }, COL = { done: '#8FD14F', now: '#E3C16A', todo: '#3A4A2A' };
  const WP = [[60, 50], [190, 130], [100, 235], [290, 335]];
  const seg = ['M60 50C60 100 150 90 190 130', 'M190 130S120 175 100 235', 'M100 235C95 285 250 295 290 335'];
  const route = seg.map((d, i) => v.steps[i + 1].state === 'done' ? `<path d="${d}" stroke="#8FD14F" stroke-width="3" fill="none"/>` : `<path d="${d}" stroke="#C2A06A" stroke-width="3" stroke-dasharray="8 6" fill="none"/>`).join('') +
    v.steps.map((x, i) => { const [px, py] = WP[i], c = COL[x.state], lab = NAME[x.k] + (x.k === 'R' && x.state === 'now' ? ' ' + (x.text.match(/step (\d)/) || [, ''])[1] + '/5' : '');
      return i < 3 ? `<g transform="translate(${px} ${py})"><rect x="-14" y="-14" width="28" height="28" rx="3" fill="#0C1109" stroke="${c}" stroke-width="2"/><text y="4" text-anchor="middle" font-family="JetBrains Mono" font-size="12" fill="${c}">${x.k}</text></g><text x="${px + 22}" y="${py + 5}" font-family="Rajdhani" font-weight="700" font-size="15" fill="#EDEBD8" stroke="#10150C" stroke-width="3.5" paint-order="stroke">${lab}</text>`
        : `<g transform="translate(${px} ${py})"><path d="M0 0V-34" stroke="${x.state === 'todo' ? '#C2A06A' : c}" stroke-width="2"/><path d="M0 -34H26L19 -26L26 -18H0Z" fill="${x.state === 'todo' ? '#C2A06A' : c}"/></g><rect x="${px - 14}" y="${py + 2}" width="28" height="22" rx="3" fill="#0C1109" stroke="${c}" stroke-width="2"/><text x="${px}" y="${py + 18}" text-anchor="middle" font-family="JetBrains Mono" font-size="12" fill="${c}">K</text><text x="${px - 130}" y="${py + 46}" font-family="Rajdhani" font-weight="700" font-size="15" fill="#E3C16A" stroke="#10150C" stroke-width="3.5" paint-order="stroke">KEY LEVEL (TARGET)</text>`; }).join('');
  const done = v.steps.filter(x => x.state === 'done').length, nextWp = v.steps.find(x => x.state !== 'done');
  const stp = v.steps.map(x => `<div class="rt ${x.state}"><i>${x.state === 'done' ? '&#10003;' : x.state === 'now' ? '&#9679;' : '&#9675;'}</i><b>${x.k}</b> ${esc(x.text)}</div>`).join('');
  h += `<div class="card"><h4>Route to target &middot; ${done} of 4 cleared</h4>
    <svg class="map" viewBox="0 0 366 400" role="img" aria-label="Route to target: structure, order flow, reclamation, key level">${ROUTE_BG}${route}</svg>
    <p class="small">${nextWp ? `Next waypoint: <span class="px">${nextWp.k}</span> &middot; ${esc(nextWp.text)}` : 'All waypoints cleared. Target reached.'}</p><div class="rts">${stp}</div>` +
    (v.plan && v.status === 'ready' ? `<div class="plan"><div><small>${v.plan.dir === 1 ? 'BUY LIMIT' : 'SELL LIMIT'}</small><span class="px">${N(s.k.active.plan.entry, d)}</span></div><div><small>STOP LOSS</small><span class="down">${N(s.k.active.plan.sl, d)}</span></div><div><small>TAKE PROFIT 1:${s.k.active.plan.rr}</small><span class="up">${N(s.k.active.plan.tp, d)}</span></div></div>` : '') + '</div>';
  h += `<div class="pills">${['m5', 'h1', 'h4'].map(x => `<button data-tf="${x}" class="${x === tf ? 'on' : ''}">${x.toUpperCase()}</button>`).join('')}</div>
    <canvas id="chart"></canvas><div class="small">Updated ${T(s.updated)}. Closed candles with the SORK zones.</div>
    <details class="more"${wasOpen ? ' open' : ''}><summary>Full details</summary>` + cards(s, d) + `</details>` +
    `<h3>Alerts for this symbol</h3>` + (alerts.length ? alerts.map(a => alertHtml(a)).join('') : '<p class="mut">No alerts yet.</p>') +
    `<div class="row"><button class="btn" id="mute">Mute alerts for this symbol</button></div>`;
  view.innerHTML = h;
  document.getElementById('back').onclick = goBack;
  const redraw = () => chart(document.getElementById('chart'), s, tf);
  view.querySelectorAll('.pills button').forEach(b => b.onclick = () => { tf = b.dataset.tf; drawSymbol(v, alerts); });
  document.getElementById('mute').onclick = async () => {
    const { me } = await api('/api/me'); const m = new Set(me.muted); m.add(current);
    await api('/api/me/settings', { method: 'POST', body: JSON.stringify({ muted: [...m] }) });
    if (tg) tg.showAlert('Muted. You can unmute in the Alerts tab.'); else alert('Muted.');
  };
  redraw();
}
function box(b, d) { return `${P(b.lo, d)} to ${P(b.hi, d)}`; }
function cards(s, d) {
  let h = '';
  const S = s.s;
  h += `<div class="card"><h4>S &middot; Market structure (H4)</h4>` + (S ? (S.valid
    ? `<p><b class="${S.trend === 1 ? 'up' : 'down'}">${S.trend === 1 ? 'Uptrend' : 'Downtrend'} is valid</b></p>
       <p class="small">Valid BOS ${T(S.anchor_t)} at ${P(S.level, d)}. ${S.slq ? 'Liquidity (SLQ) present.' : '2 or more BOS without SLQ.'}${S.shift_pending ? ' A newer BOS the other way is not valid yet.' : ''}</p>`
    : '<p class="mut">No valid structure yet.</p>') : '<p class="mut">No data.</p>') + '</div>';
  const O = s.o;
  h += `<div class="card"><h4>O &middot; Order flow (H1)</h4>` + (O && O.pois.some(p => p.role !== 'plq') ? O.pois.filter(p => p.role !== 'plq').map(p =>
    `<p><b>${p.role === 'plq' ? 'Point of liquidity' : p.role}</b> (${p.dir === 1 ? 'bullish' : 'bearish'}) POI ${box(p, d)}</p>`).join('')
    : '<p class="mut">Nothing mapped yet.</p>') +
    (O && O.invalidated ? `<p class="down small">Inducement and disruption were invalidated ${T(O.invalidated.t)}; the trend changed direction and the order flow was re-mapped.</p>` : '') + '</div>';
  h += `<div class="card"><h4>R &middot; Reclamation (M5)</h4>` + (s.r.some(r => r.role !== 'plq') ? s.r.filter(r => r.role !== 'plq').map(r =>
    `<p>${r.role === 'plq' ? 'Point of liquidity' : r.role}: ${r.state ? 'in progress, step ' + r.state + ' of 5' : 'waiting'}${r.last_complete ? ` <span class="small">last complete ${T(r.last_complete)}</span>` : ''}</p>`).join('')
    : '<p class="mut">No POI to watch.</p>') + '<p class="small">A reclamation is a confirmation, not an entry.</p></div>';
  const K = s.k, a = K && K.active;
  h += `<div class="card"><h4>K &middot; Key level (H1)</h4>` + (a ? `<p><b>${a.type}</b> (${a.dir === 1 ? 'buy' : 'sell'}) POI ${box(a, d)}
    ${a.invalidated ? `<span class="down"> invalidated ${T(a.invalidated.t)}</span>` : (a.high_prob ? '<span class="up"> valid, high probability</span>' : '<span class="down"> valid but low probability, not traded</span>')}</p>
    <p class="small">${a.wicks} wick(s) inside the POI between the key level and its BOS.</p>` +
    (!a.invalidated && a.high_prob ? `<p class="small">${a.dir === 1 ? 'Buy' : 'Sell'} limit ${P(a.plan.entry, d)} &middot; <span class="down">SL ${P(a.plan.sl, d)}</span> &middot; <span class="up">TP (1:${a.plan.rr}) ${P(a.plan.tp, d)}</span></p>` : '')
    : '<p class="mut">No valid key level (RBS or SBR) yet.</p>') +
    '</div>';
  if (s.qml) h += `<div class="card"><h4>QML (H1)</h4><p><b>${s.qml.dir === 1 ? 'Buy' : 'Sell'}</b> POI ${box(s.qml, d)} ${s.qml.invalidated_t ? '<span class="down">invalidated</span>' : ''}</p>
    <p class="small">${s.qml.at_extreme ? 'At the extreme (H1 swing high or low).' : 'Not at the extreme, so it is not alerted.'}</p></div>`;
  if (s.adv) h += `<div class="card"><h4>Advanced key level and bjeff zone</h4><p>50% POI ${box({ lo: s.adv.half[0], hi: s.adv.half[1] }, d)} ${s.adv.entered_t ? `<span class="small">price entered ${T(s.adv.entered_t)}</span>` : ''}</p>` +
    (s.adv.zones.length ? s.adv.zones.map(z => `<p class="small">bjeff zone ${box(z, d)} ${z.active_t ? 'active ' + T(z.active_t) : 'waiting for a body close inside'}</p>`).join('') : '<p class="small">No bjeff zone yet.</p>') + '</div>';
  return h;
}
const TONE = { s: '#5d7a45', o: '#3C6B2D', k: '#C2A06A', qml: '#8a6a2a', pending: '#5d6875', dead: '#D2603F', adv: '#E3C16A', adv2: '#3C6B2D' };
function chart(cv, s, tf) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = 260;
  cv.width = W * dpr; cv.height = Hh * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const cs = (s.candles[tf] || []).slice(-80); if (!cs.length) return;
  let lo = Math.min(...cs.map(c => c[3])), hi = Math.max(...cs.map(c => c[2]));
  const shown = s.overlays || [];
  const span = hi - lo || 1, ov = shown.filter(o => o.type === 'box' ? (o.hi >= lo - span * .3 && o.lo <= hi + span * .3)
    : (o.tf === tf && o.y >= lo - span * .3 && o.y <= hi + span * .3));
  ov.forEach(o => { lo = Math.min(lo, o.lo ?? o.y); hi = Math.max(hi, o.hi ?? o.y); });
  const pad = (hi - lo) * .06; lo -= pad; hi += pad;
  const Y = v => Hh - 14 - (v - lo) / (hi - lo) * (Hh - 28), step = (W - 6) / cs.length;
  const X = t => { const i = cs.findIndex(c => c[0] >= t); return i < 0 ? W : i === 0 ? 0 : i * step; };
  g.font = '11px "JetBrains Mono", ui-monospace, monospace';
  const labels = [];                                  // drawn last, on solid tags, so candles and zones never hide them
  ov.forEach(o => {
    const col = TONE[o.tone] || '#888';
    if (o.type === 'box') {
      const x = X(o.t0);
      if (o.tone === 'adv') { g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash([6, 4]); g.strokeRect(x, Y(o.hi), W - x, Y(o.lo) - Y(o.hi)); g.setLineDash([]); g.lineWidth = 1; }   // 50% POI: dashed
      else { g.fillStyle = col + '40'; g.fillRect(x, Y(o.hi), W - x, Y(o.lo) - Y(o.hi)); g.strokeStyle = col; g.strokeRect(x, Y(o.hi), W - x, Y(o.lo) - Y(o.hi)); }
      labels.push({ text: o.label, col, x: Math.max(2, x + 2), y: Y(o.hi) + 1 });
    } else {
      const x = X(o.t0); g.strokeStyle = col; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, Y(o.y)); g.lineTo(W, Y(o.y)); g.stroke(); g.setLineDash([]);
      labels.push({ text: o.label, col, x: null, y: Y(o.y) - 15 });
    }
  });
  cs.forEach((c, i) => {
    const x = i * step + step / 2, up = c[4] >= c[1], col = up ? '#8FD14F' : '#D2603F';
    g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(x, Y(c[2])); g.lineTo(x, Y(c[3])); g.stroke();
    const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4])); g.fillRect(x - step * .3, y1, step * .6, Math.max(1, y2 - y1));
  });
  const taken = [];
  labels.forEach(l => {
    const w = Math.ceil(g.measureText(l.text).width) + 10, h = 15;
    let x = l.x == null ? W - w - 2 : Math.min(l.x, W - w - 2), y = Math.max(1, Math.min(l.y, Hh - h - 1));
    for (let n = 0; n < 20 && taken.some(r => x < r.x + r.w && x + w > r.x && y < r.y + h && y + h > r.y); n++) y = y + h + 1 > Hh - h ? 1 : y + h + 1;
    taken.push({ x, y, w });
    g.fillStyle = l.col; g.globalAlpha = .95; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, 3) : g.rect(x, y, w, h); g.fill(); g.globalAlpha = 1;
    g.fillStyle = ['#C2A06A', '#E3C16A'].includes(l.col) ? '#10150C' : '#F4F2E2'; g.textBaseline = 'middle'; g.fillText(l.text, x + 5, y + h / 2 + .5); g.textBaseline = 'alphabetic';
  });
}

// ------------------------------------------------------------ alerts
// One compact row per alert: concept badge, short title, symbol and time. Tap a row to read the details.
const dayLabel = ts => { const d = new Date(ts * 1000), n = new Date(), ymd = x => x.toDateString();
  return ymd(d) === ymd(n) ? 'Today' : ymd(d) === ymd(new Date(n - 864e5)) ? 'Yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const clock = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const alertHtml = (a, withOpen) => `<details class="arow"><summary><span class="bdg">${esc(a.concept || '')}</span><span class="at"><b>${esc(a.title.replace(/^[A-Z]+: /, ''))}</b><span class="m">${esc(a.symbol_name.replace('Volatility ', 'V').replace(' Index', ''))}</span></span><span class="tm">${clock(a.ts)}</span></summary>
  <div class="ab">${esc(a.body)}${withOpen ? `<div><button class="btn" data-open="${esc(a.symbol)}">Open chart</button></div>` : ''}</div></details>`;
async function renderAlerts() {
  view.innerHTML = '<p class="mut">Loading...</p>';
  try {
    const [{ alerts }, { me, concepts }] = await Promise.all([api('/api/alerts?limit=40' + (concept ? '&concept=' + concept : '')), api('/api/me')]);
    const chips = ['', ...concepts].map(c => `<button class="chip ${c === concept ? 'on' : ''}" data-c="${c}">${c || 'All'}</button>`).join('');
    let list = '', day = '';
    alerts.forEach(a => { const d = dayLabel(a.ts); if (d !== day) { day = d; list += `<div class="grp">${d}</div>`; } list += alertHtml(a, true); });
    view.innerHTML = `<h3 style="margin-top:0">Alerts${alerts.length ? ` &middot; ${alerts.length}` : ''}</h3><div class="chips">${chips}</div>` +
      (alerts.length ? `<div class="alist">${list}</div>` : '<p class="mut">No alerts yet. They appear when a SORK concept becomes valid.</p>') +
      `<details class="more"><summary>Alert settings</summary><div class="card"><h4>Alert messages in Telegram</h4>
      <div class="row"><button class="btn" id="sub">${me.subscribed ? 'On: tap to pause' : 'Paused: tap to turn on'}</button></div>
      <p class="small">Send me alerts for:</p><div class="row">${concepts.map(c => `<label><input type="checkbox" class="cc" value="${c}" ${me.concepts.includes(c) ? 'checked' : ''}> ${c}</label>`).join(' ')}</div>
      ${me.muted.length ? `<p class="small">Muted: ${me.muted.join(', ')} <button class="chip" id="unmute">Unmute all</button></p>` : ''}</div></details>`;
    view.querySelectorAll('.chip[data-c]').forEach(b => b.onclick = () => { concept = b.dataset.c; renderAlerts(); });
    view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openSymbol(b.dataset.open));
    document.getElementById('sub').onclick = async () => { await api('/api/me/settings', { method: 'POST', body: JSON.stringify({ subscribed: !me.subscribed }) }); renderAlerts(); };
    view.querySelectorAll('.cc').forEach(cb => cb.onchange = async () => {
      const sel = [...view.querySelectorAll('.cc:checked')].map(x => x.value);
      await api('/api/me/settings', { method: 'POST', body: JSON.stringify({ concepts: sel.length === concepts.length ? [] : sel }) });
    });
    const um = document.getElementById('unmute'); if (um) um.onclick = async () => { await api('/api/me/settings', { method: 'POST', body: JSON.stringify({ muted: [] }) }); renderAlerts(); };
  } catch (e) { view.innerHTML = `<p class="down">${esc(e.message)}</p>`; }
}

// ------------------------------------------------------------ study guide
function renderGuide() {
  view.innerHTML = `<div class="row"><button class="btn" id="pdf">Download the PDF</button></div><iframe src="/static/guide.html" title="SORK study guide"></iframe>`;
  document.getElementById('pdf').onclick = () => {
    const u = location.origin + '/static/SORK_Trading_Concept_Study_Guide.pdf';
    tg ? tg.openLink(u) : window.open(u, '_blank');
  };
}

const q = new URLSearchParams(location.search).get('sym') || (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
if (q) openSymbol(q); else renderSymbols();
