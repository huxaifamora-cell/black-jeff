import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { C } from '../server/engine.js';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { WANTED, norm } from '../server/symbols.js';

const quiet = { info() {}, warn() {}, error() {} };

// A fake Deriv that serves a deterministic wavy market, so the whole pipeline can run offline.
const fakeDeriv = {
  async symbolCodes() { return Object.fromEntries(WANTED.map((n, i) => [norm(n), `SYM${i}`])); },
  async candles(code, gran, count) {
    const end = Math.floor(Date.now() / 1000 / gran) * gran, out = [];
    let p = 1000 + (code.length % 7) * 10;
    for (let i = 0; i < count; i++) {
      const o = p, c = p + 4 * Math.sin(i / 5) + 0.6 * Math.cos(i / 2);
      out.push(C(end - (count - i) * gran, o, Math.max(o, c) + 0.5, Math.min(o, c) - 0.5, c)); p = c;
    }
    return out;
  },
  close() {},
};

async function waitFor(fn, ms = 8000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); }
}

test('server: API end to end with a fake feed (dev mode, no login)', async () => {
  const cfg = { botToken: '', webappUrl: '', port: 0, dbPath: ':memory:', requireAuth: false, pollSeconds: 1, derivUrls: [], derivAppId: '1' };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: fakeDeriv, log: quiet });
  const port = await app.start(0), base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await (await fetch(`${base}/healthz`)).json()).ok, true);
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes('SORK'));
    assert.equal((await fetch(`${base}/static/guide.html`)).status, 200);
    assert.equal((await fetch(`${base}/static/fig/f01_overview.png`)).headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/static/..%2Fserver%2Fapp.js`)).status === 200, false);    // no path traversal
    const view = await waitFor(async () => { const v = await (await fetch(`${base}/api/symbol/V10`)).json(); return v.state ? v : null; });
    assert.equal(view.name, 'Volatility 10 Index');
    assert.ok(view.state.candles.m5.length > 100 && Array.isArray(view.state.overlays));
    const { symbols } = await (await fetch(`${base}/api/symbols`)).json();
    assert.equal(symbols.length, 23);
    assert.equal((await fetch(`${base}/api/symbol/NOPE`)).status, 404);
    const me = await (await fetch(`${base}/api/me`)).json();
    assert.equal(me.me.subscribed, true);
    const set = await (await fetch(`${base}/api/me/settings`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscribed: false, muted: ['V10'], concepts: ['S', 'K'] }) })).json();
    assert.deepEqual([set.me.subscribed, set.me.muted, set.me.concepts], [false, ['V10'], ['S', 'K']]);
    assert.ok(Array.isArray((await (await fetch(`${base}/api/alerts?limit=5`)).json()).alerts));
  } finally { await app.stop(); }
});

test('server: login is required when not in dev mode', async () => {
  const token = '123456:TEST';
  const cfg = { botToken: token, webappUrl: '', port: 0, dbPath: ':memory:', requireAuth: true, pollSeconds: 60, derivUrls: [], derivAppId: '1' };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: fakeDeriv, bot: { send() {}, stop() {}, poll() {}, setMenuButton() { return Promise.resolve(); } }, log: quiet, background: false });
  const port = await app.start(0), base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/api/symbols`)).status, 401);
    assert.equal((await fetch(`${base}/api/symbols`, { headers: { 'x-telegram-init-data': 'hash=bad' } })).status, 401);
    const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 7, first_name: 'Z' }) };
    const check = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
    const hash = createHmac('sha256', createHmac('sha256', 'WebAppData').update(token).digest()).update(check).digest('hex');
    const init = new URLSearchParams({ ...fields, hash }).toString();
    const r = await fetch(`${base}/api/me`, { headers: { 'x-telegram-init-data': init } });
    assert.equal(r.status, 200); assert.equal((await r.json()).me.tg_id, 7);
  } finally { await app.stop(); }
});

