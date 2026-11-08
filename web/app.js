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
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const arrow = t => t === 1 ? '<span class="tr up">&#9650;</span>' : t === -1 ? '<span class="tr down">&#9660;</span>' : '<span class="tr mut">-</span>';

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
async function renderSymbols() {
  view.innerHTML = '<p class="mut">Loading...</p>';
  try {
    const { symbols } = await api('/api/symbols');
    const sec = (title, list) => `<h3>${title}</h3><div class="grid">` + list.map(s => `
      <button class="sym" data-id="${s.id}"><b>${esc(s.short)}</b>${arrow(s.trend)}<br>
      <span class="small">${s.available ? (s.price != null ? N(s.price, s.digits) : 'waiting for data') : 'not on Deriv'}</span><br>
      ${s.k ? `<span class="tag">${s.k}</span>` : ''}${s.qml ? '<span class="tag alt">QML</span>' : ''}</button>`).join('') + '</div>';
    view.innerHTML = sec('Volatility indices', symbols.filter(s => !s.name.includes('(1s)'))) +
      sec('Volatility (1s) indices', symbols.filter(s => s.name.includes('(1s)'))) +
      '<p class="small">Arrow = H4 trend from the last valid break of structure. Tags: active key level (RBS/SBR, * = low probability) and QML.</p>';
    view.querySelectorAll('.sym').forEach(b => b.onclick = () => openSymbol(b.dataset.id));
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
  let h = `<div class="row"><b style="font-size:17px">${esc(v.name)}</b><span class="mut">${s && s.price != null ? N(s.price, d) : ''}</span></div>`;
  if (!v.available) h += '<p class="down">This symbol was not found on Deriv, so it is not monitored.</p>';
  if (!s) { view.innerHTML = h + '<p class="mut">Waiting for the first data...</p>'; return; }
  h += `<div class="small">Updated ${T(s.updated)}. Charts show closed candles with the SORK zones.</div>
    <div class="pills">${['m5', 'h1', 'h4'].map(x => `<button data-tf="${x}" class="${x === tf ? 'on' : ''}">${x.toUpperCase()}</button>`).join('')}</div>
    <canvas id="chart"></canvas>` + cards(s, d) +
    `<h3>Alerts for this symbol</h3>` + (alerts.length ? alerts.map(alertHtml).join('') : '<p class="mut">No alerts yet.</p>') +
    `<div class="row"><button class="btn" id="mute">Mute alerts for this symbol</button></div>`;
  view.innerHTML = h;
  const redraw = () => chart(document.getElementById('chart'), s, tf);
  view.querySelectorAll('.pills button').forEach(b => b.onclick = () => { tf = b.dataset.tf; drawSymbol(v, alerts); });
  document.getElementById('mute').onclick = async () => {
    const { me } = await api('/api/me'); const m = new Set(me.muted); m.add(current);
    await api('/api/me/settings', { method: 'POST', body: JSON.stringify({ muted: [...m] }) });
    if (tg) tg.showAlert('Muted. You can unmute in the Alerts tab.'); else alert('Muted.');
  };
  redraw();
}
function box(b, d) { return `${N(b.lo, d)} to ${N(b.hi, d)}`; }
function cards(s, d) {
  let h = '';
  const S = s.s;
  h += `<div class="card"><h4>S &middot; Market structure (H4)</h4>` + (S ? (S.valid
    ? `<p><b class="${S.trend === 1 ? 'up' : 'down'}">${S.trend === 1 ? 'Uptrend' : 'Downtrend'} is valid</b></p>
       <p class="small">Valid BOS ${T(S.anchor_t)} at ${N(S.level, d)}. ${S.slq ? 'Liquidity (SLQ) present.' : '2 or more BOS without SLQ.'}${S.shift_pending ? ' A newer BOS the other way is not valid yet.' : ''}</p>`
    : '<p class="mut">No valid structure yet.</p>') : '<p class="mut">No data.</p>') + '</div>';
  const O = s.o;
  h += `<div class="card"><h4>O &middot; Order flow (H1)</h4>` + (O && O.pois.length ? O.pois.map(p =>
    `<p><b>${p.role === 'plq' ? 'Point of liquidity' : p.role}</b> (${p.dir === 1 ? 'bullish' : 'bearish'}) POI ${box(p, d)}</p>`).join('')
    : '<p class="mut">Nothing mapped yet.</p>') +
    (O && O.invalidated ? `<p class="down small">Inducement and disruption were invalidated ${T(O.invalidated.t)}; the trend changed direction and the order flow was re-mapped.</p>` : '') + '</div>';
  h += `<div class="card"><h4>R &middot; Reclamation (M5)</h4>` + (s.r.length ? s.r.map(r =>
    `<p>${r.role === 'plq' ? 'Point of liquidity' : r.role}: ${r.state ? 'in progress, step ' + r.state + ' of 5' : 'waiting'}${r.last_complete ? ` <span class="small">last complete ${T(r.last_complete)}</span>` : ''}</p>`).join('')
    : '<p class="mut">No POI to watch.</p>') + '<p class="small">A reclamation is a confirmation, not an entry.</p></div>';
  const K = s.k, a = K && K.active;
  h += `<div class="card"><h4>K &middot; Key level (H1)</h4>` + (a ? `<p><b>${a.type}</b> (${a.dir === 1 ? 'buy' : 'sell'}) POI ${box(a, d)}
    ${a.invalidated ? `<span class="down"> invalidated ${T(a.invalidated.t)}</span>` : (a.high_prob ? '<span class="up"> valid, high probability</span>' : '<span class="down"> valid but low probability, not traded</span>')}</p>
    <p class="small">${a.wicks} wick(s) inside the POI between the key level and its BOS.</p>` +
    (!a.invalidated && a.high_prob ? `<p class="small">${a.dir === 1 ? 'Buy' : 'Sell'} limit ${N(a.plan.entry, d)} &middot; SL ${N(a.plan.sl, d)} &middot; TP (1:${a.plan.rr}) ${N(a.plan.tp, d)}</p>` : '')
    : '<p class="mut">No valid key level (RBS or SBR) yet.</p>') +
    (K && K.pending.length ? `<p class="small">Forming: ${K.pending.map(p => p.kind + ' ' + box(p, d)).join('; ')}</p>` : '') + '</div>';
  if (s.qml) h += `<div class="card"><h4>QML (H1)</h4><p><b>${s.qml.dir === 1 ? 'Buy' : 'Sell'}</b> POI ${box(s.qml, d)} ${s.qml.invalidated_t ? '<span class="down">invalidated</span>' : ''}</p>
    <p class="small">${s.qml.at_extreme ? 'At the extreme (H1 swing high or low).' : 'Not at the extreme, so it is not alerted.'}</p></div>`;
  if (s.adv) h += `<div class="card"><h4>Advanced key level and bjeff zone</h4><p>50% POI ${box({ lo: s.adv.half[0], hi: s.adv.half[1] }, d)} ${s.adv.entered_t ? `<span class="small">price entered ${T(s.adv.entered_t)}</span>` : ''}</p>` +
    (s.adv.zones.length ? s.adv.zones.map(z => `<p class="small">bjeff zone ${box(z, d)} ${z.active_t ? 'active ' + T(z.active_t) : 'waiting for a body close inside'}</p>`).join('') : '<p class="small">No bjeff zone yet.</p>') + '</div>';
  return h;
}
const TONE = { s: '#3b5b86', o: '#1b7f8c', k: '#7a3e9d', qml: '#a87a14', pending: '#5d6875', dead: '#d8454b', adv: '#a87a14', adv2: '#1e9e6a' };
function chart(cv, s, tf) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = 260;
  cv.width = W * dpr; cv.height = Hh * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const cs = (s.candles[tf] || []).slice(-80); if (!cs.length) return;
  let lo = Math.min(...cs.map(c => c[3])), hi = Math.max(...cs.map(c => c[2]));
  const span = hi - lo || 1, ov = (s.overlays || []).filter(o => o.type === 'box' ? (o.hi >= lo - span * .3 && o.lo <= hi + span * .3)
    : (o.tf === tf && o.y >= lo - span * .3 && o.y <= hi + span * .3));
  ov.forEach(o => { lo = Math.min(lo, o.lo ?? o.y); hi = Math.max(hi, o.hi ?? o.y); });
  const pad = (hi - lo) * .06; lo -= pad; hi += pad;
  const Y = v => Hh - 14 - (v - lo) / (hi - lo) * (Hh - 28), step = (W - 6) / cs.length;
  const X = t => { const i = cs.findIndex(c => c[0] >= t); return i < 0 ? W : i === 0 ? 0 : i * step; };
  g.font = '11px sans-serif';
  const labels = [];                                  // drawn last, on solid tags, so candles and zones never hide them
  ov.forEach(o => {
    const col = TONE[o.tone] || '#888';
    if (o.type === 'box') {
      const x = X(o.t0); g.fillStyle = col + '40'; g.fillRect(x, Y(o.hi), W - x, Y(o.lo) - Y(o.hi));
      g.strokeStyle = col; g.strokeRect(x, Y(o.hi), W - x, Y(o.lo) - Y(o.hi));
      labels.push({ text: o.label, col, x: Math.max(2, x + 2), y: Y(o.hi) + 1 });
    } else {
      const x = X(o.t0); g.strokeStyle = col; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, Y(o.y)); g.lineTo(W, Y(o.y)); g.stroke(); g.setLineDash([]);
      labels.push({ text: o.label, col, x: null, y: Y(o.y) - 15 });
    }
  });
  cs.forEach((c, i) => {
    const x = i * step + step / 2, up = c[4] >= c[1], col = up ? '#1e9e6a' : '#d8454b';
    g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(x, Y(c[2])); g.lineTo(x, Y(c[3])); g.stroke();
    const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4])); g.fillRect(x - step * .3, y1, step * .6, Math.max(1, y2 - y1));
  });
  const taken = [];
  labels.forEach(l => {
    const w = Math.ceil(g.measureText(l.text).width) + 10, h = 15;
    let x = l.x == null ? W - w - 2 : Math.min(l.x, W - w - 2), y = Math.max(1, Math.min(l.y, Hh - h - 1));
    for (let n = 0; n < 20 && taken.some(r => x < r.x + r.w && x + w > r.x && y < r.y + h && y + h > r.y); n++) y = y + h + 1 > Hh - h ? 1 : y + h + 1;
    taken.push({ x, y, w });
    g.fillStyle = l.col; g.globalAlpha = .95; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, 4) : g.rect(x, y, w, h); g.fill(); g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(l.text, x + 5, y + h / 2 + .5); g.textBaseline = 'alphabetic';
  });
}

