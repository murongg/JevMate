import { z } from 'zod';
import { HttpError, type Env } from './schema';
import { hash, randomToken, seal, unseal } from './vault';
import { exchange, userRequest } from './identity';
import { consumeLimit } from './limits';
export interface Session {
  id: string;
  user_id: string;
  csrf: string;
  expires_at: number;
  login: string;
  jev_key: string | null;
}
function cookie(req: Request, name: string) {
  const matches = (req.headers.get('Cookie') || '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}
const sessionCookie = '__Host-jevmate_session',
  stateCookie = '__Host-jevmate_oauth';
function setCookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
function appOrigin(env: Env) {
  if (!env.APP_URL) throw new HttpError(503, 'Configure APP_URL before enabling GitHub login.');
  const url = new URL(env.APP_URL);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new HttpError(503, 'APP_URL must use HTTPS.');
  return url.origin;
}
export function loginReady(env: Env) {
  return !!(
    env.GITHUB_CLIENT_ID &&
    env.GITHUB_CLIENT_SECRET &&
    env.APP_URL &&
    /^[a-f0-9]{64}$/i.test(env.CREDENTIAL_KEY || '')
  );
}
export async function requireSession(req: Request, env: Env): Promise<Session> {
  const raw = cookie(req, sessionCookie);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(raw))
    throw new HttpError(401, 'Sign in with GitHub to continue.');
  const session = await env.DB.prepare(
    'SELECT s.*,a.login,a.jev_key FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.id=? AND s.expires_at>? AND a.credentials IS NOT NULL',
  )
    .bind(await hash(raw), Date.now())
    .first<Session>();
  if (!session) throw new HttpError(401, 'Sign in with GitHub to continue.');
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.get('Origin');
    if ((origin && origin !== appOrigin(env)) || req.headers.get('X-CSRF-Token') !== session.csrf)
      throw new HttpError(403, 'Invalid session request. Refresh the page and retry.');
  }
  return session;
}
export async function oauth(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/auth/status')
    return Response.json({
      mode: env.AUTH_MODE === 'github' ? 'github' : 'legacy',
      available: loginReady(env),
    });
  if (env.AUTH_MODE !== 'github') throw new HttpError(404, 'GitHub login is not enabled.');
  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const session = await requireSession(req, env);
    await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(session.id).run();
    return Response.json(
      { ok: true },
      { headers: { 'Set-Cookie': setCookie(sessionCookie, '', 0) } },
    );
  }
  if (!loginReady(env)) throw new HttpError(503, 'GitHub login is not configured yet.');
  const origin = appOrigin(env);
  if (req.method === 'GET' && url.pathname === '/auth/github') {
    await consumeLimit(
      env,
      'oauth:' +
        (await hash(env.CREDENTIAL_KEY + ':' + (req.headers.get('CF-Connecting-IP') || 'unknown'))),
      10,
      60000,
    );
    await env.DB.batch([
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(Date.now()),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),
      env.DB.prepare('DELETE FROM usage_limits WHERE expires_at<?').bind(Date.now()),
    ]);
    const state = randomToken(),
      verifier = randomToken(),
      id = await hash(state);
    await env.DB.prepare('INSERT INTO oauth_states(id,verifier,expires_at) VALUES(?,?,?)')
      .bind(id, await seal(env.CREDENTIAL_KEY!, 'oauth:' + id, verifier), Date.now() + 600000)
      .run();
    const target = new URL('https://github.com/login/oauth/authorize');
    target.search = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID!,
      redirect_uri: origin + '/auth/callback',
      state,
      code_challenge: await hash(verifier),
      code_challenge_method: 'S256',
    }).toString();
    return new Response(null, {
      status: 302,
      headers: { Location: target.toString(), 'Set-Cookie': setCookie(stateCookie, state, 600) },
    });
  }
  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state') || '',
      code = url.searchParams.get('code') || '';
    if (
      !state ||
      state.length > 128 ||
      !code ||
      code.length > 1024 ||
      cookie(req, stateCookie) !== state
    )
      throw new HttpError(400, 'Invalid OAuth state. Start sign-in again.');
    // Atomic deletion makes callbacks one-use, including concurrent replays from the same browser.
    const id = await hash(state),
      stored = await env.DB.prepare(
        'DELETE FROM oauth_states WHERE id=? AND expires_at>? RETURNING verifier',
      )
        .bind(id, Date.now())
        .first<{ verifier: string }>();
    if (!stored)
      throw new HttpError(400, 'OAuth state expired or was already used. Start sign-in again.');
    const creds = await exchange(env, {
      code,
      redirect_uri: origin + '/auth/callback',
      code_verifier: await unseal(env.CREDENTIAL_KEY!, 'oauth:' + id, stored.verifier),
    });
    const user = z
      .object({ id: z.number().int().positive(), login: z.string().min(1).max(100) })
      .parse(await userRequest(creds.accessToken, '/user'));
    const userId = String(user.id);
    await env.DB.prepare(
      'INSERT INTO accounts(id,login,credentials) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,credentials=excluded.credentials,credential_version=credential_version+1,refresh_lock=0',
    )
      .bind(
        userId,
        user.login,
        await seal(env.CREDENTIAL_KEY!, 'github:' + userId, JSON.stringify(creds)),
      )
      .run();
    const session = randomToken();
    await env.DB.prepare('INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES(?,?,?,?)')
      .bind(await hash(session), userId, randomToken(), Date.now() + 7 * 86400000)
      .run();
    const headers = new Headers({ Location: origin + '/' });
    headers.append('Set-Cookie', setCookie(sessionCookie, session, 7 * 86400));
    headers.append('Set-Cookie', setCookie(stateCookie, '', 0));
    return new Response(null, { status: 302, headers });
  }
  throw new HttpError(404, 'Endpoint not found.');
}
