// HTTP server: Telegram mini app + JSON API + background feed and bot loops. No npm dependencies.
// Run:  node server/app.js
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyInitData } from './auth.js';
import { loadConfig } from './config.js';
import { Deriv } from './deriv.js';
import { Bot } from './telegram.js';
import { TelegramBackup } from './backup.js';
import { Service, formatAlert, formatSniperAlert, isSmcAlert } from './service.js';
import { renderChart } from './chartimg.js';
import { SmcFeed, TF_SECONDS as SMC_TF } from './smcfeed.js';
import { alertParam, alertId, checkParam, isAlertId, xpStatusText } from './alertlink.js';
import { rankTag } from './ranks.js';
import { ALL_CONCEPTS, MAX_PRICE_ALERTS, MAX_SNIPER_FLOWS, Store } from './store.js';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.json': 'application/json' };
const sleep = (ms, signal) => new Promise((r) => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

const HELP = '<b>B-JEFF bot</b>\nOpen the B-Jeff terminal';

export function createApp({ cfg = loadConfig(), store, svc, deriv, bot, log = console, background = true } = {}) {
  store ||= new Store(cfg.dbPath);
  svc ||= new Service(store, undefined, log);
  svc.smcAlerts = !!cfg.smcAlerts; svc.smcOnly = !!cfg.smcOnly; svc.smcParams = { swingLen: cfg.smcSwingLen || 5, internalLen: cfg.smcInternalLen || 2 };
  deriv ||= new Deriv(cfg.derivUrls, cfg.derivAppId, log);
  bot ||= cfg.botToken ? new Bot(cfg.botToken) : null;
  const abort = new AbortController();
  let tasks = [];
  let warm = false;                                   // first feed pass only fills the alert list, it does not message anyone
  const backup = bot && cfg.stateChatId ? new TelegramBackup(bot, cfg.stateChatId, log) : null;

  // SMC indicator: live market structure / BOS / CHoCH / inducement / sweeps from the Deriv WebSocket (see smcfeed.js). Off with SMC=0.
  const smc = cfg.smc ? new SmcFeed({
    deriv, log, codeOf: (id) => { const s = svc.byId.get(id); return (s && s.code) || null; },
    params: { swingLen: cfg.smcSwingLen || 5, internalLen: cfg.smcInternalLen || 2 },
    timeframes: (cfg.smcTimeframes || ['m5', 'h1', 'h4']).map((x) => SMC_TF[x]).filter(Boolean), pinned: cfg.smcPinned || [] }) : null;
  const sseClients = new Set();

  const priceNow = (sid) => { const st = svc.states.get(sid); return st && st.price != null ? st.price : null; };
  // ------------------------------------------------------------ http
  const json = (res, code, data) => {
    const body = JSON.stringify(data);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  };

  function serveFile(res, file, cache) {
    let st;
    try { st = statSync(file); } catch { st = null; }
    if (!st || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': cache ? 'public, max-age=3600' : 'no-cache' });
    createReadStream(file).pipe(res);
  }

  function readJson(req) {
    return new Promise((resolveBody, reject) => {
      let n = 0; const chunks = [];
      req.on('data', (c) => { n += c.length; if (n > 20000) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }

  function authUser(req) {
    const raw = req.headers['x-telegram-init-data'] || '';
    const user = cfg.botToken ? verifyInitData(String(raw), cfg.botToken) : null;
    if (user) return user;
    return cfg.requireAuth ? null : { id: 0, first_name: 'dev' };      // DEV_ALLOW_NO_AUTH=1 is for local testing only
  }

  // Live chart: refresh just the symbol that is open, at most once per 1.5 s however many viewers there are.
  const liveBusy = new Map(), liveLast = new Map();
  async function liveRefresh(id) {
    if (liveBusy.has(id)) return liveBusy.get(id);
    if (Date.now() - (liveLast.get(id) || 0) < 1500) return;
    const job = (async () => {
      try { for (const a of await svc.refresh(deriv, id)) { log.info('alert', a.key); await notify(a); } await checkPriceAlerts(id); await checkSniperFlows(id); }
      catch (e) { log.warn('live refresh', id, 'failed:', e.message); }
      finally { liveLast.set(id, Date.now()); liveBusy.delete(id); }
    })();
    liveBusy.set(id, job); return job;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (path === '/healthz') return json(res, 200, { ok: true });
    if (path === '/' || path === '/index.html') return serveFile(res, join(WEB, 'index.html'), false);
    if (path.startsWith('/static/')) {
      const file = normalize(join(WEB, path.slice('/static/'.length)));
      if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
      return serveFile(res, file, /\.(png|pdf)$/.test(file));
    }
    if (!path.startsWith('/api/')) { res.writeHead(404); return res.end('not found'); }

    const user = authUser(req);
    if (!user) return json(res, 401, { error: 'open this app from Telegram' });
    const q = url.searchParams;
    if (path === '/api/symbols' && req.method === 'GET') return json(res, 200, { symbols: svc.overview() });
    if (path.startsWith('/api/symbol/') && req.method === 'GET') {
      const id = decodeURIComponent(path.slice('/api/symbol/'.length));
      if (q.get('live') === '1') await liveRefresh(id);          // the open chart asks for fresh data every few seconds
      const v = svc.symbolView(id);
      return v ? json(res, 200, v) : json(res, 404, { error: 'unknown symbol' });
    }
    // ---- SMC indicator. GET /api/smc?symbol=V75&tf=m5 = the current snapshot; GET /api/smc/stream = the same plus live pushes (Server-Sent Events).
    if ((path === '/api/smc' || path === '/api/smc/stream') && req.method === 'GET') {
      if (!smc) return json(res, 404, { error: 'SMC indicator is off' });
      const sym = q.get('symbol') || '', tfKey = (q.get('tf') || 'm5').toLowerCase(), tf = SMC_TF[tfKey];
      if (!svc.byId.has(sym) || !tf || !smc.supports(tf)) return json(res, 400, { error: 'unknown symbol or timeframe' });
      const first = (await smc.watch(sym, tf)) || { sym, tf, state: 'starting', trend: 0, annotations: [], live: [] };
      if (path === '/api/smc') return json(res, 200, first);
      if (sseClients.size >= 300) return json(res, 503, { error: 'too many live viewers' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const send = (ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ } };
      const mine = (m) => m.sym === sym && m.tf === tf;
      const onSnap = (m) => mine(m) && send('snapshot', m.snap), onUpd = (m) => mine(m) && send('update', m), onLive = (m) => mine(m) && send('live', m);
      smc.on('snapshot', onSnap); smc.on('update', onUpd); smc.on('live', onLive);
      const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { /* closed */ } smc.touch(sym, tf); }, 15000);
      const done = () => { clearInterval(hb); smc.off('snapshot', onSnap); smc.off('update', onUpd); smc.off('live', onLive); sseClients.delete(res); };
      sseClients.add(res); req.on('close', done); res.on('close', done);
      res.write('retry: 3000\n\n'); send('snapshot', first);
      return;
    }
    // ---- the SORK rules on the SMC order flow: GET /api/smc/flow?symbol=V75 = overlays (key level, M5 POI, 50% POI, bjeff zone, QML), reclamation steps and checklist
    if (path === '/api/smc/flow' && req.method === 'GET') {
      if (!svc.smcAlerts) return json(res, 404, { error: 'SMC flow is off' });
      const v = svc.smcView(q.get('symbol') || '');
      return v ? json(res, 200, v) : json(res, 400, { error: 'unknown symbol' });
    }
    if (path === '/api/alerts' && req.method === 'GET') {
      const chatC = cfg.chatConcepts || ['R', 'K', 'QML', 'ADV'];
      // oid: the id the app remembers for the alert; xp: true when the alert was posted to the channel with an XP link
      const alerts = store.recentAlerts({ symbol: q.get('symbol') || undefined, concept: q.get('concept') || undefined,
        limit: q.get('limit') || 50, before: q.get('before') || undefined, smcOnly: !!cfg.smcOnly })
        .map((a) => ({ ...a, oid: alertId(a), xp: chatC.includes(a.concept) && !CHAT_SKIP_KINDS.has(a.kind) }));
      return json(res, 200, { alerts });
    }
    if (path === '/api/alert-open' && req.method === 'POST') {       // the app asks whether a button link is a real, recent alert
      const b = await readJson(req);
      const r = checkParam(b.p, cfg.botToken);
      if (r.ok && user) store.xpMark(user.id, r.id, 1);         // remembered per person, so the channel post can show their XP status privately
      return json(res, 200, r);
    }
    if (path === '/api/rank' && req.method === 'POST') {            // the app reports the person's rank so the group can show it as a tag
      const b = await readJson(req), tag = rankTag(b.b || null, b.r);
      if (user && tag) { store.upsertUser(user.id, user.first_name || ''); store.rankSet(user.id, tag); applyRankTag(user.id); }
      return json(res, 200, { ok: !!tag });
    }
    // ---- price alerts (the person drags a line on the chart; one message when price gets there)
    // The chart timeframe the alert is set on ('m5' | 'h1' | 'h4') is kept with it: its Telegram picture is a screenshot of that timeframe.
    const TF_SECONDS = { m5: 300, h1: 3600, h4: 14400 }, tfOf = (x) => TF_SECONDS[x] || 300;
    if (path === '/api/price-alerts' && req.method === 'GET') {
      store.upsertUser(user.id, user.first_name || '');
      return json(res, 200, { alerts: store.paList(user.id, q.get('symbol') || undefined) });
    }
    if (path === '/api/price-alerts' && req.method === 'POST') {
      const b = await readJson(req), cur = priceNow(b.symbol), price = Number(b.price);
      if (cur === null) return json(res, 400, { error: 'No live price for this symbol yet.' });
      if (!(price > 0) || !Number.isFinite(price) || Math.abs(price - cur) < 1e-9) return json(res, 400, { error: 'Pick a price different from the current price.' });
      store.upsertUser(user.id, user.first_name || '');
      const a = store.paAdd(user.id, b.symbol, price, price > cur ? 1 : -1, tfOf(b.tf));
      return a ? json(res, 200, { alert: a }) : json(res, 400, { error: `You can have at most ${MAX_PRICE_ALERTS} price alerts. Remove one first.` });
    }
    if (path === '/api/price-alerts/update' && req.method === 'POST') {
      const b = await readJson(req), mine = store.paList(user.id).find((a) => a.id === b.id), price = Number(b.price);
      if (!mine) return json(res, 404, { error: 'Alert not found.' });
      const cur = priceNow(mine.symbol);
      if (cur === null || !(price > 0) || !Number.isFinite(price) || Math.abs(price - cur) < 1e-9) return json(res, 400, { error: 'Pick a price different from the current price.' });
      store.paUpdate(user.id, b.id, price, price > cur ? 1 : -1, TF_SECONDS[b.tf] || 0);
      return json(res, 200, { alert: store.paList(user.id).find((a) => a.id === b.id) });
    }
    if (path === '/api/price-alerts/delete' && req.method === 'POST') {
      const b = await readJson(req);
      return json(res, 200, { ok: store.paDelete(user.id, String(b.id || '')) });
    }
    // ---- Sniper Mode: the person sets the order flow (inducement + disruption POIs) by hand; the bot then alerts them to the rest of SORK
    if (path === '/api/sniper' && req.method === 'GET') {
      store.upsertUser(user.id, user.first_name || '');
      const sid = q.get('symbol') || '', flow = store.sniperList(user.id, sid)[0] || null;
      const pois = ((svc.states.get(sid) || {}).o || {}).pois || [], I = pois.find((x) => x.role === 'inducement'), D = pois.find((x) => x.role === 'disruption');
      const suggest = I && D ? { dir: I.dir, ind: { lo: I.lo, hi: I.hi, t: I.ob_t }, dis: { lo: D.lo, hi: D.hi, t: D.ob_t } } : null;     // the bot's own reading: a starting point
      return json(res, 200, { flow, suggest });
    }
    if (path === '/api/sniper' && req.method === 'POST') {
      const b = await readJson(req), sid = String(b.symbol || ''), s = svc.byId.get(sid), now = Math.floor(Date.now() / 1000);
      if (!s || !s.available) return json(res, 400, { error: 'This symbol is not monitored.' });
      const dir = Number(b.dir), poi = (x) => ({ lo: Number(x && x.lo), hi: Number(x && x.hi), t: Math.floor(Number(x && x.t)) });
      const spec = { dir, ind: poi(b.ind), dis: poi(b.dis) };
      if (dir !== 1 && dir !== -1) return json(res, 400, { error: 'Pick bullish or bearish.' });
      for (const [name, x] of [['inducement', spec.ind], ['disruption', spec.dis]]) {
        if (![x.lo, x.hi, x.t].every(Number.isFinite) || !(x.lo > 0) || !(x.hi > x.lo)) return json(res, 400, { error: `Set the ${name} high above its low.` });
        if (x.t <= 0 || x.t > now + 60) return json(res, 400, { error: `The ${name} has no valid time.` });
      }
      if (dir === 1 ? !(spec.ind.lo > spec.dis.hi) : !(spec.ind.hi < spec.dis.lo))
        return json(res, 400, { error: dir === 1 ? 'For a bullish order flow the inducement must sit above the disruption.' : 'For a bearish order flow the inducement must sit below the disruption.' });
      if (svc.sniperDead(sid, spec)) return json(res, 400, { error: 'Price already went beyond your disruption since it formed, so this order flow is over. Pick a disruption that still holds.' });
      store.upsertUser(user.id, user.first_name || '');
      const flow = store.sniperSet(user.id, sid, spec, now);
      return flow ? json(res, 200, { flow }) : json(res, 400, { error: `You can have at most ${MAX_SNIPER_FLOWS} Sniper Mode flows. Stop one first.` });
    }
    if (path === '/api/sniper/delete' && req.method === 'POST') {
      const b = await readJson(req);
      return json(res, 200, { ok: store.sniperDelete(user.id, String(b.id || '')) });
    }
    if (path === '/api/me' && req.method === 'GET') return json(res, 200, { me: store.upsertUser(user.id, user.first_name || ''), concepts: ALL_CONCEPTS,
      links: { group: /^https:\/\/t\.me\//.test(cfg.groupUrl || '') ? cfg.groupUrl : '', channel: /^https:\/\/t\.me\//.test(cfg.channelUrl || '') ? cfg.channelUrl : '' } });
    if (path === '/api/me/settings' && req.method === 'POST') {
      store.upsertUser(user.id, user.first_name || '');
      const b = await readJson(req);
      return json(res, 200, { me: store.updateSettings(user.id, { subscribed: b.subscribed, muted: b.muted, concepts: b.concepts }) });
    }
    return json(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      log.error('request failed', req.url, e.message);
      if (!res.headersSent) json(res, 500, { error: 'server error' }); else res.end();
    });
  });

  // ------------------------------------------------------------ background work
  const CHAT_SKIP_KINDS = new Set(['kl_invalid', 'invalidated']);   // alert kinds never posted to groups or channels
  async function notify(alert, force) {
    if (!bot || (!warm && !force)) return;
    if (cfg.smcOnly && !isSmcAlert(alert)) return;      // SMC-only mode (default): the bot's own non-SMC SORK alerts are never sent to Telegram (they stay in the app's Alerts tab)
    const short = alert.symbol_name.replace('Volatility ', 'V').replace(' Index', '');
    const label = `Open ${short} chart`;
    // The button opens the symbol on the main bot, straight on the SORK page (concept) that fired. Channels and groups get a
    // signed link: the first open of each alert earns 3 points. Private messages get a plain page link (no points).
    // Button colour (Telegram `style`): green for a buy setup, red for a sell setup. Invalidations and alerts without a direction keep the default colour.
    const style = alert.dir === 1 && !CHAT_SKIP_KINDS.has(alert.kind) ? 'success' : alert.dir === -1 && !CHAT_SKIP_KINDS.has(alert.kind) ? 'danger' : undefined;
    const btn = (signed) => {
      const param = alertParam(alert, cfg.botToken, signed);
      const callback = signed ? { text: 'XP status', data: `xp_${alertId(alert)}` } : undefined;   // channel posts only: a private pop-up
      if (cfg.miniAppLink) return { text: label, url: `${cfg.miniAppLink}?startapp=${param}`, plain: true, style, callback };   // t.me link: works in groups and channels
      return cfg.webappUrl ? { text: label, url: `${cfg.webappUrl}/?p=${param}`, plain: signed, style, callback } : null;
    };
    // Chart screenshot, drawn once and sent to every chat. If it cannot be drawn or sent, the plain text alert goes out as before.
    let chart = null;
    if (alert.snap && bot.sendPhoto) { try { chart = renderChart(alert.snap); } catch (e) { log.warn('chart image failed:', e.message); } }
    const deliver = async (chat, b) => {
      const text = formatAlert(alert);
      if (chart) { try { return await bot.sendPhoto(chat, chart, text, b); } catch (e) { log.warn('chart not sent to', chat + ', sending text only:', e.message); } }
      return bot.send(chat, text, b);
    };
    // Groups and channels: reclamation, key level, QML and bjeff zone only, and never an invalidation (those stay in the app's Alerts tab and in private messages).
    if ((cfg.chatConcepts || ['R', 'K', 'QML', 'ADV']).includes(alert.concept) && !CHAT_SKIP_KINDS.has(alert.kind) && (!isSmcAlert(alert) || cfg.smcAlertChats || cfg.smcOnly)) {
      for (const chat of cfg.alertChats || []) {
        try { await deliver(chat, btn(true)); }
        catch (e) { log.warn('could not post to', chat + ':', e.message); }
        await sleep(50);
      }
    }
    if (cfg.dmAlerts === false) return;               // channel-only mode: no private alert messages
    for (const chatId of store.recipients(alert.symbol, alert.concept)) {
      try { await deliver(chatId, btn(false)); } catch (e) { log.warn('could not message', chatId, e.message); }
      await sleep(50);
    }
  }

  // Price alerts that price has reached: one private message each (with Telegram's notification sound) and the alert is removed.
  async function checkPriceAlerts(sid) {
    if (!bot) return;
    const list = store.paBySymbol(sid);
    if (!list.length) return;
    for (const a of svc.hitPriceAlerts(sid, list)) {
      if (!store.paDelete(null, a.id)) continue;                                  // already handled (two refreshes at once)
      const s = svc.byId.get(sid), digits = (svc.states.get(sid) || {}).digits ?? 3, short = s.name.replace('Volatility ', 'V').replace(' Index', '');
      const text = `🔔 <b>PRICE ALERT</b>\n${s.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}\nPrice ${a.side === 1 ? 'rose to' : 'fell to'} <b>${a.price.toFixed(digits)}</b>`;
      const param = alertParam({ symbol: sid, concept: 'K' }, cfg.botToken, false);
      const button = cfg.miniAppLink ? { text: `Open ${short} chart`, url: `${cfg.miniAppLink}?startapp=${param}`, plain: true }
        : cfg.webappUrl ? { text: `Open ${short} chart`, url: `${cfg.webappUrl}/?p=${param}`, plain: false } : null;
      let png = null;
      if (bot.sendPhoto) { try { const snap = svc.priceSnap(sid, a.price, a.tf); png = snap && renderChart(snap); } catch (e) { log.warn('price alert chart failed:', e.message); } }
      try {
        if (png) { try { await bot.sendPhoto(a.tg_id, png, text, button); } catch (e) { log.warn('price alert picture not sent, sending text only:', e.message); await bot.send(a.tg_id, text, button); } }
        else await bot.send(a.tg_id, text, button);
        log.info('price alert sent', sid, a.price, 'to', a.tg_id);
      } catch (e) { log.warn('could not send the price alert to', a.tg_id + ':', e.message); }
    }
  }

  // Sniper Mode: for every active flow on this symbol, send the person each new SORK event (private message with a chart). The event keys are saved
  // BEFORE sending, so a failed send is never repeated. When the person's disruption was invalidated the flow ends (the person sets the next one).
  async function checkSniperFlows(sid) {
    if (!bot) return;
    for (const flow of store.sniperActive(sid)) {
      let r; try { r = svc.sniperEvents(sid, flow); } catch (e) { log.warn('sniper flow', flow.id, 'failed:', e.message); continue; }
      if (!r) continue;
      const fresh = r.alerts.filter((a) => !flow.seen.includes(a.key)).sort((a, b) => a.ts - b.ts);
      if (fresh.length) store.sniperMark(flow.id, fresh.map((a) => a.key));
      const s = svc.byId.get(sid), short = s.name.replace('Volatility ', 'V').replace(' Index', '');
      const param = alertParam({ symbol: sid, concept: 'K' }, cfg.botToken, false);
      for (const a of fresh) {
        const style = a.dir === 1 && a.kind !== 'invalidated' ? 'success' : a.dir === -1 && a.kind !== 'invalidated' ? 'danger' : undefined;
        const button = cfg.miniAppLink ? { text: `Open ${short} chart`, url: `${cfg.miniAppLink}?startapp=${param}`, plain: true, style }
          : cfg.webappUrl ? { text: `Open ${short} chart`, url: `${cfg.webappUrl}/?p=${param}`, plain: false, style } : null;
        const text = formatSniperAlert(a); let png = null;
        if (a.snap && bot.sendPhoto) { try { png = renderChart(a.snap); } catch (e) { log.warn('sniper chart failed:', e.message); } }
        try {
          if (png) { try { await bot.sendPhoto(flow.tg_id, png, text, button); } catch (e) { log.warn('sniper picture not sent, sending text only:', e.message); await bot.send(flow.tg_id, text, button); } }
          else await bot.send(flow.tg_id, text, button);
          log.info('sniper alert', a.key, 'to', flow.tg_id);
        } catch (e) { log.warn('could not send the sniper alert to', flow.tg_id + ':', e.message); }
        await sleep(50);
      }
      if (r.ended) store.sniperEnd(flow.id);
    }
  }

  async function feedLoop() {
    while (!abort.signal.aborted) {
      try {
        if (!svc.symbols.some((s) => s.code)) svc.setCodes(await deriv.symbolCodes());
        for (const s of svc.symbols) {
          if (abort.signal.aborted) return;
          try {
            for (const a of await svc.refresh(deriv, s.id)) { log.info('alert', a.key); await notify(a); }
            await checkPriceAlerts(s.id);
            await checkSniperFlows(s.id);
          } catch (e) { log.warn('refresh', s.id, 'failed:', e.message); }
          await sleep(200, abort.signal);
        }
      } catch (e) { log.warn('feed loop error:', e.message); await sleep(15000, abort.signal); }
      if (!warm) { warm = true; log.info('first feed pass done: alerts are live'); }
      await sleep(cfg.pollSeconds * 1000, abort.signal);
    }
  }

  // Restore recipients after a restart (no database or disk): fixed ids from ALERT_CHAT_IDS, then the Telegram backup.
  async function restoreUsers() {
    if (backup) {
      try { log.info(`restored ${store.importUsers(await backup.load())} users from the Telegram backup`); }
      catch (e) { log.warn('could not read the Telegram backup (is STATE_CHAT_ID right, and did you send /start to the bot?):', e.message); }
    }
    for (const id of cfg.alertChatIds || []) store.upsertUser(id, '');
    if (!backup) return;
    store.importXp((backup.extra || {}).xp); store.importRanks((backup.extra || {}).ranks); store.importPriceAlerts((backup.extra || {}).pa); store.importSniper((backup.extra || {}).sf);
    const extra = () => ({ xp: store.exportXp(), ranks: store.exportRanks(), pa: store.exportPriceAlerts(), sf: store.exportSniper() });
    store.onUsersChanged = () => backup.schedule(() => store.exportUsers(), extra);
    backup.schedule(() => store.exportUsers(), extra);       // write once so the backup exists from the start
  }

  // Keep-alive: a request to our own public address counts as traffic, so a free Web Service stays awake.
  function keepAlive() {
    const minutes = cfg.keepAliveMinutes || 0;
    if (!minutes) return;
    if (!cfg.webappUrl) return log.warn('KEEP_ALIVE is on but there is no public URL (set WEBAPP_URL); keep-alive is off');
    const ping = () => fetch(cfg.webappUrl + '/healthz', { signal: AbortSignal.timeout(15000) })
      .catch((e) => log.warn('keep-alive ping failed:', e.message));
    const t = setInterval(ping, minutes * 60 * 1000);
    t.unref?.();
    abort.signal.addEventListener('abort', () => clearInterval(t), { once: true });
    log.info(`keep-alive on: pinging ${cfg.webappUrl}/healthz every ${minutes} min`);
  }

  // Rank tag in the community group (Bot API setChatMemberTag: regular members only, 0-16 characters). Tried again when the person next posts.
  const tagFailed = new Set();
  const inRankGroup = (c) => !!(cfg.rankGroup && c && (String(c.id) === cfg.rankGroup || (c.username && '@' + c.username.toLowerCase() === cfg.rankGroup.toLowerCase())));
  async function applyRankTag(uid) {
    if (!bot || !cfg.rankGroup) return;
    const r = store.rankGet(uid);
    if (!r || r.applied || tagFailed.has(`${uid}:${r.tag}`)) return;
    try { await bot.call('setChatMemberTag', { chat_id: cfg.rankGroup, user_id: uid, tag: r.tag }); store.rankApplied(uid); }
    catch (e) { tagFailed.add(`${uid}:${r.tag}`); log.warn(`rank tag for ${uid} not set:`, e.message); }   // not in the group yet, or an admin
  }

  async function onUpdate(u) {
    if (u.message && u.message.from && !u.message.from.is_bot && inRankGroup(u.message.chat)) { tagFailed.delete(`${u.message.from.id}:${(store.rankGet(u.message.from.id) || {}).tag}`); await applyRankTag(u.message.from.id); }
    const cq = u.callback_query;
    if (cq && /^xp_[0-9a-z]+_[0-9a-f]{8}$/.test(cq.data || '')) {     // "My XP status" under a channel alert: answered as a pop-up for that person only
      const id = cq.data.slice(3);
      await bot.answerCallback(cq.id, xpStatusText(store.xpState(cq.from.id, id), id)).catch((e) => log.warn('xp status reply failed:', e.message));
      return;
    }
    const m = u.message || {}, text = (m.text || '').trim(), chat = m.chat && m.chat.id;
    if (!chat || !text.startsWith('/')) return;
    const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase(), uid = (m.from && m.from.id) || chat;
    store.upsertUser(uid, (m.from && m.from.first_name) || '');
    const button = cfg.webappUrl ? { text: 'Open B-JEFF terminal', url: cfg.webappUrl } : null;
    if (cmd === '/start' || cmd === '/help') await bot.send(chat, HELP, button);
    else if (cmd === '/alerts_on') { store.updateSettings(uid, { subscribed: true }); await bot.send(chat, 'Alerts are on.'); }
    else if (cmd === '/alerts_off') { store.updateSettings(uid, { subscribed: false }); await bot.send(chat, 'Alerts are paused. /alerts_on turns them back on.'); }
  }

  // SMC_SYMBOLS: keep these symbols watched even with nobody on the chart (waits until the symbol codes are known).
  async function pinSmc() {
    for (let n = 0; n < 60 && !abort.signal.aborted; n++) {
      if (svc.symbols.some((s) => s.code)) break;
      await sleep(5000, abort.signal);
    }
    for (const sym of smc.pinned) for (const tf of smc.timeframes) { if (abort.signal.aborted) return; await smc.watch(sym, tf).catch(() => null); }
  }

  async function start(port = cfg.port) {
    await new Promise((r) => server.listen(port, '0.0.0.0', r));
    if (!background) return server.address().port;
    await restoreUsers();
    keepAlive();
    tasks.push(feedLoop());
    if (smc && smc.pinned.size) tasks.push(pinSmc());
    if (bot) {
      if (cfg.webappUrl) bot.setMenuButton(cfg.webappUrl).catch((e) => log.warn('could not set the menu button:', e.message));
      if (cfg.pollCommands !== false) tasks.push(bot.poll(onUpdate, log));
      else log.info('POLL_COMMANDS=0: bot commands are off, alerts still post to your chats');
    } else log.warn('BOT_TOKEN is not set: the bot is off, only the web API runs');
    return server.address().port;
  }

  async function stop() {
    abort.abort();
    smc?.stop();
    for (const r of sseClients) { try { r.end(); } catch { /* ignore */ } }
    bot?.stop();
    await backup?.flush();
    deriv.close?.();
    await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
    await Promise.race([Promise.allSettled(tasks), sleep(2000)]);
    store.close?.();
  }

  return { server, start, stop, svc, store, notify, checkPriceAlerts, checkSniperFlows, smc };
}

// ------------------------------------------------------------ main
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = { info: (...a) => console.log(new Date().toISOString(), 'INFO', ...a), warn: (...a) => console.warn(new Date().toISOString(), 'WARN', ...a), error: (...a) => console.error(new Date().toISOString(), 'ERROR', ...a) };
  const cfg = loadConfig();
  const app = createApp({ cfg, log });
  app.start().then((p) => log.info(`SORK listening on ${p}`, cfg.webappUrl ? `(${cfg.webappUrl})` : ''));
  const bye = async () => { log.info('shutting down'); await app.stop(); process.exit(0); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
}
