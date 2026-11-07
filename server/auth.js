// Telegram Mini App initData validation.
import { createHmac, timingSafeEqual } from 'node:crypto';

// Returns the Telegram user object, or null if the data is missing, forged or too old.
export function verifyInitData(initData, token, maxAge = 86400) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const got = params.get('hash');
  if (!got) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = createHmac('sha256', secret).update(check).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (maxAge && Date.now() / 1000 - Number(params.get('auth_date') || 0) > maxAge) return null;
  try { return params.get('user') ? JSON.parse(params.get('user')) : null; } catch { return null; }
}
