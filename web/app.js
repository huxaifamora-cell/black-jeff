const tg = window.Telegram && Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const view = document.getElementById('view');
let tab = 'symbols', current = null, timer = null, tf = 'm5', concept = '', symConcept = '', kSub = 'K';

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
  tab = t; current = null; liveCtx = null; clearInterval(timer);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (tg) tg.BackButton.hide();
  Radar.unmount();
  ({ symbols: renderSymbols, alerts: renderAlerts, guide: renderGuide, rank: renderRank })[t]();
}

// ------------------------------------------------------------ symbols
// Radar status tab icons: ready = target lock, building = sandbag wall going up, quiet = camp tent
const RT_ICON = {
  ready: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/><path d="M12 5v3M12 16v3M5 12h3M16 12h3"/>',
  building: '<rect x="3" y="16" width="8.5" height="4.5" rx="2"/><rect x="12.5" y="16" width="8.5" height="4.5" rx="2"/><rect x="7.5" y="10.5" width="9" height="4.5" rx="2"/><path d="M10 7l2-3 2 3"/>',
  quiet: '<path d="M2 20.5L12 4l10 16.5z"/><path d="M12 20.5l-3-6.5h6z"/><path d="M12 4V2"/>',
};
// ---- tactical radar: a live sweeping scope (web/radar.js); only ready symbols are shown as targets
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
    const map = `<div class="scope"><canvas id="radar" tabindex="0" role="img" aria-label="Live radar: ${ready.length} symbol(s) ready to trade"></canvas>
      <div class="scopeinfo"><span id="rdBrg">BRG 000&deg;</span><span>TARGETS <b id="rdN">${ready.length}</b></span><span id="rdClk"></span></div></div>`;
    const last = al.alerts && al.alerts[0];
    view.innerHTML = `<h3 class="ctr" style="margin-top:0">Tactical radar</h3>${map}
      <div class="legend"><span><i style="background:#5AFF64"></i>BUY READY</span><span><i style="background:#FF6955"></i>SELL READY</span></div>` +
      `<div class="rtabs" role="tablist">${[['ready', 'Ready to trade'], ['building', 'Building'], ['quiet', 'Quiet']].map(([k, t]) => `<button role="tab" class="${radarTab === k ? 'on' : ''}" data-rt="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${RT_ICON[k]}</svg><em>${t} <span>${G[k].length}</span></em></button>`).join('')}</div>` +
      (G[radarTab].length ? G[radarTab].map(row).join('') : `<p class="mut">${{ ready: 'No symbols are ready to trade.', building: 'Nothing is building right now.', quiet: 'No quiet symbols.' }[radarTab]}</p>`) +
      (last ? `<div class="latest"><span>LATEST</span><span style="flex:1">${esc(last.title)}</span><span class="mut">${T(last.ts)}</span></div>` : '') +
      '<p class="small">Only symbols that are ready to trade appear on the scope. Bearing is fixed per symbol. Tap a target to open it.</p>';
    view.querySelectorAll('.rtabs button').forEach(b => b.onclick = () => { radarTab = b.dataset.rt; renderSymbols(); });
    view.querySelectorAll('.rrow').forEach(b => b.onclick = () => openSymbol(b.dataset.id));
    const brg = document.getElementById('rdBrg'), clk = document.getElementById('rdClk');
    Radar.mount(document.getElementById('radar'), b => { brg.textContent = 'BRG ' + String(Math.round(b * 180 / Math.PI) % 360).padStart(3, '0') + '\u00B0'; clk.textContent = new Date().toISOString().slice(11, 19) + 'Z'; }, symbols, openSymbol);
  } catch (e) { view.innerHTML = `<p class="down">${esc(e.message)}</p>`; }
}