// ------------------------------------------------------------ alerts
const alertHtml = a => `<div class="alert"><b>${esc(a.title)}</b>${esc(a.body)}<div class="m">${esc(a.symbol_name)} &middot; ${T(a.ts)}</div></div>`;
async function renderAlerts() {
  view.innerHTML = '<p class="mut">Loading...</p>';
  try {
    const [{ alerts }, { me, concepts }] = await Promise.all([api('/api/alerts?limit=40' + (concept ? '&concept=' + concept : '')), api('/api/me')]);
    const chips = ['', ...concepts].map(c => `<button class="chip ${c === concept ? 'on' : ''}" data-c="${c}">${c || 'All'}</button>`).join('');
    view.innerHTML = `<div class="card"><h4>Alert messages in Telegram</h4>
      <div class="row"><button class="btn" id="sub">${me.subscribed ? 'On: tap to pause' : 'Paused: tap to turn on'}</button></div>
      <p class="small">Send me alerts for:</p><div class="row">${concepts.map(c => `<label><input type="checkbox" class="cc" value="${c}" ${me.concepts.includes(c) ? 'checked' : ''}> ${c}</label>`).join(' ')}</div>
      ${me.muted.length ? `<p class="small">Muted: ${me.muted.join(', ')} <button class="chip" id="unmute">Unmute all</button></p>` : ''}</div>
      <h3>Feed</h3><div class="row">${chips}</div>` + (alerts.length ? alerts.map(alertHtml).join('') : '<p class="mut">No alerts yet. They appear when a SORK concept becomes valid.</p>');
    view.querySelectorAll('.chip[data-c]').forEach(b => b.onclick = () => { concept = b.dataset.c; renderAlerts(); });
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
