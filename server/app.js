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
import { Service, formatAlert } from './service.js';
import { alertParam, alertId, checkParam, isAlertId, xpStatusText } from './alertlink.js';
import { rankTag } from './ranks.js';
import { ALL_CONCEPTS, Store } from './store.js';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.json': 'application/json' };
const sleep = (ms, signal) => new Promise((r) => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

const HELP = '<b>B-JEFF bot</b>\nOpen the B-Jeff terminal';

export function createApp({ cfg = loadConfig(), store, svc, deriv, bot, log = console, background = true } = {}) {
  store ||= new Store(cfg.dbPath);
  svc ||= new Service(store, undefined, log);
  deriv ||= new Deriv(cfg.derivUrls, cfg.derivAppId, log);
  bot ||= cfg.botToken ? new Bot(cfg.botToken) : null;
  const abort = new AbortController();
  let tasks = [];
  let warm = false;                                   // first feed pass only fills the alert list, it does not message anyone
  const backup = bot && cfg.stateChatId ? new TelegramBackup(bot, cfg.stateChatId, log) : null;

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
      try { for (const a of await svc.refresh(deriv, id)) { log.info('alert', a.key); await notify(a); } }
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
    if (path === '/api/alerts' && req.method === 'GET') {
      const chatC = cfg.chatConcepts || ['R', 'K', 'QML', 'ADV'];
      // oid: the id the app remembers for the alert; xp: true when the alert was posted to the channel with an XP link
      const alerts = store.recentAlerts({ symbol: q.get('symbol') || undefined, concept: q.get('concept') || undefined,
        limit: q.get('limit') || 50, before: q.get('before') || undefined })
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
    if (path === '/api/alert-analysed' && req.method === 'POST') {   // the person finished the Intercept Analysis of an alert they opened
      const b = await readJson(req);
      if (user && isAlertId(b.id) && store.xpState(user.id, b.id) >= 1) store.xpMark(user.id, b.id, 2);
      return json(res, 200, { ok: true });
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
    // Groups and channels: reclamation, key level, QML and bjeff zone only, and never an invalidation (those stay in the app's Alerts tab and in private messages).
    if ((cfg.chatConcepts || ['R', 'K', 'QML', 'ADV']).includes(alert.concept) && !CHAT_SKIP_KINDS.has(alert.kind)) {
      for (const chat of cfg.alertChats || []) {
        try { await bot.send(chat, formatAlert(alert), btn(true)); }
        catch (e) { log.warn('could not post to', chat + ':', e.message); }
        await sleep(50);
      }
    }
    if (cfg.dmAlerts === false) return;               // channel-only mode: no private alert messages
    for (const chatId of store.recipients(alert.symbol, alert.concept)) {
      try { await bot.send(chatId, formatAlert(alert), btn(false)); } catch (e) { log.warn('could not message', chatId, e.message); }
      await sleep(50);
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
    store.importXp((backup.extra || {}).xp); store.importRanks((backup.extra || {}).ranks);
    const extra = () => ({ xp: store.exportXp(), ranks: store.exportRanks() });
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

  async function start(port = cfg.port) {
    await new Promise((r) => server.listen(port, '0.0.0.0', r));
    if (!background) return server.address().port;
    await restoreUsers();
    keepAlive();
    tasks.push(feedLoop());
    if (bot) {
      if (cfg.webappUrl) bot.setMenuButton(cfg.webappUrl).catch((e) => log.warn('could not set the menu button:', e.message));
      if (cfg.pollCommands !== false) tasks.push(bot.poll(onUpdate, log));
      else log.info('POLL_COMMANDS=0: bot commands are off, alerts still post to your chats');
    } else log.warn('BOT_TOKEN is not set: the bot is off, only the web API runs');
    return server.address().port;
  }

  async function stop() {
    abort.abort();
    bot?.stop();
    await backup?.flush();
    deriv.close?.();
    await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
    await Promise.race([Promise.allSettled(tasks), sleep(2000)]);
    store.close?.();
  }

  return { server, start, stop, svc, store, notify };
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