// ------------------------------------------------------------ symbol page
function openSymbol(id) {
  Radar.unmount(); current = id; tf = 'm5'; liveCtx = null; clearInterval(timer);
  if (tg) { tg.BackButton.show(); tg.BackButton.onClick(() => setTab(tab === 'alerts' ? 'alerts' : 'symbols')); }
  loadSymbol(); timer = setInterval(loadSymbol, 3000);          // live: the chart refreshes every 3 s
}
let liveCtx = null;                                   // {id, tf, sig} of the page that is currently drawn
async function loadSymbol() {
  if (!current || loadSymbol.busy) return;
  const live = !!(liveCtx && liveCtx.id === current && document.getElementById('chart'));
  loadSymbol.busy = true;
  try {
    const v = await api('/api/symbol/' + current + '?live=1');
    if (live && v.state && liveUpdate(v)) return;                  // nothing but price and candles changed
    const al = await api('/api/alerts?symbol=' + current + '&limit=40').catch(() => ({ alerts: [] }));
    drawSymbol(v, al.alerts);
  } catch (e) { if (!live) view.innerHTML = `<p class="down">${esc(e.message)}</p>`; }
  finally { loadSymbol.busy = false; }
}
// Live tick: only the price, the clock and the chart change. A full redraw happens only when the setup itself changed.
function liveUpdate(v) {
  const s = v.state, sig = v.status + '|' + v.steps.map(x => x.state).join('');
  if (sig !== liveCtx.sig) return false;                           // the setup changed: full redraw
  const px = document.getElementById('lvPx'); if (px && s.price != null) px.textContent = N(s.price, s.digits ?? 3);
  const up = document.getElementById('lvUp'); if (up) up.textContent = T(s.updated);
  liveCtx.s = s; chart(document.getElementById('chart'), s, tf, liveCtx.name); return true;
}
// Alerts for one symbol: one navigation menu per SORK concept (structure, order flow, reclamation, key level), each with a military icon.
const SNAV = [
  ['S', 'Structure', 'M4 21V7h3v3h2V7h6v3h2V7h3v14zM10 21v-5h4v5'],                                   // fortress wall
  ['O', 'Order flow', 'M3 15h18l-2 4H5zM8 15v-3h6v3M14 13.5h7'],                                      // armoured tank
  ['R', 'Reclamation', 'M6 21V3M6 4h12l-3 4 3 4H6M3 21h6'],                                           // flag planted on retaken ground
  ['K', 'Key level', 'M12 2v5M12 17v5M2 12h5M17 12h5M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z'],    // crosshair
];
const KSUB = [['K', 'Key level'], ['QML', 'QML'], ['ADV', 'ADV']];             // QML and ADV live under the Key level menu
const inMenu = (a, c) => c === 'K' ? KSUB.some(x => x[0] === a.concept) : a.concept === c;
const inView = (a, c) => c === 'K' ? a.concept === kSub : a.concept === c;
const snavHtml = (list, cur) => `<div class="snav">${SNAV.map(([c, name, ic]) => `<button data-sc="${c}" class="${c === cur ? 'on' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ic}"/></svg><span>${name}</span><em>${list.filter(a => inMenu(a, c)).length}</em></button>`).join('')}</div>`
  + (cur === 'K' ? `<div class="pills ksub">${KSUB.map(([c, name]) => `<button data-ks="${c}" class="${c === kSub ? 'on' : ''}">${name} <span>${list.filter(a => a.concept === c).length}</span></button>`).join('')}</div>` : '');
