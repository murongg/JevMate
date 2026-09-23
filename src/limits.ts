import { HttpError, type Env } from './schema';
export async function consumeLimit(env: Env, scope: string, limit: number, windowMs: number) {
  const period = Math.floor(Date.now() / windowMs),
    id = `${scope}:${period}`;
  const row = await env.DB.prepare(
    'INSERT INTO usage_limits(id,used,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET used=used+1 WHERE used<? RETURNING used',
  )
    .bind(id, (period + 1) * windowMs, limit)
    .first<{ used: number }>();
  if (!row) throw new HttpError(429, 'Usage limit reached. Please try again later.');
}
export function dailyLimit(env: Env) {
  const value = Number(env.DAILY_ANALYSIS_LIMIT || 200);
  return Number.isInteger(value) && value > 0 && value <= 10000 ? value : 200;
}
