import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { evaluate, defaultParams as P } from '../server/engine.js';
import { createApp } from '../server/app.js';
import { Service, digitsFor, formatAlert } from '../server/service.js';
import { Store } from '../server/store.js';
import { SYMBOLS, slug } from '../server/symbols.js';
import { verifyInitData } from '../server/auth.js';
import { mk } from './engine.test.js';

const quiet = { info() {}, warn() {}, error() {} };

test('symbols list', () => {
  assert.equal(SYMBOLS.length, 23);
  const ids = SYMBOLS.map((s) => s.id);
  assert.equal(new Set(ids).size, 23);
  for (const id of ['V75', 'V75s', 'V5s', 'V300s', 'V250']) assert.ok(ids.includes(id), id);
  assert.equal(slug('Volatility 100 (1s) Index'), 'V100s');
});

function sign(token, fields) {
  const check = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
}

test('Telegram initData validation', () => {
  const token = '123456:TEST';
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'q1', user: JSON.stringify({ id: 42, first_name: 'A' }) };
  const init = sign(token, fields);
  assert.equal(verifyInitData(init, token).id, 42);
  assert.equal(verifyInitData(init, 'other:token'), null);
  assert.equal(verifyInitData(init.replace('q1', 'q2'), token), null);
  assert.equal(verifyInitData(sign(token, { ...fields, auth_date: '1000' }), token), null);
});

test('store: alerts, users, recipients', () => {
  const st = new Store(':memory:');
  const a = { key: 'k1', ts: 1, symbol: 'V10', symbol_name: 'Volatility 10 Index', concept: 'K', kind: 'kl_valid', dir: 1, title: 't', body: 'b', payload: { x: 1 } };
  assert.ok(st.addAlert(a)); assert.equal(st.addAlert(a), null);                      // duplicates are ignored
  assert.deepEqual(st.recentAlerts({ symbol: 'V10' })[0].payload, { x: 1 });
  st.upsertUser(1, 'a'); st.upsertUser(2, 'b');
  st.updateSettings(2, { muted: ['V10'] });
  assert.deepEqual(st.recipients('V10', 'K'), [1]);
  st.updateSettings(1, { concepts: ['S'] });
  assert.deepEqual(st.recipients('V10', 'K'), []);
  st.updateSettings(1, { concepts: [], subscribed: false });
  assert.deepEqual(st.recipients('V25', 'K'), [2]);
  assert.equal(st.getUser(1).subscribed, false);
});

test('service: apply stores fresh alerts once', () => {
  const svc = new Service(new Store(':memory:'), P, quiet);
  const h4 = mk([[2, 6], [-1.5, 3], [2, 6], [-1.5, 3], [2.2, 8]], { start: 1000, step: 14400 });
  const h1 = mk([[0.5, 6], [-0.4, 3], [0.5, 6], [-0.4, 3], [0.5, 8]], { start: 1000 });
  const m5 = mk(Array.from({ length: 3 }, () => [[0.1, 6], [-0.08, 3], [0.1, 6], [-0.08, 3], [0.1, 8]]).flat(), { start: 1000, step: 300 });
  const sEv = evaluate(h4, h1, m5, P, 3).events.find((e) => e.concept === 'S');
  const now = sEv.t + 60;
  assert.ok(svc.apply('V10', h4, h1, m5, now).some((a) => a.concept === 'S'));
  assert.deepEqual(svc.apply('V10', h4, h1, m5, now), []);                             // same events are not sent twice
  assert.equal(svc.states.get('V10').s.trend, 1);
  assert.ok(svc.symbolView('V10').state.candles.h4.length);
  assert.equal(svc.symbolView('nope'), null);
  const ov = svc.overview();
  assert.equal(ov.length, 23); assert.equal(ov.find((o) => o.id === 'V10').trend, 1);
  assert.ok(formatAlert({ kind: 'reclamation', dir: 1, symbol_name: '<x>' }).includes('&lt;'));
  assert.ok(digitsFor(m5) >= 2);
});