function symAlerts(alerts) {
  const cur = symConcept || (SNAV.find(x => alerts.some(a => inMenu(a, x[0])))?.[0]) || 'S';
  const list = alerts.filter(a => inView(a, cur));
  const name = cur === 'K' ? KSUB.find(x => x[0] === kSub)[1] : SNAV.find(x => x[0] === cur)[1];
  return snavHtml(alerts, cur) + (list.length ? list.map(a => alertHtml(a)).join('') : `<p class="mut">No ${name.toLowerCase()} alerts yet.</p>`);
}
function drawSymbol(v, alerts) {
  const s = v.state, d = s ? s.digits : 3;
  let h = `<div class="row"><button class="back" id="back">&#8249; ${esc(v.short)}</button><span class="px" id="lvPx">${s && s.price != null ? N(s.price, d) : ''}</span>${arrow(s && s.s ? s.s.trend : null)}</div><div class="small">${esc(v.name)}</div>`;
  if (!v.available) h += '<p class="down">This symbol was not found on Deriv, so it is not monitored.</p>';
  const goBack = () => setTab(tab === 'alerts' ? 'alerts' : 'symbols');
  if (!s) { view.innerHTML = h + '<p class="mut">Waiting for the first data...</p>'; document.getElementById('back').onclick = goBack; return; }
  const wasOpen = !!view.querySelector('details.more[open]');       // keep "Full details" open across refreshes
  const NAME = { S: 'STRUCTURE', O: 'ORDER FLOW', R: 'RECLAMATION', K: 'KEY LEVEL' }, COL = { done: '#5AFF64', now: '#E3C16A', todo: '#3A4A2A' };
  const done = v.steps.filter(x => x.state === 'done').length, nextWp = v.steps.find(x => x.state !== 'done');
  const stp = v.steps.map(x => `<div class="rt ${x.state}"><i>${x.state === 'done' ? '&#10003;' : x.state === 'now' ? '&#9679;' : '&#9675;'}</i><b>${x.k}</b> ${esc(x.text)}</div>`).join('');
  const plan = v.plan && v.status === 'ready' ? `<div class="plan"><div><small>${v.plan.dir === 1 ? 'BUY LIMIT' : 'SELL LIMIT'}</small><span class="px">${N(s.k.active.plan.entry, d)}</span></div><div><small>STOP LOSS</small><span class="down">${N(s.k.active.plan.sl, d)}</span></div><div><small>TAKE PROFIT 1:${s.k.active.plan.rr}</small><span class="up">${N(s.k.active.plan.tp, d)}</span></div></div>` : '';
  h += `<div class="pills">${['m5', 'h1', 'h4'].map(x => `<button data-tf="${x}" class="${x === tf ? 'on' : ''}">${x.toUpperCase()}</button>`).join('')}</div>
    <canvas id="chart"></canvas><div class="small"><span class="livedot"></span>LIVE &middot; updated <span id="lvUp">${T(s.updated)}</span></div>` + plan +
    `<details class="more"${wasOpen ? ' open' : ''}><summary>Full details</summary><div class="small">${done} of 4 steps cleared. ${nextWp ? `Next: <span class="px">${nextWp.k}</span> &middot; ${esc(nextWp.text)}` : 'All steps cleared.'}</div><div class="rts">${stp}</div>` + cards(s, d) + `</details>` +
    `<h3>Alerts for this symbol</h3>` + symAlerts(alerts) +
    `<div class="row"><button class="btn" id="mute">Mute alerts for this symbol</button></div>`;
  view.innerHTML = h;
  document.getElementById('back').onclick = goBack;
  const redraw = () => chart(document.getElementById('chart'), s, tf, v.short);
  view.querySelectorAll('.pills button').forEach(b => b.onclick = () => { tf = b.dataset.tf; drawSymbol(v, alerts); });
  view.querySelectorAll('.snav button').forEach(b => b.onclick = () => { symConcept = b.dataset.sc; drawSymbol(v, alerts); });
  view.querySelectorAll('.ksub button').forEach(b => b.onclick = () => { kSub = b.dataset.ks; drawSymbol(v, alerts); });
  document.getElementById('mute').onclick = async () => {
    const { me } = await api('/api/me'); const m = new Set(me.muted); m.add(current);
    await api('/api/me/settings', { method: 'POST', body: JSON.stringify({ muted: [...m] }) });
    if (tg) tg.showAlert('Muted. You can unmute in the Alerts tab.'); else alert('Muted.');
  };
  liveCtx = { id: current, name: v.short, sig: v.status + '|' + v.steps.map(x => x.state).join(''), s };
  redraw();
}
function box(b, d) { return `${P(b.lo, d)} to ${P(b.hi, d)}`; }
function cards(s, d) {
  let h = '';
  const S = s.s;
  h += `<div class="card"><h4>S &middot; Market structure (H4)</h4>` + (S ? (S.trend_invalidated
    ? `<p><b class="${S.trend === 1 ? 'up' : 'down'}">${S.trend === 1 ? 'Uptrend' : 'Downtrend'}</b> <span class="small">(old ${S.trend_invalidated.old_dir === 1 ? 'uptrend' : 'downtrend'} invalidated)</span></p>
       <p class="small">An H1 body closed beyond the disruption POI ${T(S.trend_invalidated.t)}, so the old trend is over.</p>`
    : S.valid
    ? `<p><b class="${S.trend === 1 ? 'up' : 'down'}">${S.trend === 1 ? 'Uptrend' : 'Downtrend'} is valid</b></p>
       <p class="small">Valid BOS ${T(S.anchor_t)} at ${P(S.level, d)}. ${S.slq ? 'Liquidity (SLQ) present.' : '2 or more BOS without SLQ.'}${S.shift_pending ? ' A newer BOS the other way is not valid yet.' : ''}</p>`
    : '<p class="mut">No valid structure yet.</p>') : '<p class="mut">No data.</p>') + '</div>';
  const O = s.o;
  h += `<div class="card"><h4>O &middot; Order flow (H1)</h4>` + (O && O.pois.some(p => p.role !== 'plq') ? O.pois.filter(p => p.role !== 'plq').map(p =>
    `<p><b>${p.role === 'plq' ? 'Point of liquidity' : p.role}</b> (${p.dir === 1 ? 'bullish' : 'bearish'}) POI ${box(p, d)}</p>`).join('')
    : '<p class="mut">Nothing mapped yet.</p>') +
    (O && O.invalidated ? `<p class="down small">Inducement and disruption were invalidated ${T(O.invalidated.t)}; the trend changed direction and the order flow was re-mapped.</p>` : '') + '</div>';
  h += `<div class="card"><h4>R &middot; Reclamation (H1)</h4>` + (s.r.some(r => r.role !== 'plq') ? s.r.filter(r => r.role !== 'plq').map(r =>
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
    <p class="small">${s.qml.at_liquidity ? `Reversal ${s.qml.plq.inside ? 'at' : 'close to'} an H1 point of liquidity (POI ${box(s.qml.plq, d)}).` : 'Reversal is not at or close to a point of liquidity, so it is not alerted.'}</p></div>`;
  if (s.adv) h += `<div class="card"><h4>Advanced key level and bjeff zone</h4><p>50% POI ${box({ lo: s.adv.half[0], hi: s.adv.half[1] }, d)} ${s.adv.entered_t ? `<span class="small">price entered ${T(s.adv.entered_t)}</span>` : ''}</p>` +
    (s.adv.zones.length ? s.adv.zones.map(z => `<p class="small">bjeff zone ${box(z, d)} ${z.active_t ? 'active ' + T(z.active_t) : 'waiting for a body close inside'}</p>`).join('') : '<p class="small">No bjeff zone yet.</p>') + '</div>';
  return h;
}
// Zone colours avoid the candle colours (green up, red-orange down) and the cyan live-price line.
const TONE = { s: '#8A94A6', o: '#8E6BFF', k: '#8DC3FF', qml: '#E58FD0', pending: '#5d6875', dead: '#6B7480', adv: '#E3C16A', adv2: '#4A7CFF' };
// Which overlays each timeframe shows (everything else is hidden, not deleted: the engine still computes and alerts on it).
//  H4: BOS lines.  H1: inducement, disruption, key level POI, QML POI.  M5: key level POI with its 50% POI, and the bjeff zone.
const SHOW = {
  h4: o => o.type === 'line' && /BOS$/.test(o.label),
  h1: o => o.grp === 'o' || o.grp === 'k' || o.label === 'QML',
  m5: o => o.grp === 'k' || o.tone === 'adv' || o.tone === 'adv2',
};
function chart(cv, s, tf, name) {
  const W = cv.clientWidth, wide = W >= 600;                                        // desktop: bigger text and a taller chart
  const dpr = Math.max(window.devicePixelRatio || 1, 2), Hh = wide ? 440 : 340;   // always draw at 2x or more, so a normal desktop screen is as sharp as a phone
  const FS = wide ? 13 : 11, MONO = '"JetBrains Mono", ui-monospace, monospace';
  cv.style.height = Hh + 'px'; cv.width = W * dpr; cv.height = Hh * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const cs = (s.candles[tf] || []).slice(-80); if (!cs.length) return;
  let lo = Math.min(...cs.map(c => c[3])), hi = Math.max(...cs.map(c => c[2]));
  const shown = (s.overlays || []).filter(SHOW[tf] || (() => true));
  const span = hi - lo || 1, ov = shown.filter(o => o.type === 'box' ? (o.hi >= lo - span * .3 && o.lo <= hi + span * .3)
    : (o.tf === tf && o.y >= lo - span * .3 && o.y <= hi + span * .3));
  ov.forEach(o => { lo = Math.min(lo, o.lo ?? o.y); hi = Math.max(hi, o.hi ?? o.y); });
  const pad = (hi - lo) * .06; lo -= pad; hi += pad;
  const LH = FS + 4, GAP = 1, TH = FS + 7;
  g.font = `${FS}px ${MONO}`;
  const tw = t => Math.ceil(g.measureText(t).width) + 10;
  // Labels: zone labels live in an empty band above the candles; line labels and the live price sit in a gutter on the right.
  const boxes = ov.filter(o => o.type === 'box'), lines = ov.filter(o => o.type !== 'box');
  const priceTxt = s.price != null ? Number(s.price).toFixed(s.digits ?? 3) : '';
  // The right-hand space after the live candle is also where zone labels sit (inside their box), so it is as wide as the widest label.
  const gutter = Math.min(Math.ceil(W * .4), Math.max(priceTxt ? tw(priceTxt) : 0, ...lines.map(o => tw(o.label)), ...boxes.map(o => tw(o.label) + 6)) + 8);
  const titleTxt = (name ? name + '  ' : '') + tf.toUpperCase();
  // every timeframe also shows the current H4 trend
  // H4 bias comes from the H4 market structure alone (s.s.bias); '?' means a newer opposite H4 BOS is not valid yet
  const tr = s.s ? (s.s.bias ?? s.s.trend) : 0, sh = !!(s.s && s.s.bias_shift), trTxt = (tr === 1 ? 'H4 \u25B2 BULLISH BIAS' : tr === -1 ? 'H4 \u25BC BEARISH BIAS' : 'H4 NO BIAS') + (tr && sh ? ' (SHIFT?)' : ''), trCol = tr === 1 ? '#5AFF64' : tr === -1 ? '#FF6955' : '#8A94A6';
  g.font = `700 ${FS + 1}px ${MONO}`; const titleW = Math.ceil(g.measureText(titleTxt).width) + 14, trW = Math.ceil(g.measureText(trTxt).width) + 14;
  g.font = `${FS}px ${MONO}`;
  const bandW = Math.max(40, W - 14 - titleW - trW), need = boxes.reduce((n, o) => n + tw(o.label) + 3, 0);
  const rows = Math.min(3, Math.max(1, Math.ceil(need / bandW)));
  const TOP = 8 + TH + (rows > 1 ? (rows - 1) * (LH + GAP) : 0) + 6;            // empty headroom above the highest candle
  const Y = v => Hh - 14 - (v - lo) / (hi - lo) * (Hh - 14 - TOP), plotW = W - gutter, step = (plotW - 6) / cs.length;
  const X = t => { const i = cs.findIndex(c => c[0] >= t); return i < 0 ? plotW : i === 0 ? 0 : i * step; };
  // A box starts at the LEFT EDGE of the first candle that formed it (the candle body is drawn 60% of a slot wide, centred).
  const XL = t => { const i = cs.findIndex(c => c[0] >= t); return i < 0 ? plotW : i === 0 && cs[0][0] > t ? 0 : i * step + step * .2; };
  const labels = [];
  ov.forEach(o => {
    const col = TONE[o.tone] || '#888';
    if (o.type === 'box') {
      const x = XL(o.t0), x1 = W;
      if (o.tone === 'adv') { g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash([6, 4]); g.strokeRect(x, Y(o.hi), x1 - x, Y(o.lo) - Y(o.hi)); g.setLineDash([]); g.lineWidth = 1; }   // 50% POI: dashed
      else { g.fillStyle = col + '40'; g.fillRect(x, Y(o.hi), x1 - x, Y(o.lo) - Y(o.hi)); g.strokeStyle = col; g.strokeRect(x, Y(o.hi), x1 - x, Y(o.lo) - Y(o.hi)); }
      labels.push({ text: o.label, col, kind: 'box', x: Math.max(2, x + 2), bx: x, top: Y(o.hi), bot: Y(o.lo) });
    } else {
      const x = X(o.t0); g.strokeStyle = col; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, Y(o.y)); g.lineTo(W, Y(o.y)); g.stroke(); g.setLineDash([]);
      labels.push({ text: o.label, col, kind: 'line', y: Y(o.y) - LH / 2 });
    }
  });
  if (s.price != null && s.price >= lo && s.price <= hi) {                         // live price line
    const y = Y(s.price), col = '#5CC8E6'; g.strokeStyle = col; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
    labels.unshift({ text: priceTxt, col, kind: 'line', y: y - LH / 2, live: true });
  }
  // candles, and a list of the space they occupy (labels must stay off it)
  const solid = [];
  cs.forEach((c, i) => {
    const x = i * step + step / 2, up = c[4] >= c[1], col = up ? '#5AFF64' : '#D2603F';
    g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(x, Y(c[2])); g.lineTo(x, Y(c[3])); g.stroke();
    const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4])); g.fillRect(x - step * .3, y1, step * .6, Math.max(1, y2 - y1));
    solid.push({ x: x - step * .3 - 1, w: step * .6 + 2, y: Y(c[2]) - 1, h: Y(c[3]) - Y(c[2]) + 2 });
  });
  const hit = (a, r) => a.x < r.x + r.w && a.x + a.w > r.x && a.y < r.y + r.h && a.y + a.h > r.y;
  const taken = [];
  // title tag: symbol name and timeframe, top left
  { const r = { x: 4, y: 4, w: titleW, h: TH }; taken.push(r);
    g.fillStyle = 'rgba(12,17,9,.92)'; g.strokeStyle = '#5CC8E6'; g.beginPath(); g.roundRect ? g.roundRect(r.x, r.y, r.w, r.h, 3) : g.rect(r.x, r.y, r.w, r.h); g.fill(); g.stroke();
    g.fillStyle = '#EDEBD8'; g.font = `700 ${FS + 1}px ${MONO}`; g.textBaseline = 'middle'; g.fillText(titleTxt, r.x + 7, r.y + r.h / 2 + .5);
    // H4 trend badge, right after the title tag: green = uptrend, red = downtrend, grey = no valid trend yet
    const t = { x: r.x + r.w + 6, y: 4, w: trW, h: TH }; taken.push(t);
    g.fillStyle = 'rgba(12,17,9,.92)'; g.strokeStyle = trCol; g.lineWidth = 1.5; g.beginPath(); g.roundRect ? g.roundRect(t.x, t.y, t.w, t.h, 3) : g.rect(t.x, t.y, t.w, t.h); g.fill(); g.stroke(); g.lineWidth = 1;
    g.fillStyle = trCol; g.fillText(trTxt, t.x + 7, t.y + t.h / 2 + .5); g.textBaseline = 'alphabetic'; g.font = `${FS}px ${MONO}`; }
  const free = r => !taken.some(t => hit(r, t)) && !solid.some(t => hit(r, t));
  const place = (l, w) => {
    const bandTop = 4, ys = [];
    for (let y = bandTop; y + LH <= Hh - 2; y += LH + GAP) ys.push(y);
    if (l.kind === 'line') {                                                      // gutter first (nearest free slot to its price), then the top band
      const x = W - w - 2, base = Math.max(1, Math.min(l.y, Hh - LH - 1));
      for (let d = 0; d < Hh; d += LH + GAP) for (const y of [base + d, base - d]) { const r = { x, y, w, h: LH }; if (y >= 1 && y + LH <= Hh - 1 && free(r)) return r; }
    }
    if (l.kind === 'box') {                                                       // zone label: INSIDE its own box, in the space after the live candle
      const rx = plotW + 8, xs = [];                                              // (the box runs on to the right edge, past the live candle)
      if (rx + w <= W - 2) xs.push(rx);
      for (let x = l.x; x + w <= W - 2; x += 6) xs.push(x);                       // fallback: wherever the candles leave room
      for (const x of xs) for (let y = l.top + 1; y + LH <= l.bot - 1; y += 3) { const r = { x, y, w, h: LH, inside: true }; if (y >= 1 && y + LH <= Hh - 1 && free(r)) return r; }
      const ysB = []; for (let k = 0; k < 4; k++) ysB.push(l.bot + 1 + k * (LH + 1), l.top - LH - 1 - k * (LH + 1));   // box too thin: just below or above it, nearest first (a leader line points back to the box)
      for (const x of xs) for (const y of ysB) { const r = { x, y, w, h: LH }; if (y >= 1 && y + LH <= Hh - 1 && free(r)) return r; }
    }
    const want = l.x ?? W, order = []; for (let x = 2; x + w <= W - 2; x += 6) order.push(x); order.sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
    for (const y of ys) for (const x of order) { const r = { x, y, w, h: LH }; if (free(r)) return r; }      // empty space, top rows first
    const x = l.kind === 'line' ? W - w - 2 : Math.min(l.x ?? 2, W - w - 2); let y = l.kind === 'line' ? l.y : ys[0];      // no empty space left: overlap as little as possible
    for (let n = 0; n < 30 && taken.some(t => hit({ x, y, w, h: LH }, t)); n++) y += LH + GAP;
    return { x, y: Math.max(1, Math.min(y, Hh - LH - 1)), w, h: LH };
  };
  labels.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
  labels.forEach(l => {
    const w = tw(l.text), r = place(l, w); taken.push(r);
    if (l.kind === 'box' && !r.inside) {                                           // leader line: label -> its box
      const cx = r.x + r.w / 2, ax = Math.min(Math.max(cx, l.bx + 2), W - 2);
      const above = r.y + LH <= l.top, below = r.y >= l.bot;
      const sy = above ? r.y + LH : below ? r.y : r.y + LH / 2, ay = above ? l.top : below ? l.bot : Math.min(Math.max(r.y + LH / 2, l.top), l.bot);
      g.strokeStyle = l.col; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, sy); g.lineTo(ax, ay); g.stroke(); g.lineWidth = 1;
      g.fillStyle = l.col; g.beginPath(); g.arc(ax, ay, 2.5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = l.col; g.globalAlpha = .95; g.beginPath(); g.roundRect ? g.roundRect(r.x, r.y, r.w, r.h, 3) : g.rect(r.x, r.y, r.w, r.h); g.fill(); g.globalAlpha = 1;
    g.fillStyle = ['#8DC3FF', '#E3C16A', '#5CC8E6', '#E58FD0', '#8A94A6'].includes(l.col) ? '#10150C' : '#F4F2E2'; g.textBaseline = 'middle'; g.fillText(l.text, r.x + 5, r.y + r.h / 2 + .5); g.textBaseline = 'alphabetic';
  });
  return { toPrice: y => lo + (Hh - 14 - y) / (Hh - 14 - TOP) * (hi - lo), xOf: X, step, lo, hi };
}

// ------------------------------------------------------------ alerts
// One compact row per alert: concept badge, short title, symbol and time. Tap a row to read the details.
const dayLabel = ts => { const d = new Date(ts * 1000), n = new Date(), ymd = x => x.toDateString();
  return ymd(d) === ymd(n) ? 'Today' : ymd(d) === ymd(new Date(n - 864e5)) ? 'Yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const clock = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const alertHtml = (a, withOpen) => `<details class="arow"><summary><span class="bdg">${esc(a.concept || '')}</span><span class="at"><b>${esc(a.title.replace(/^[A-Z]+: /, ''))}</b><span class="m">${esc(a.symbol_name.replace('Volatility ', 'V').replace(' Index', ''))}</span></span><span class="tm">${clock(a.ts)}</span></summary>
  <div class="ab">${esc(a.body)}${withOpen ? `<div><button class="btn" data-open="${esc(a.symbol)}">Open chart</button></div>` : ''}</div></details>`;
async function renderAlerts() {
  const SHOWN = 40;
  view.innerHTML = '<p class="mut">Loading...</p>';
  try {
    const [{ alerts }, { me, concepts }] = await Promise.all([api('/api/alerts?limit=100'), api('/api/me')]);
    const alerts2 = (concept ? alerts.filter(a => inView(a, concept)) : alerts).slice(0, SHOWN);
    let list = '', day = '';
    alerts2.forEach(a => { const d = dayLabel(a.ts); if (d !== day) { day = d; list += `<div class="grp">${d}</div>`; } list += alertHtml(a, true); });
    view.innerHTML = `<h3 style="margin-top:0">Alerts${alerts2.length ? ` &middot; ${alerts2.length}` : ''}</h3>${snavHtml(alerts, concept)}` +
      (alerts2.length ? `<div class="alist">${list}</div>` : '<p class="mut">No alerts yet. They appear when a SORK concept becomes valid.</p>') +
      `<details class="more"><summary>Alert settings</summary><div class="card"><h4>Alert messages in Telegram</h4>
      <div class="row"><button class="btn" id="sub">${me.subscribed ? 'On: tap to pause' : 'Paused: tap to turn on'}</button></div>
      <p class="small">Send me alerts for:</p><div class="row">${concepts.map(c => `<label><input type="checkbox" class="cc" value="${c}" ${me.concepts.includes(c) ? 'checked' : ''}> ${c}</label>`).join(' ')}</div>
      ${me.muted.length ? `<p class="small">Muted: ${me.muted.join(', ')} <button class="chip" id="unmute">Unmute all</button></p>` : ''}</div></details>`;
    view.querySelectorAll('.snav button').forEach(b => b.onclick = () => { concept = concept === b.dataset.sc ? '' : b.dataset.sc; renderAlerts(); });
    view.querySelectorAll('.ksub button').forEach(b => b.onclick = () => { kSub = b.dataset.ks; renderAlerts(); });   // tap the active menu again to see every alert
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
  view.innerHTML = `<div class="row"><button class="btn" id="pdf">Download the PDF</button><button class="btn" id="qz">Proficiency Exam</button></div><div id="gprog" class="gprog"></div><iframe src="/static/guide.html" title="SORK study guide"></iframe>`;
  document.getElementById('pdf').onclick = () => {
    const u = location.origin + '/static/SORK_Trading_Concept_Study_Guide.pdf';
    tg ? tg.openLink(u) : window.open(u, '_blank');
  };
  document.getElementById('qz').onclick = renderQuizMenu;
  rkGuideBar();
  const fr = view.querySelector('iframe'); fr.addEventListener('load', () => rkGuideHook(fr));
}

// Start link: ?p= / start_param is "<symbol>_<concept>" (page link) or "<symbol>_<concept>_<ts>_<id>_<sig>" (alert button from a
// group or channel); the old forms "?sym=V10" and a bare "V10" still work.
const link = new URLSearchParams(location.search).get('p') || new URLSearchParams(location.search).get('sym') || (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
const [q, lc] = link.split('_');
if (q) {
  if (lc === 'QML' || lc === 'ADV') { symConcept = 'K'; kSub = lc; } else if (['S', 'O', 'R', 'K'].includes(lc)) symConcept = lc;
  openSymbol(q);
} else renderSymbols();
rkCheckIn().then(() => { if (link.split('_').length === 5) rkAlertOpen(link); });
