import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DerivLink, encryptToken, decryptToken, challengeOf, redact, wsAsk } from '../server/derivlink.js';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';

const KEY = 'k'.repeat(40), quiet = { info() {}, warn() {}, error() {} };
const mk = (over = {}) => new DerivLink({ clientId: 'app123', redirect: 'https://x.test/link/callback', key: KEY, ...over });
const tokenReply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test('encryption: round trip, wrong key and changed bytes fail, blob is not plain text', () => {
  const blob = encryptToken('ory_at_secret', KEY);
  assert.equal(decryptToken(blob, KEY), 'ory_at_secret');
  assert.ok(!Buffer.from(blob, 'base64').toString('latin1').includes('ory_at_secret'));
  assert.notEqual(encryptToken('ory_at_secret', KEY), blob);                   // new random iv each time
  assert.throws(() => decryptToken(blob, 'z'.repeat(40)));
  const b = Buffer.from(blob, 'base64'); b[b.length - 1] ^= 1;
  assert.throws(() => decryptToken(b.toString('base64'), KEY));
  assert.throws(() => decryptToken('AAAA', KEY));
});

test('start: login address has PKCE, state, scope; challenge matches the stored verifier', () => {
  const l = mk(), { url, state } = l.start(7), q = new URL(url).searchParams;
  assert.equal(new URL(url).origin + new URL(url).pathname, 'https://auth.deriv.com/oauth2/auth');
  assert.deepEqual([q.get('response_type'), q.get('client_id'), q.get('scope'), q.get('code_challenge_method'), q.get('redirect_uri')], ['code', 'app123', 'trade', 'S256', 'https://x.test/link/callback']);
  assert.equal(q.get('state'), state);
  assert.match(state, /^[0-9a-f]{32}$/);
  assert.equal(q.get('code_challenge'), challengeOf(l.pending.get(state).verifier));
  assert.equal(challengeOf('dBjba0vZ'), createHash('sha256').update('dBjba0vZ').digest('base64url'));
});

test('callback: success stores an encrypted token, the state works only once', async () => {
  const l = mk({ fetchImpl: tokenReply(200, { access_token: 'ory_at_abc', expires_in: 3600, token_type: 'Bearer' }) });
  const { state } = l.start(7);
  const r = await l.finish({ state, code: 'CODE' });
  assert.deepEqual(r, { ok: true, tgId: 7 });
  assert.equal(l.token(7), 'ory_at_abc');
  assert.ok(!JSON.stringify([...l.links.values()]).includes('ory_at_abc'));      // never held as plain text
  assert.equal((await l.finish({ state, code: 'CODE' })).ok, false);             // replay
});

test('callback: the exchange sends the verifier and code to Deriv and the token never appears in a result', async () => {
  let sent;
  const l = mk({ fetchImpl: async (u, o) => { sent = { u, body: o.body }; return { ok: true, status: 200, json: async () => ({ access_token: 'SECRETTOK', expires_in: 60 }) }; } });
  const { state } = l.start(1), verifier = l.pending.get(state).verifier;
  const r = await l.finish({ state, code: 'AUTHCODE' });
  assert.equal(sent.u, 'https://auth.deriv.com/oauth2/token');
  assert.equal(sent.body.get('code_verifier'), verifier);
  assert.equal(sent.body.get('code'), 'AUTHCODE');
  assert.equal(sent.body.get('grant_type'), 'authorization_code');
  assert.ok(!JSON.stringify(r).includes('SECRETTOK'));
});

test('callback checks: bad, missing, unknown, expired or cancelled all refuse', async () => {
  let t = 1000; const l = mk({ now: () => t, fetchImpl: tokenReply(200, { access_token: 'x', expires_in: 60 }) });
  for (const state of [undefined, '', 'nope', 'g'.repeat(32), '0'.repeat(32), '../../etc']) assert.equal((await l.finish({ state, code: 'c' })).ok, false);
  let s = l.start(1).state;
  assert.equal((await l.finish({ state: s })).ok, false);                        // no code
  assert.equal(l.pending.has(s), false);                                         // and the state is spent anyway
  s = l.start(1).state;
  assert.equal((await l.finish({ state: s, error: 'access_denied', code: 'c' })).ok, false);
  s = l.start(1).state; t += 10 * 60 * 1000 + 1;                                 // 10 minutes pass
  assert.equal((await l.finish({ state: s, code: 'c' })).ok, false);
  assert.equal(l.links.size, 0);
});