test('users can be exported and restored without a database file', async () => {
  const { Store } = await import('../server/store.js');
  const a = new Store(':memory:');
  let changes = 0; a.onUsersChanged = () => changes++;
  a.upsertUser(5, 'Ann'); a.updateSettings(5, { subscribed: false, muted: ['V10'], concepts: ['S'] });
  assert.ok(changes >= 2);
  const b = new Store(':memory:');
  assert.equal(b.importUsers(a.exportUsers()), 1);
  const u = b.getUser(5);
  assert.deepEqual([u.subscribed, u.muted, u.concepts], [false, ['V10'], ['S']]);
  assert.deepEqual(b.recipients('V50', 'S'), []);
});

test('ALERT_CHAT_IDS recipients are seeded and the keep-alive pings /healthz', async () => {
  const cfg = { botToken: 'x', webappUrl: 'http://127.0.0.1:1', port: 0, dbPath: ':memory:', requireAuth: true, pollSeconds: 60,
    derivUrls: [], derivAppId: '1', alertChatIds: [11, 22], stateChatId: '', keepAliveMinutes: 0.0005 };
  const hits = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { hits.push(String(u)); return { ok: true }; };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: { symbolCodes: async () => ({}), close() {} },
    bot: { send() {}, stop() {}, poll() { return new Promise(() => {}); }, setMenuButton() { return Promise.resolve(); } }, log: quiet });
  try {
    await app.start(0);
    assert.deepEqual(app.store.recipients('V10', 'S').sort(), [11, 22]);
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(hits.some((h) => h.endsWith('/healthz')));
  } finally { globalThis.fetch = realFetch; await app.stop(); }
});

test('TelegramBackup saves a pinned file and reads it back', async () => {
  const { TelegramBackup } = await import('../server/backup.js');
  const calls = []; let stored = null; const realFetch = globalThis.fetch;
  const bot = { token: 'T', base: 'https://tg/botT/', async call(m, p) {
    calls.push(m);
    if (m === 'getChat') return { pinned_message: { message_id: 9, document: { file_name: 'sork-users.json', file_id: 'f' } } };
    if (m === 'getFile') return { file_path: 'docs/x.json' };
    return {};
  } };
  globalThis.fetch = async (u, o) => {
    if (String(u).endsWith('sendDocument')) { stored = await o.body.get('document').text(); return { json: async () => ({ ok: true, result: { message_id: 10 } }) }; }
    return { ok: true, json: async () => JSON.parse(stored) };
  };
  try {
    const b = new TelegramBackup(bot, '1', quiet, 10);
    b.schedule(() => [{ tg_id: 7 }]); await b.flush();
    assert.ok(calls.includes('pinChatMessage'));
    assert.deepEqual(await b.load(), [{ tg_id: 7 }]);
  } finally { globalThis.fetch = realFetch; }
});

test('alerts are posted to ALERT_CHANNEL with a plain link button', async () => {
  const sent = [];
  const cfg = { botToken: 'x', webappUrl: 'https://app.example', port: 0, dbPath: ':memory:', requireAuth: true, pollSeconds: 60,
    derivUrls: [], derivAppId: '1', alertChats: ['@chan', '-1001'], miniAppLink: 'https://t.me/b/app' };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: { symbolCodes: async () => ({}), close() {} }, background: false,
    bot: { send(c, t, b) { sent.push([c, b]); }, stop() {}, poll() {}, setMenuButton() { return Promise.resolve(); } }, log: quiet });
  assert.ok(app.notify, 'notify exposed');
  await app.notify({ symbol: 'V10', symbol_name: 'Volatility 10 Index', concept: 'S', title: 't', body: 'b' }, true);
  assert.deepEqual(sent.map((x) => x[0]), ['@chan', '-1001']); assert.equal(sent[0][1].plain, true);
  assert.equal(sent[0][1].url, 'https://t.me/b/app?startapp=V10');
  await app.stop();
});