test('telegram alert text is two lines: direction and type, then the symbol', () => {
  const sym = 'Volatility 25 Index';
  assert.equal(formatAlert({ kind: 'reclamation', dir: 1, concept: 'R', symbol_name: sym }), `🟢 <b>BULLISH · RECLAMATION</b>\n${sym}`);
  assert.equal(formatAlert({ kind: 'kl_valid', dir: -1, concept: 'K', symbol_name: sym }), `🔴 <b>BEARISH · KEY LEVEL</b>\n${sym}`);
  assert.equal(formatAlert({ kind: 'qml_entry', dir: 1, concept: 'QML', symbol_name: sym }), `🟢 <b>BULLISH · QML</b>\n${sym}`);
  assert.equal(formatAlert({ kind: 'bjeff_valid', dir: 1, concept: 'ADV', symbol_name: sym }), `🟢 <b>BULLISH · BJEFF ZONE</b>\n${sym}`);
  assert.equal(formatAlert({ kind: 'adv_entry', dir: -1, concept: 'ADV', symbol_name: sym }), `🔴 <b>BEARISH · 50% KEYLEVEL POI</b>\n${sym}`);
  assert.equal(formatAlert({ kind: 'kl_invalid', dir: 1, concept: 'K', symbol_name: sym }), `⚪ <b>INVALIDATED · KEY LEVEL</b>\n${sym}`);
});

test('chart screenshot: PNG is drawn, and the alert carries its chart data', async () => {
  const { renderChart } = await import('../server/chartimg.js');
  const { Bot } = await import('../server/telegram.js');
  const cs = Array.from({ length: 60 }, (_, i) => ({ t: 1000 + i * 3600, o: 100 + i * 0.1, h: 101 + i * 0.1, l: 99 + i * 0.1, c: 100.5 + i * 0.1 }));
  const png = renderChart({ candles: cs, tf: 3600, tfName: 'H1', t: cs[50].t + 3600, dir: -1, symbol: 'VOLATILITY 10 (1S) INDEX', label: 'BEARISH KEY LEVEL', digits: 2,
    box: { lo: 103, hi: 104, t0: cs[40].t, label: 'KEY LEVEL' }, lines: [{ y: 103, label: 'ENTRY', tone: 'entry' }] });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1000);
  assert.equal(renderChart({ candles: cs.slice(0, 3), tf: 3600, t: 0 }), null);          // too little data: no picture, text alert only
  const { chartSnap, alertLabel } = await import('../server/service.js');
  const snap = chartSnap({ kind: 'kl_valid', dir: -1, concept: 'K', symbol_name: 'Volatility 10 (1s) Index' },
    { tf: 3600, t: cs[50].t + 3600, extra: { lo: 103, hi: 104, t0: cs[40].t, entry: 103, sl: 104.5, tp: 100 } }, cs, 2);
  assert.equal(snap.label, 'BEARISH KEY LEVEL'); assert.equal(snap.tfName, 'H1'); assert.equal(snap.box.hi, 104); assert.equal(snap.lines.length, 3);
  assert.equal(alertLabel({ kind: 'kl_invalid', dir: 1, concept: 'K' }), 'INVALIDATED KEY LEVEL');
  assert.equal(renderChart(snap).subarray(1, 4).toString(), 'PNG');
  // Bot.sendPhoto: caption above the picture, keyboard as JSON
  const bot = new Bot('T'); let form;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => { form = { url, body: o.body }; return { json: async () => ({ ok: true, result: {} }) }; };
  try { await bot.sendPhoto(5, png, '🔴 <b>BEARISH · KEY LEVEL</b>\nV', { text: 'Open', url: 'https://t.me/b/app', plain: true, style: 'danger' }); }
  finally { globalThis.fetch = realFetch; }
  assert.ok(form.url.endsWith('/sendPhoto'));
  assert.equal(form.body.get('show_caption_above_media'), 'true');
  assert.equal(form.body.get('parse_mode'), 'HTML');
  assert.equal(JSON.parse(form.body.get('reply_markup')).inline_keyboard[0][0].style, 'danger');
  assert.equal(form.body.get('photo').type, 'image/png');
});