test('callback: Deriv refusing the code means no link', async () => {
  const l = mk({ fetchImpl: tokenReply(400, { error: 'invalid_grant' }) });
  const r = await l.finish({ state: l.start(3).state, code: 'c' });
  assert.equal(r.ok, false); assert.match(r.reason, /400 invalid_grant/);
  assert.equal(l.status(3).linked, false);
  const l2 = mk({ fetchImpl: tokenReply(200, { nothing: 1 }) });
  assert.equal((await l2.finish({ state: l2.start(3).state, code: 'c' })).ok, false);
});

test('a new start replaces the older one; link expires; unlink removes it', async () => {
  let t = 0; const l = mk({ now: () => t, fetchImpl: tokenReply(200, { access_token: 'x', expires_in: 100 }) });
  const a = l.start(1).state, b = l.start(1).state;
  assert.equal(l.pending.has(a), false); assert.equal(l.pending.has(b), true);
  await l.finish({ state: b, code: 'c' });
  assert.equal(l.status(1).linked, true);
  t += 101_000; assert.deepEqual(l.status(1), { linked: false, expired: true }); assert.equal(l.token(1), null);
  await l.finish({ state: l.start(1).state, code: 'c' }); assert.equal(l.unlink(1), true); assert.equal(l.status(1).linked, false);
});

test('enabled needs the app id, the redirect and a long key', () => {
  assert.equal(mk().enabled, true);
  assert.equal(mk({ key: 'short' }).enabled, false);
  assert.equal(mk({ clientId: '' }).enabled, false);
  assert.equal(mk({ redirect: '' }).enabled, false);
});

test('redact hides secrets and one-time addresses', () => {
  const r = redact({ id: 'A1', balance: 5, access_token: 'abc', nested: { url: 'wss://x/y?otp=123', otp: 'z' }, list: [{ authorization: 'q' }] });
  assert.deepEqual(r, { id: 'A1', balance: 5, access_token: '[hidden]', nested: { url: '[hidden address]', otp: '[hidden]' }, list: [{ authorization: '[hidden]' }] });
});

test('report: accounts, live balance and MT5 list with fake Deriv (offline)', async () => {
  const calls = [];
  const fetchImpl = async (u, o = {}) => {
    calls.push(`${o.method || 'GET'} ${u}`);
    if (u.endsWith('/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: 3600 }) };
    if (u.endsWith('/options/accounts')) return { status: 200, text: async () => JSON.stringify({ data: [{ account_id: 'DOT1', account_type: 'demo', balance: 10000 }] }) };
    if (u.endsWith('/DOT1/otp')) return { status: 200, text: async () => JSON.stringify({ data: { url: 'wss://fake.test/ws?otp=ONETIME' } }) };
    throw new Error('unexpected ' + u);
  };
  class FakeWS {
    constructor(url) { assert.equal(url, 'wss://fake.test/ws?otp=ONETIME'); setTimeout(() => this.onopen(), 0); }
    send(m) { const p = JSON.parse(m); setTimeout(() => this.onmessage({ data: JSON.stringify(p.balance
      ? { req_id: p.req_id, balance: { balance: 10000, currency: 'USD', loginid: 'DOT1' } }
      : { req_id: p.req_id, mt5_login_list: [{ login: 'MTR1', balance: 250.5, currency: 'USD', account_type: 'real', market_type: 'financial' }] }) }), 0); }
    close() {}
  }
  const l = mk({ fetchImpl, wsImpl: FakeWS });
  await l.finish({ state: l.start(9).state, code: 'c' });
  const rep = await l.report(9);
  assert.equal(rep.linked, true);
  assert.deepEqual([rep.balances[0].ok, rep.balances[0].balance, rep.balances[0].currency], [true, 10000, 'USD']);
  assert.equal(rep.mt5[0].ok, true); assert.equal(rep.mt5[0].list[0].balance, 250.5); assert.ok(rep.mt5[0].list[0].fields.includes('market_type'));
  assert.ok(!JSON.stringify(rep).includes('ONETIME') && !JSON.stringify(rep).includes('"T"'));
  const n = calls.length; await l.report(9); assert.equal(calls.length, n);        // cached for 10 s
});

test('report: when Deriv has no MT5 call on this connection the error is shown, not hidden', async () => {
  const fetchImpl = async (u) => u.endsWith('/oauth2/token') ? { ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: 3600 }) }
    : u.endsWith('/options/accounts') ? { status: 200, text: async () => JSON.stringify([{ id: 'A' }]) }
    : { status: 200, text: async () => JSON.stringify({ url: 'wss://f/x' }) };
  class WS { constructor() { setTimeout(() => this.onopen(), 0); } send(m) { const p = JSON.parse(m); setTimeout(() => this.onmessage({ data: JSON.stringify(p.balance
    ? { req_id: p.req_id, balance: { balance: 1, currency: 'USD' } } : { req_id: p.req_id, error: { code: 'InvalidRequest', message: 'unknown call' } }) }), 0); } close() {} }
  const l = mk({ fetchImpl, wsImpl: WS });
  await l.finish({ state: l.start(2).state, code: 'c' });
  const rep = await l.report(2);
  assert.equal(rep.mt5[0].ok, false); assert.match(rep.mt5[0].error, /unknown call/);
});

