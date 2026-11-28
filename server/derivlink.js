// "Log in with Deriv" link (TEST BUILD). Deriv's new OAuth 2.0 login with PKCE: the person signs in on Deriv's own page and is sent
// back to /link/callback. We never see their password. The login token is kept encrypted (AES-256-GCM), in memory only for now.
// The probe() call answers the open questions: what Deriv returns for the accounts, the live balance, and the MT5 account list.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const AUTH_URL = 'https://auth.deriv.com/oauth2/auth';
export const TOKEN_URL = 'https://auth.deriv.com/oauth2/token';
export const API_BASE = 'https://api.derivws.com';

export const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');
const keyBytes = (key) => createHash('sha256').update(String(key)).digest();

// blob = base64(iv 12 | auth tag 16 | ciphertext). A wrong key or a changed byte makes decryptToken throw.
export function encryptToken(plain, key) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decryptToken(blob, key) {
  const b = Buffer.from(String(blob), 'base64');
  if (b.length < 29) throw new Error('bad token blob');
  const d = createDecipheriv('aes-256-gcm', keyBytes(key), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

const SECRET_KEY = /token|otp|secret|password|authorization/i;
// Copy of a Deriv answer that is safe to show the person: secret-looking fields and wss:// addresses (they carry the one-time password) are hidden.
export function redact(v, depth = 0) {
  if (depth > 6) return '[deep]';
  if (typeof v === 'string') return /^wss?:\/\//i.test(v) ? '[hidden address]' : v.slice(0, 300);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) ? '[hidden]' : redact(x, depth + 1)]));
  return v;
}
const findWss = (v, depth = 0) => {
  if (typeof v === 'string') return /^wss:\/\//i.test(v) ? v : null;
  if (depth > 5 || !v || typeof v !== 'object') return null;
  for (const x of Object.values(v)) { const r = findWss(x, depth + 1); if (r) return r; }
  return null;
};

// One WebSocket conversation: send every payload, collect the answers by req_id, close. Never throws.
export function wsAsk(WS, url, payloads, ms = 15000) {
  return new Promise((resolve) => {
    const out = []; let ws = null, settled = false, t = null;
    const done = (err) => { if (settled) return; settled = true; clearTimeout(t); try { ws && ws.close(); } catch { /* closed */ } resolve({ replies: out, error: err || null }); };
    t = setTimeout(() => done('timeout'), ms);
    try { ws = new WS(url); } catch (e) { return done(e.message); }
    ws.onopen = () => payloads.forEach((p, i) => ws.send(JSON.stringify({ ...p, req_id: i + 1 })));
    ws.onmessage = (ev) => {
      let d; try { d = JSON.parse(String(ev.data)); } catch { return; }
      if (d && d.req_id >= 1 && d.req_id <= payloads.length) { out[d.req_id - 1] = d; if (payloads.every((_, i) => out[i])) done(); }
    };
    ws.onerror = () => done('connection error');
    ws.onclose = () => done(out.length ? null : 'closed');
  });
}

export class DerivLink {
  constructor({ clientId = '', redirect = '', key = '', scope = 'trade', now = () => Date.now(), fetchImpl = (...a) => fetch(...a), wsImpl = globalThis.WebSocket, stateTtlMs = 10 * 60 * 1000 } = {}) {
    Object.assign(this, { clientId, redirect, key, scope, now, fetchImpl, wsImpl, stateTtlMs });
    this.pending = new Map();      // state -> { tgId, verifier, exp }   one-time, 10 minutes
    this.links = new Map();        // Telegram id -> { enc, expiresAt, linkedAt }   token encrypted, memory only
    this.cache = new Map();        // Telegram id -> { at, report }
  }

  get enabled() { return !!(this.clientId && this.redirect && String(this.key).length >= 32); }

  #sweep() { const t = this.now(); for (const [s, p] of this.pending) if (p.exp <= t) this.pending.delete(s); }

  // Step 1: the address to send the person to. A new start replaces an older unused one of the same person.
  start(tgId) {
    this.#sweep();
    for (const [s, p] of this.pending) if (p.tgId === tgId) this.pending.delete(s);
    if (this.pending.size >= 5000) throw new Error('too many pending logins');
    const state = randomBytes(16).toString('hex'), verifier = randomBytes(48).toString('base64url');
    this.pending.set(state, { tgId, verifier, exp: this.now() + this.stateTtlMs });
    const q = new URLSearchParams({ response_type: 'code', client_id: this.clientId, redirect_uri: this.redirect, scope: this.scope,
      state, code_challenge: challengeOf(verifier), code_challenge_method: 'S256' });
    return { url: `${AUTH_URL}?${q}`, state };
  }

  // The state is single use: looked up once and removed, whether or not the rest of the callback turns out fine.
  #take(state) {
    if (typeof state !== 'string' || !/^[0-9a-f]{32}$/.test(state)) return null;
    const p = this.pending.get(state); this.pending.delete(state);
    return p && p.exp > this.now() ? p : null;
  }

  // Step 2: the callback. Returns { ok: true, tgId } or { ok: false, reason }. Never logs or returns the code or the token.
  async finish({ state, code, error } = {}) {
    const p = this.#take(state);
    if (!p) return { ok: false, reason: 'This login link is invalid, already used, or expired. Start again from the app.' };
    if (error) return { ok: false, reason: 'The login was cancelled or refused.' };
    if (typeof code !== 'string' || !code || code.length > 2000) return { ok: false, reason: 'Deriv did not send a login code.' };
    let r, data;
    try {
      r = await this.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: this.clientId, code, code_verifier: p.verifier, redirect_uri: this.redirect }) });
      data = await r.json();
    } catch (e) { return { ok: false, reason: 'Could not reach Deriv to finish the login. Try again.' }; }
    if (!r.ok || !data || typeof data.access_token !== 'string' || !data.access_token) {
      return { ok: false, reason: `Deriv refused the login (${r.status}${data && typeof data.error === 'string' ? ' ' + data.error.slice(0, 40) : ''}).` };
    }
    const secs = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
    this.links.set(p.tgId, { enc: encryptToken(data.access_token, this.key), expiresAt: this.now() + secs * 1000, linkedAt: this.now() });
    this.cache.delete(p.tgId);
    return { ok: true, tgId: p.tgId };
  }

  status(tgId) {
    const l = this.links.get(tgId);
    if (l && l.expiresAt <= this.now()) { this.links.delete(tgId); return { linked: false, expired: true }; }
    return l ? { linked: true, linkedAt: l.linkedAt, expiresAt: l.expiresAt } : { linked: false };
  }
  token(tgId) { return this.status(tgId).linked ? decryptToken(this.links.get(tgId).enc, this.key) : null; }
  unlink(tgId) { this.cache.delete(tgId); return this.links.delete(tgId); }

  async #call(path, tok, method = 'GET') {
    const r = await this.fetchImpl(API_BASE + path, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
    let body; const text = await r.text(); try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    return { status: r.status, body };
  }

  // The test: what does Deriv return? Cached for 10 seconds so a page refresh does not hammer Deriv.
  async report(tgId) {
    const st = this.status(tgId);
    if (!st.linked) return { linked: false, expired: !!st.expired };
    const hit = this.cache.get(tgId);
    if (hit && this.now() - hit.at < 10000) return hit.report;
    const report = { ...st, steps: [], accounts: [], balances: [], mt5: [] };
    const tok = this.token(tgId), step = (name, ok, extra = {}) => report.steps.push({ name, ok, ...extra });
    let list;
    try {
      const r = await this.#call('/trading/v1/options/accounts', tok);
      if (r.status === 401) { this.unlink(tgId); return { linked: false, expired: true }; }
      step('list accounts (REST)', r.status === 200, { status: r.status, body: r.status === 200 ? undefined : redact(r.body) });
      const arr = Array.isArray(r.body) ? r.body : (r.body && (r.body.data || r.body.accounts)) || [];
      list = Array.isArray(arr) ? arr : [];
      report.accounts = redact(list);
    } catch (e) { step('list accounts (REST)', false, { error: e.message }); list = []; }
    for (const a of list.slice(0, 4)) {
      const id = a && (a.account_id || a.accountId || a.id || a.loginid);
      if (!id) continue;
      const label = String(id);
      try {
        const o = await this.#call(`/trading/v1/options/accounts/${encodeURIComponent(label)}/otp`, tok, 'POST');
        const url = findWss(o.body);
        step(`one-time connection (${label})`, !!url, { status: o.status, body: url ? undefined : redact(o.body) });
        if (!url) continue;
        const w = await wsAsk(this.wsImpl, url, [{ balance: 1 }, { mt5_login_list: 1 }]);
        const [bal, mt5] = w.replies;
        report.balances.push(bal && bal.balance ? { account: label, ok: true, ...redact(bal.balance) } : { account: label, ok: false, error: (bal && bal.error && bal.error.message) || w.error || 'no answer' });
        if (mt5 && Array.isArray(mt5.mt5_login_list)) {
          report.mt5.push({ account: label, ok: true, list: mt5.mt5_login_list.map((m) => ({ ...redact(m), fields: Object.keys(m || {}) })) });
        } else report.mt5.push({ account: label, ok: false, error: (mt5 && mt5.error && `${mt5.error.code || ''} ${mt5.error.message || ''}`.trim()) || w.error || 'no answer' });
      } catch (e) { step(`one-time connection (${label})`, false, { error: e.message }); }
    }
    this.cache.set(tgId, { at: this.now(), report });
    return report;
  }
}