test('price alerts: store, limits, backup round trip', async () => {
  const { MAX_PRICE_ALERTS } = await import('../server/store.js');
  const st = new Store(':memory:');
  const a = st.paAdd(7, 'V10', 6500, 1, 1000);
  assert.deepEqual(st.paList(7, 'V10').map((x) => [x.price, x.side]), [[6500, 1]]);
  assert.deepEqual(st.paList(8, 'V10'), []);                                       // other people do not see it
  assert.equal(st.paUpdate(8, a.id, 1, 1), false);                                 // and cannot change or delete it
  assert.equal(st.paDelete(8, a.id), false);
  assert.equal(st.paUpdate(7, a.id, 6400, -1, 2000), true);
  assert.equal(st.paList(7)[0].created, 2000);
  const st2 = new Store(':memory:');
  assert.equal(st2.importPriceAlerts(JSON.parse(JSON.stringify(st.exportPriceAlerts()))), 1);
  assert.equal(st2.importPriceAlerts([{ id: 'x', tg_id: 'bad' }]), 0);
  assert.equal(st.paDelete(7, a.id), true);
  for (let i = 0; i < MAX_PRICE_ALERTS; i++) assert.ok(st.paAdd(9, 'V10', 100 + i, 1));
  assert.equal(st.paAdd(9, 'V10', 999, 1), null);                                  // limit per person
});

test('price alerts: hit when price reaches the level, also from a spike between polls', () => {
  const svc = new Service(new Store(':memory:'), P, quiet), M = 300;
  svc.states.set('V10', { price: 100, digits: 2 });
  svc.cache.get('V10')[M] = { cs: [{ t: 900, o: 100, h: 110, l: 99, c: 100 }, { t: 1200, o: 100, h: 101, l: 99, c: 100 }] };
  const up = { id: 'u', side: 1, price: 105, created: 1000 }, dn = { id: 'd', side: -1, price: 95, created: 1000 }, now = { id: 'n', side: 1, price: 100, created: 1000 };
  // the 900 candle (high 110) is from before the alert was set, so it is ignored; the 1200 candle never reached 105 or 95
  assert.deepEqual(svc.hitPriceAlerts('V10', [up, dn]).map((a) => a.id), []);
  assert.deepEqual(svc.hitPriceAlerts('V10', [now]).map((a) => a.id), ['n']);        // live price is at the level
  svc.cache.get('V10')[M].cs.push({ t: 1500, o: 100, h: 106, l: 100, c: 100 });       // a spike up between two polls
  assert.deepEqual(svc.hitPriceAlerts('V10', [up, dn]).map((a) => a.id), ['u']);
  svc.states.set('V10', { price: 94, digits: 2 });
  assert.deepEqual(svc.hitPriceAlerts('V10', [dn]).map((a) => a.id), ['d']);
  assert.deepEqual(svc.hitPriceAlerts('NOPE', [up]), []);
  assert.ok(svc.priceSnap('V10', 105).lines[0].y === 105);
});

test('price alerts: API creates, moves and removes, and the bot is messaged once', async () => {
  const sent = [];
  const cfg = { botToken: 'x', webappUrl: '', port: 0, dbPath: ':memory:', requireAuth: false, pollSeconds: 60, derivUrls: [], derivAppId: '1' };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: { symbolCodes: async () => ({}), close() {} }, background: false,
    bot: { send(c, t, b) { sent.push([c, t]); }, stop() {}, poll() {}, setMenuButton() { return Promise.resolve(); } }, log: quiet });
  const port = await app.start(0), base = `http://127.0.0.1:${port}`;
  const call = async (path, body) => { const r = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined); return [r.status, await r.json()]; };
  assert.equal((await call('/api/price-alerts', { symbol: 'V10', price: 105 }))[0], 400);          // no live price yet
  app.svc.states.set('V10', { price: 100, digits: 2 });
  app.svc.cache.get('V10')[300] = { cs: [{ t: 0, o: 100, h: 100, l: 100, c: 100 }] };
  const [c1, r1] = await call('/api/price-alerts', { symbol: 'V10', price: 105 });
  assert.equal(c1, 200); assert.equal(r1.alert.side, 1);
  assert.equal((await call('/api/price-alerts', { symbol: 'V10', price: 100 }))[0], 400);          // not at the current price
  const [, r2] = await call('/api/price-alerts/update', { id: r1.alert.id, price: 95 });
  assert.equal(r2.alert.side, -1);
  assert.equal((await call('/api/price-alerts?symbol=V10'))[1].alerts.length, 1);
  app.svc.states.set('V10', { price: 94, digits: 2 });                                              // price falls to the level
  await app.checkPriceAlerts('V10'); await app.checkPriceAlerts('V10');
  assert.equal(sent.length, 1); assert.match(sent[0][1], /PRICE ALERT[\s\S]*fell to <b>95\.00<\/b>/);       // one message, once
  assert.equal((await call('/api/price-alerts?symbol=V10'))[1].alerts.length, 0);                    // and the alert is gone
  await app.stop();
});