test('report: a 401 from Deriv drops the link', async () => {
  const fetchImpl = async (u) => u.endsWith('/oauth2/token') ? { ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: 3600 }) } : { status: 401, text: async () => '{}' };
  const l = mk({ fetchImpl });
  await l.finish({ state: l.start(4).state, code: 'c' });
  assert.deepEqual(await l.report(4), { linked: false, expired: true });
  assert.equal(l.status(4).linked, false);
});

test('wsAsk: a connection that never answers ends with a timeout, never hangs', async () => {
  class Dead { constructor() {} close() {} }
  const r = await wsAsk(Dead, 'wss://x', [{ balance: 1 }], 50);
  assert.equal(r.error, 'timeout');
});

test('server: callback needs no Telegram login but refuses a bad state; API routes need login', async () => {
  const cfg = { botToken: '123456:TEST', webappUrl: '', port: 0, dbPath: ':memory:', requireAuth: true, pollSeconds: 60, derivUrls: [], derivAppId: '1' };
  const link = mk({ fetchImpl: tokenReply(200, { access_token: 'T', expires_in: 60 }) });
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: { close() {} }, link, bot: { send() {}, stop() {}, poll() {}, setMenuButton() { return Promise.resolve(); } }, log: quiet, background: false });
  const port = await app.start(0), base = `http://127.0.0.1:${port}`;
  try {
    const bad = await fetch(`${base}/link/callback?code=x&state=${'0'.repeat(32)}`);
    assert.equal(bad.status, 400); assert.match(await bad.text(), /invalid, already used, or expired/);
    const { state } = link.start(55);
    const ok = await fetch(`${base}/link/callback?code=x&state=${state}`);
    assert.equal(ok.status, 200); assert.equal(link.status(55).linked, true);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${base}/link/callback?code=x&state=${state}`)).status, 400);   // replay
    for (const p of ['/api/link/start', '/api/link/accounts']) assert.equal((await fetch(base + p)).status, 401);
    assert.equal((await fetch(`${base}/api/link/unlink`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/static/link-test.html`)).status, 200);
  } finally { await app.stop(); }
});

test('server: linking off when not configured', async () => {
  const cfg = { botToken: '', webappUrl: '', port: 0, dbPath: ':memory:', requireAuth: false, pollSeconds: 60, derivUrls: [], derivAppId: '1' };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: { close() {} }, log: quiet, background: false });
  const port = await app.start(0), base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/api/link/start`)).status, 503);
    assert.deepEqual(await (await fetch(`${base}/api/link/accounts`)).json(), { enabled: false });
    assert.equal((await fetch(`${base}/link/callback?code=x&state=y`)).status, 503);
  } finally { await app.stop(); }
});
