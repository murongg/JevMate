import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { generateKeyPair, exportPKCS8 } from 'jose';
import worker from '../src/worker';
import type { Env } from '../src/schema';
import { signature, result } from './fixtures';

let mf: Miniflare;
let env: Env;
const sent: { id: string }[] = [];
const admin = 'synthetic-admin-token-that-is-long-enough';
let issue: Record<string, unknown>;
let writes: string[][];
let jevFailure = false;
let githubFailure = false;
let enqueueFailure = false;
let modelCalls = 0;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of ['0001.sql', '0002.sql', '0003.sql'])
    await db.exec(
      (await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8')).replace(
        /\n/g,
        ' ',
      ),
    );
  const keys = await generateKeyPair('RS256', { extractable: true });
  env = {
    DB: db as unknown as D1Database,
    TASKS: {
      send: async (body: { id: string }) => {
        if (enqueueFailure) throw Error('queue down');
        sent.push(body);
      },
    } as unknown as Queue<{ id: string }>,
    ASSETS: { fetch: async () => new Response('app') } as unknown as Fetcher,
    ADMIN_TOKEN: admin,
    WEBHOOK_SECRET: 'synthetic-secret',
    GITHUB_APP_ID: '123',
    GITHUB_INSTALLATION_ID: '456',
    GITHUB_PRIVATE_KEY: await exportPKCS8(keys.privateKey),
    ALLOWED_REPOS: 'example/repo',
    TYPESAFE_API_KEY: 'synthetic-key',
    JEV_MODEL: 'jev-test',
  };
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  env.ALLOWED_REPOS = 'example/repo';
  await env.DB.batch([env.DB.prepare('DELETE FROM analyses'), env.DB.prepare('DELETE FROM jobs')]);
  sent.length = 0;
  writes = [];
  jevFailure = false;
  githubFailure = false;
  enqueueFailure = false;
  modelCalls = 0;
  issue = {
    number: 1,
    title: 'Synthetic crash report',
    body: 'The sample app fails.',
    state: 'open',
    labels: [{ name: 'help wanted' }],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/access_tokens'))
        return Response.json({ token: 'synthetic-installation-token' });
      if (url === 'https://api.typesafe.ai/v1/systemone') {
        modelCalls++;
        return jevFailure
          ? new Response('private error', { status: 429 })
          : Response.json(result());
      }
      if (url.endsWith('/issues/1/labels') && init?.method === 'POST') {
        if (githubFailure) return new Response('private error', { status: 503 });
        const labels = JSON.parse(String(init.body)).labels;
        writes.push(labels);
        return Response.json(labels.map((name: string) => ({ name })));
      }
      if (url.endsWith('/issues/1')) return Response.json(issue);
      if (url.includes('/labels?'))
        return Response.json(
          ['bug', 'enhancement', 'question', 'documentation', 'needs-info', 'help wanted'].map(
            (name) => ({ name }),
          ),
        );
      if (url.includes('/issues?'))
        return Response.json([issue, { number: 2, title: 'Synthetic PR', pull_request: {} }]);
      throw Error('Unexpected test URL: ' + url);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
function api(path: string, body?: unknown, token = admin) {
  return worker.fetch(
    new Request('https://example.test' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
}
async function webhook(id = 'delivery-1', repo = 'example/repo') {
  const body = JSON.stringify({
    action: 'opened',
    installation: { id: 456 },
    repository: { full_name: repo },
    issue: { number: 1 },
  });
  return worker.fetch(
    new Request('https://example.test/webhooks/github', {
      method: 'POST',
      headers: {
        'X-Hub-Signature-256': await signature(body),
        'X-GitHub-Delivery': id,
        'X-GitHub-Event': 'issues',
      },
      body,
    }),
    env,
  );
}
async function consume() {
  const ack = vi.fn(),
    retry = vi.fn();
  await worker.queue(
    { messages: [{ body: sent[0], ack, retry, attempts: 1 }] } as unknown as MessageBatch<{
      id: string;
    }>,
    env,
  );
  return { ack, retry };
}
async function analyze() {
  await webhook();
  await consume();
  return (await env.DB.prepare('SELECT * FROM analyses').first())!;
}

it('rejects unauthorized API and unsigned webhook requests', async () => {
  expect((await api('/api/issues', undefined, 'wrong')).status).toBe(401);
  const res = await worker.fetch(
    new Request('https://example.test/webhooks/github', { method: 'POST', body: '{}' }),
    env,
  );
  expect(res.status).toBe(401);
  expect(sent).toHaveLength(0);
});
it('only queues allowlisted repositories and configured installation', async () => {
  expect((await webhook('d', 'untrusted/repo')).status).toBe(403);
  expect(sent).toHaveLength(0);
  expect((await webhook()).status).toBe(202);
  expect(modelCalls).toBe(0);
});
it('acknowledges after enqueue, retries an interrupted enqueue on redelivery', async () => {
  enqueueFailure = true;
  expect((await webhook()).status).toBe(503);
  enqueueFailure = false;
  expect((await webhook()).status).toBe(202);
  expect(sent).toHaveLength(1);
});
it('deduplicates completed deliveries and stores a review without GitHub writes', async () => {
  const row = await analyze();
  expect(row.status).toBe('pending');
  expect(writes).toEqual([]);
  await consume();
  expect(modelCalls).toBe(1);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM analyses').first('n')).toBe(1);
});
it('surfaces model errors and asks the queue to retry without leaking upstream bodies', async () => {
  await webhook();
  jevFailure = true;
  const response = await consume();
  expect(response.retry).toHaveBeenCalled();
  expect(response.ack).not.toHaveBeenCalled();
  const job = await env.DB.prepare('SELECT * FROM jobs').first();
  expect(job?.status).toBe('failed');
  expect(job?.error).not.toContain('private error');
});
it('applies confirmed labels additively and makes repeated approval harmless', async () => {
  const row = await analyze();
  expect((await api(`/api/issues/${row.id}/apply`, { labels: ['bug'] })).status).toBe(200);
  expect((await api(`/api/issues/${row.id}/apply`, { labels: ['bug'] })).status).toBe(200);
  expect(writes).toEqual([['bug']]);
  expect(
    await env.DB.prepare('SELECT status FROM analyses WHERE id=?').bind(row.id).first('status'),
  ).toBe('applied');
});
it('rejects arbitrary labels and stale content before any GitHub mutation', async () => {
  const row = await analyze();
  expect((await api(`/api/issues/${row.id}/apply`, { labels: ['arbitrary'] })).status).toBe(400);
  issue.body = 'Edited after review';
  expect((await api(`/api/issues/${row.id}/apply`, { labels: ['bug'] })).status).toBe(409);
  expect(writes).toEqual([]);
});
it('keeps approved labels stable across an uncertain GitHub failure', async () => {
  const row = await analyze();
  githubFailure = true;
  expect((await api(`/api/issues/${row.id}/apply`, { labels: ['bug'] })).status).toBe(502);
  githubFailure = false;
  expect((await api(`/api/issues/${row.id}/apply`, { labels: ['enhancement'] })).status).toBe(409);
  expect((await api(`/api/issues/${row.id}/apply`, { labels: ['bug'] })).status).toBe(200);
});
it('imports one bounded page, skips PRs, rejects unapproved repositories', async () => {
  expect((await api('/api/scan', { repo: 'unknown/repo' })).status).toBe(403);
  const res = await api('/api/scan', { repo: 'example/repo', page: 1 });
  expect(res.status).toBe(202);
  expect(sent).toHaveLength(1);
});
it('lets a maintainer dismiss a suggestion, and does not apply it afterward', async () => {
  const row = await analyze();
  expect((await api(`/api/issues/${row.id}/dismiss`, {})).status).toBe(200);
  expect((await api(`/api/issues/${row.id}/apply`, { labels: ['bug'] })).status).toBe(409);
});
it('re-analyzes a stale snapshot when the same issue is reopened', async () => {
  const row = await analyze();
  issue.state = 'closed';
  expect((await api(`/api/issues/${row.id}/apply`, { labels: ['bug'] })).status).toBe(409);
  issue.state = 'open';
  await webhook('delivery-reopened');
  const message = { body: sent.at(-1), ack: vi.fn(), retry: vi.fn(), attempts: 1 };
  await worker.queue({ messages: [message] } as unknown as MessageBatch<{ id: string }>, env);
  expect(
    await env.DB.prepare('SELECT status FROM analyses WHERE id=?').bind(row.id).first('status'),
  ).toBe('pending');
});
it('filters removed repositories before pagination so allowed records remain reachable', async () => {
  const row = await analyze();
  await env.DB.batch(
    Array.from({ length: 50 }, (_, i) =>
      env.DB.prepare(
        'INSERT INTO analyses(id,repo,number,title,body,decision,created_at) VALUES(?,?,?,?,?,?,?)',
      ).bind(
        String(i).padStart(64, 'f'),
        'removed/repo',
        i + 1,
        'Synthetic archived report',
        '',
        row.decision,
        '2099-01-01T00:00:00Z',
      ),
    ),
  );
  const res = await api('/api/issues');
  const data = (await res.json()) as { items: { repo: string }[] };
  expect(data.items.map((item) => item.repo)).toEqual(['example/repo']);
});
it('paginates legacy dashboards within the requested allowlisted repository', async () => {
  env.ALLOWED_REPOS = 'example/repo,example/second';
  const row = await analyze();
  await env.DB.batch(
    Array.from({ length: 50 }, (_, i) =>
      env.DB.prepare(
        'INSERT INTO analyses(id,repo,number,title,body,decision,created_at) VALUES(?,?,?,?,?,?,?)',
      ).bind(
        String(i + 1).padStart(64, 'b'),
        'example/repo',
        i + 2,
        'Synthetic first-repo report',
        '',
        row.decision,
        '2099-01-01T00:00:00Z',
      ),
    ),
  );
  await env.DB.prepare(
    'INSERT INTO analyses(id,repo,number,title,body,decision,created_at) VALUES(?,?,?,?,?,?,?)',
  )
    .bind(
      'e'.repeat(64),
      'example/second',
      1,
      'Synthetic second-repo report',
      '',
      row.decision,
      '2020-01-01T00:00:00Z',
    )
    .run();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO jobs(id,repo,number) VALUES(?,?,?)').bind(
      'first-job',
      'example/repo',
      2,
    ),
    env.DB.prepare('INSERT INTO jobs(id,repo,number) VALUES(?,?,?)').bind(
      'second-job',
      'example/second',
      1,
    ),
  ]);
  const issues = await api('/api/issues?page=1&repo=example%2Fsecond');
  expect(((await issues.json()) as { items: { repo: string }[] }).items.map((x) => x.repo)).toEqual(
    ['example/second'],
  );
  const jobs = await api('/api/jobs?repo=example%2Fsecond');
  expect(((await jobs.json()) as { items: { id: string }[] }).items.map((x) => x.id)).toEqual([
    'second-job',
  ]);
  expect((await api('/api/issues?repo=unknown%2Frepo')).status).toBe(403);
  expect((await api('/api/config?repo=unknown%2Frepo')).status).toBe(200);
});
