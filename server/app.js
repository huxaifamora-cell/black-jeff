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
import { Service, formatAlert } from './service.js';
import { ALL_CONCEPTS, Store } from './store.js';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.json': 'application/json' };
const sleep = (ms, signal) => new Promise((r) => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

const HELP = '<b>SORK bot</b>\nOpen the mini app for the study guide, the 23 Volatility indices and the alert feed.\n\n' +
  '/alerts_on  turn alert messages on\n/alerts_off  pause alert messages\n/help  this message';

export function createApp({ cfg = loadConfig(), store, svc, deriv, bot, log = console, background = true } = {}) {
  store ||= new Store(cfg.dbPath);
  svc ||= new Service(store, undefined, log);
  deriv ||= new Deriv(cfg.derivUrls, cfg.derivAppId, log);
  bot ||= cfg.botToken ? new Bot(cfg.botToken) : null;
  const abort = new AbortController();
  let tasks = [];

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
      const v = svc.symbolView(decodeURIComponent(path.slice('/api/symbol/'.length)));
      return v ? json(res, 200, v) : json(res, 404, { error: 'unknown symbol' });
    }
    if (path === '/api/alerts' && req.method === 'GET') {
      return json(res, 200, { alerts: store.recentAlerts({ symbol: q.get('symbol') || undefined, concept: q.get('concept') || undefined,
        limit: q.get('limit') || 50, before: q.get('before') || undefined }) });
    }
    if (path === '/api/me' && req.method === 'GET') return json(res, 200, { me: store.upsertUser(user.id, user.first_name || ''), concepts: ALL_CONCEPTS });
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
  async function notify(alert) {
    if (!bot) return;
    const button = cfg.webappUrl ? { text: `Open ${alert.symbol_name.replace('Volatility ', 'V').replace(' Index', '')}`, url: `${cfg.webappUrl}/?sym=${alert.symbol}` } : null;
    for (const chatId of store.recipients(alert.symbol, alert.concept)) {
      try { await bot.send(chatId, formatAlert(alert), button); } catch (e) { log.warn('could not message', chatId, e.message); }
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
      await sleep(cfg.pollSeconds * 1000, abort.signal);
    }
  }

  async function onUpdate(u) {
    const m = u.message || {}, text = (m.text || '').trim(), chat = m.chat && m.chat.id;
    if (!chat || !text.startsWith('/')) return;
    const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase(), uid = (m.from && m.from.id) || chat;
    store.upsertUser(uid, (m.from && m.from.first_name) || '');
    const button = cfg.webappUrl ? { text: 'Open SORK', url: cfg.webappUrl } : null;
    if (cmd === '/start' || cmd === '/help') await bot.send(chat, HELP, button);
    else if (cmd === '/alerts_on') { store.updateSettings(uid, { subscribed: true }); await bot.send(chat, 'Alerts are on.'); }
    else if (cmd === '/alerts_off') { store.updateSettings(uid, { subscribed: false }); await bot.send(chat, 'Alerts are paused. /alerts_on turns them back on.'); }
  }

  async function start(port = cfg.port) {
    await new Promise((r) => server.listen(port, '0.0.0.0', r));
    if (!background) return server.address().port;
    tasks.push(feedLoop());
    if (bot) {
      if (cfg.webappUrl) bot.setMenuButton(cfg.webappUrl).catch((e) => log.warn('could not set the menu button:', e.message));
      tasks.push(bot.poll(onUpdate, log));
    } else log.warn('BOT_TOKEN is not set: the bot is off, only the web API runs');
    return server.address().port;
  }

  async function stop() {
    abort.abort();
    bot?.stop();
    deriv.close?.();
    await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
    await Promise.race([Promise.allSettled(tasks), sleep(2000)]);
    store.close?.();
  }

  return { server, start, stop, svc, store };
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
