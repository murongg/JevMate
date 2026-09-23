import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import worker from '../src/worker';
import type { Env } from '../src/schema';
import { seal, hash } from '../src/vault';
import { result, signature } from './fixtures';
let mf: Miniflare;
let env: Env;
const key = '11'.repeat(32),
  csrf = 'synthetic-csrf-value';
const sent: { id: string; kind?: string }[] = [];
let revoked = false,
  readOnly = false;
let writes: string[] = [];
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of ['0001.sql', '0002.sql'])
    await db.exec(
      (await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8')).replace(
        /\n/g,
        ' ',
      ),
    );
  env = {
    DB: db as unknown as D1Database,
    TASKS: {
      send: async (b: { id: string }) => {
        sent.push(b);
      },
      sendBatch: async (bs: { body: { id: string } }[]) => {
        sent.push(...bs.map((x) => x.body));
      },
    } as unknown as Env['TASKS'],
    ASSETS: { fetch: async () => new Response('app') } as unknown as Fetcher,
    ADMIN_TOKEN: 'legacy-token-that-is-long-enough-for-tests',
    WEBHOOK_SECRET: 'synthetic-secret',
    GITHUB_APP_ID: '123',
    GITHUB_INSTALLATION_ID: '999',
    GITHUB_PRIVATE_KEY: '',
    ALLOWED_REPOS: 'legacy/repo',
    TYPESAFE_API_KEY: 'legacy-key',
    JEV_MODEL: 'jev-test',
    AUTH_MODE: 'github',
    APP_URL: 'https://example.test',
    GITHUB_CLIENT_ID: 'synthetic-client',
    GITHUB_CLIENT_SECRET: 'synthetic-client-secret',
    GITHUB_APP_SLUG: 'synthetic-app',
    CREDENTIAL_KEY: key,
  };
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await env.DB.batch(
    [
      'sessions',
      'oauth_states',
      'connections',
      'account_jobs',
      'account_analyses',
      'account_events',
      'usage_limits',
      'accounts',
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  sent.length = 0;
  revoked = false;
  readOnly = false;
  writes = [];
  for (const id of ['101', '202']) {
    const creds = await seal(
      key,
      'github:' + id,
      JSON.stringify({
        accessToken: 'user-' + id,
        refreshToken: 'refresh-' + id,
        expiresAt: Date.now() + 3600000,
        refreshExpiresAt: Date.now() + 86400000,
      }),
    );
    await env.DB.prepare('INSERT INTO accounts(id,login,credentials,jev_key) VALUES(?,?,?,?)')
      .bind(id, 'user-' + id, creds, await seal(key, 'jev:' + id, 'key-' + id))
      .run();
    await env.DB.prepare('INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES(?,?,?,?)')
      .bind(await hash('session-' + id), id, csrf, Date.now() + 86400000)
      .run();
    await env.DB.prepare(
      'INSERT INTO connections(user_id,repo_id,installation_id,repo) VALUES(?,?,?,?)',
    )
      .bind(id, id + '0', id + '1', id === '101' ? 'alpha/repo' : 'beta/repo')
      .run();
    await env.DB.prepare(
      'INSERT INTO account_analyses(id,user_id,repo_id,repo,number,title,body,decision) VALUES(?,?,?,?,?,?,?,?)',
    )
      .bind(
        id.repeat(21) + '0',
        id,
        id + '0',
        id === '101' ? 'alpha/repo' : 'beta/repo',
        1,
        'Synthetic report',
        'Synthetic issue body',
        JSON.stringify({ labels: ['bug'], model: 'jev-test' }),
      )
      .run();
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input),
        token = new Headers(init?.headers).get('Authorization') || '';
      const id = token.includes('202') ? '202' : '101';
      if (url === 'https://github.com/login/oauth/access_token')
        return Response.json({
          access_token: 'user-101',
          refresh_token: 'refresh-101',
          expires_in: 28800,
          refresh_token_expires_in: 86400,
        });
      if (url === 'https://api.github.com/user')
        return Response.json({ id: 101, login: 'user-101' });
      if (url.includes('/user/installations/') && url.includes('/repositories'))
        return Response.json({
          repositories: revoked
            ? []
            : [
                {
                  id: Number(id + '0'),
                  full_name: id === '101' ? 'alpha/repo' : 'beta/repo',
                  permissions: { push: !readOnly },
                },
              ],
        });
      if (url.includes('/user/installations'))
        return Response.json({
          installations: [{ id: Number(id + '1'), app_id: 123, suspended_at: null }],
        });
      if (url.includes('/issues/1/labels') && init?.method === 'POST') {
        writes.push(token);
        return readOnly ? new Response('', { status: 403 }) : Response.json([]);
      }
      if (url.includes('/issues/1'))
        return Response.json({
          number: 1,
          title: 'Synthetic report',
          body: 'Synthetic issue body',
          state: 'open',
          labels: [],
        });
      if (url.includes('/labels?')) return Response.json([{ name: 'bug' }]);
      if (url.includes('/issues?')) return Response.json([{ number: 1 }]);
      if (url === 'https://api.typesafe.ai/v1/models') return Response.json({ models: [] });
      if (url === 'https://api.typesafe.ai/v1/systemone') return Response.json(result());
      throw Error('Unexpected mock request: ' + url);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
function api(path: string, id = '101', body?: unknown, extra: Record<string, string> = {}) {
  return worker.fetch(
    new Request('https://example.test' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Cookie: '__Host-jevmate_session=session-' + id,
        'X-CSRF-Token': csrf,
        Origin: 'https://example.test',
        'Content-Type': 'application/json',
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
}
it('requires a session in GitHub mode even if the legacy admin token is supplied', async () => {
  const r = await worker.fetch(
    new Request('https://example.test/api/issues', {
      headers: { Authorization: 'Bearer ' + env.ADMIN_TOKEN },
    }),
    env,
  );
  expect(r.status).toBe(401);
});
it('isolates records and refuses cross-user dismiss, apply and retry', async () => {
  const r = await api('/api/issues');
  expect(r.status).toBe(200);
  const body = (await r.json()) as { items: { repo: string }[] };
  expect(body.items.map((x) => x.repo)).toEqual(['alpha/repo']);
  const foreign = '202'.repeat(21) + '0';
  expect((await api(`/api/issues/${foreign}/dismiss`, '101', {})).status).toBe(404);
  expect((await api(`/api/issues/${foreign}/apply`, '101', { labels: ['bug'] })).status).toBe(404);
  await env.DB.prepare(
    'INSERT INTO account_jobs(id,user_id,repo_id,installation_id,repo,number) VALUES(?,?,?,?,?,?)',
  )
    .bind('foreign-job', '202', '2020', '2021', 'beta/repo', 1)
    .run();
  expect((await api('/api/jobs/foreign-job/retry', '101', {})).status).toBe(404);
  expect(sent).toHaveLength(0);
  expect(writes).toHaveLength(0);
});
it('rejects cross-origin or missing-CSRF mutations', async () => {
  expect(
    (await api('/api/scan', '101', { repo: 'alpha/repo' }, { Origin: 'https://attacker.test' }))
      .status,
  ).toBe(403);
  expect(
    (await api('/api/scan', '101', { repo: 'alpha/repo' }, { 'X-CSRF-Token': '' })).status,
  ).toBe(403);
});
it('stops returning retained snapshots immediately when GitHub access is lost', async () => {
  revoked = true;
  const r = await api('/api/issues');
  expect(r.status).toBe(200);
  expect(((await r.json()) as { items: unknown[] }).items).toEqual([]);
  expect((await api('/api/scan', '101', { repo: 'alpha/repo' })).status).toBe(403);
});
it('does not accept a repository identifier outside live GitHub discovery', async () => {
  expect((await api('/api/connections', '101', { repoId: '2020' })).status).toBe(403);
});
it('stores a user key encrypted and never returns it in account metadata', async () => {
  const r = await api('/api/account/key', '101', { key: 'synthetic-new-provider-key' });
  expect(r.status).toBe(200);
  const stored = await env.DB.prepare('SELECT jev_key FROM accounts WHERE id=?')
    .bind('101')
    .first<string>('jev_key');
  expect(stored).not.toContain('synthetic-new-provider-key');
  const data = await (await api('/api/session')).text();
  expect(data).not.toContain('synthetic-new-provider-key');
  expect(data).not.toContain('accessToken');
  expect(data).not.toContain('refreshToken');
});
it('starts PKCE OAuth and rejects callback state from a different browser', async () => {
  const r = await worker.fetch(
    new Request('https://example.test/auth/github', {
      headers: { 'CF-Connecting-IP': '192.0.2.1' },
    }),
    env,
  );
  expect(r.status).toBe(302);
  const target = new URL(r.headers.get('Location')!);
  expect(target.searchParams.get('code_challenge_method')).toBe('S256');
  expect(target.searchParams.get('code_challenge')).toBeTruthy();
  const callback = await worker.fetch(
    new Request(
      'https://example.test/auth/callback?code=test-code&state=' + target.searchParams.get('state'),
    ),
    env,
  );
  expect(callback.status).toBe(400);
});
it('consumes OAuth state once and sets an HttpOnly secure session', async () => {
  const r = await worker.fetch(new Request('https://example.test/auth/github'), env);
  const target = new URL(r.headers.get('Location')!);
  const cookie = r.headers.get('Set-Cookie')!.split(';')[0];
  const request = () =>
    new Request(
      'https://example.test/auth/callback?code=test-code&state=' + target.searchParams.get('state'),
      { headers: { Cookie: cookie } },
    );
  const done = await worker.fetch(request(), env);
  expect(done.status).toBe(302);
  expect(done.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect(done.headers.get('Set-Cookie')).toContain('Secure');
  expect(done.headers.get('Set-Cookie')).toContain('SameSite=Lax');
  expect((await worker.fetch(request(), env)).status).toBe(400);
});
it('removes sessions after a signed GitHub authorization revocation', async () => {
  const body = JSON.stringify({ action: 'revoked', sender: { id: 101 } });
  const r = await worker.fetch(
    new Request('https://example.test/webhooks/github', {
      method: 'POST',
      headers: {
        'X-GitHub-Event': 'github_app_authorization',
        'X-Hub-Signature-256': await signature(body),
      },
      body,
    }),
    env,
  );
  expect(r.status).toBe(200);
  expect((await api('/api/session')).status).toBe(401);
});
it('can disconnect an owned repository even when GitHub is unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  expect((await api('/api/connections/disconnect', '101', { repoId: '1010' })).status).toBe(200);
  expect(
    await env.DB.prepare('SELECT enabled FROM connections WHERE user_id=? AND repo_id=?')
      .bind('101', '1010')
      .first('enabled'),
  ).toBe(0);
});
it('does not erase a newer login if a concurrent token refresh loses its compare-and-swap', async () => {
  const expired = await seal(
    key,
    'github:101',
    JSON.stringify({
      accessToken: 'expired',
      refreshToken: 'refresh-101',
      expiresAt: 0,
      refreshExpiresAt: Date.now() + 86400000,
    }),
  );
  await env.DB.prepare('UPDATE accounts SET credentials=? WHERE id=?').bind(expired, '101').run();
  const original = fetch;
  const fresh = await seal(
    key,
    'github:101',
    JSON.stringify({
      accessToken: 'new-login-token',
      expiresAt: Date.now() + 3600000,
      refreshExpiresAt: 0,
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://github.com/login/oauth/access_token') {
        await env.DB.prepare(
          'UPDATE accounts SET credentials=?,credential_version=credential_version+1 WHERE id=?',
        )
          .bind(fresh, '101')
          .run();
        return Response.json({
          access_token: 'obsolete-refresh-token',
          refresh_token: 'refresh-101',
          expires_in: 28800,
          refresh_token_expires_in: 86400,
        });
      }
      return original(input, init);
    }),
  );
  await api('/api/config');
  expect(
    await env.DB.prepare('SELECT credentials FROM accounts WHERE id=?')
      .bind('101')
      .first('credentials'),
  ).toBe(fresh);
  expect((await api('/api/session')).status).toBe(200);
});
it('processes queued work with the owning user’s key and applies labels with their GitHub token', async () => {
  expect((await api('/api/scan', '101', { repo: 'alpha/repo' })).status).toBe(202);
  const job = sent.find((m) => m.kind === 'account')!;
  expect(job).toBeTruthy();
  const ack = vi.fn(),
    retry = vi.fn();
  await worker.queue(
    { messages: [{ body: job, ack, retry, attempts: 1 }] } as unknown as MessageBatch<{
      id: string;
      kind?: 'account';
    }>,
    env,
  );
  expect(ack).toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith(
    'https://api.typesafe.ai/v1/systemone',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer key-101' }),
    }),
  );
  const row = await env.DB.prepare("SELECT id FROM account_analyses WHERE user_id='101' AND id!=?")
    .bind('101'.repeat(21) + '0')
    .first<{ id: string }>();
  expect(row).toBeTruthy();
  expect((await api(`/api/issues/${row!.id}/apply`, '101', { labels: ['bug'] })).status).toBe(200);
  expect(writes).toEqual(['Bearer user-101']);
});
it('fans out signed events but stops a stale subscriber before reading or paying for analysis', async () => {
  await env.DB.prepare(
    'INSERT INTO connections(user_id,repo_id,installation_id,repo) VALUES(?,?,?,?)',
  )
    .bind('202', '1010', '1011', 'alpha/repo')
    .run();
  const body = JSON.stringify({
    action: 'opened',
    installation: { id: 1011 },
    repository: { id: 1010, full_name: 'alpha/repo' },
    issue: { number: 1 },
  });
  expect(
    (
      await worker.fetch(
        new Request('https://example.test/webhooks/github', {
          method: 'POST',
          headers: {
            'X-GitHub-Event': 'issues',
            'X-GitHub-Delivery': 'synthetic-event',
            'X-Hub-Signature-256': await signature(body),
          },
          body,
        }),
        env,
      )
    ).status,
  ).toBe(202);
  const run = async (message: { id: string; kind?: string }) => {
    const ack = vi.fn(),
      retry = vi.fn();
    await worker.queue(
      { messages: [{ body: message, ack, retry, attempts: 1 }] } as unknown as MessageBatch<{
        id: string;
        kind?: 'account' | 'event';
      }>,
      env,
    );
    return { ack, retry };
  };
  await run(sent[0]);
  const tasks = sent.filter((x) => x.kind === 'account');
  expect(tasks).toHaveLength(2);
  for (const task of tasks) await run(task);
  const failed = await env.DB.prepare(
    "SELECT status FROM account_jobs WHERE user_id='202' AND repo_id='1010'",
  ).first('status');
  expect(failed).toBe('failed');
  const modelCalls = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => url === 'https://api.typesafe.ai/v1/systemone');
  expect(modelCalls).toHaveLength(1);
  expect(new Headers(modelCalls[0][1]?.headers).get('Authorization')).toBe('Bearer key-101');
});
it('rejects expired state and removes only the signing-out browser session', async () => {
  const start = await worker.fetch(new Request('https://example.test/auth/github'), env);
  const target = new URL(start.headers.get('Location')!);
  await env.DB.prepare('UPDATE oauth_states SET expires_at=0').run();
  expect(
    (
      await worker.fetch(
        new Request(
          'https://example.test/auth/callback?code=test-code&state=' +
            target.searchParams.get('state'),
          { headers: { Cookie: start.headers.get('Set-Cookie')!.split(';')[0] } },
        ),
        env,
      )
    ).status,
  ).toBe(400);
  expect((await api('/auth/logout', '101', {})).status).toBe(200);
  expect((await api('/api/session', '101')).status).toBe(401);
  expect((await api('/api/session', '202')).status).toBe(200);
});
it('lets GitHub reject writes from read-only users without using an installation token', async () => {
  const { accountFingerprint } = await import('../src/triage');
  const id = await accountFingerprint('101', '1010', 1, 'Synthetic report', 'Synthetic issue body');
  await env.DB.prepare('UPDATE account_analyses SET id=? WHERE user_id=?').bind(id, '101').run();
  readOnly = true;
  expect((await api(`/api/issues/${id}/apply`, '101', { labels: ['bug'] })).status).toBe(502);
  expect(writes).toEqual(['Bearer user-101']);
  expect(
    await env.DB.prepare('SELECT status FROM account_analyses WHERE id=?').bind(id).first('status'),
  ).not.toBe('applied');
});
it('never falls back to the deployment key after a user removes their key', async () => {
  expect((await api('/api/account/key/remove', '101', {})).status).toBe(200);
  expect((await api('/api/connections', '101', { repoId: '1010' })).status).toBe(409);
  expect((await api('/api/session', '202')).status).toBe(200);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('api.typesafe.ai'))).toBe(
    false,
  );
});
it('does not invent an expiry for non-expiring GitHub tokens', async () => {
  const { exchange } = await import('../src/identity');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ access_token: 'synthetic-permanent' })),
  );
  const creds = await exchange(env, { code: 'synthetic-code' });
  expect(creds.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
});
it('shares a slow token refresh across concurrent workspace requests', async () => {
  const { accountToken } = await import('../src/identity');
  const expired = await seal(
    key,
    'github:101',
    JSON.stringify({
      accessToken: 'expired',
      refreshToken: 'refresh-101',
      expiresAt: 0,
      refreshExpiresAt: Date.now() + 86400000,
    }),
  );
  await env.DB.prepare('UPDATE accounts SET credentials=? WHERE id=?').bind(expired, '101').run();
  const refresh = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
    return Response.json({
      access_token: 'refreshed-101',
      refresh_token: 'next-refresh-101',
      expires_in: 28800,
      refresh_token_expires_in: 86400,
    });
  });
  vi.stubGlobal('fetch', refresh);
  const results = await Promise.allSettled([
    accountToken(env, '101'),
    accountToken(env, '101'),
    accountToken(env, '101'),
  ]);
  expect(results).toEqual(
    Array.from({ length: 3 }, () => ({ status: 'fulfilled', value: 'refreshed-101' })),
  );
  expect(refresh).toHaveBeenCalledTimes(1);
});
