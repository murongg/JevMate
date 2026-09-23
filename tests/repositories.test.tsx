// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../web/App';
const admin = 'synthetic-admin-token-that-is-long-enough';
const review = (repo: string, id: string, title: string) => ({
  id: id.repeat(64),
  repo,
  number: 1,
  title,
  body: 'Synthetic issue body',
  status: 'pending',
  chosen: null,
  created_at: '2026-01-01T00:00:00Z',
  decision: {
    category: { choice: 'bug', confidence: 0.8 },
    module: { choice: 'unknown', confidence: 0.2 },
    missing: [],
    labels: ['bug'],
    model: 'jev-test',
    inputTokens: 10,
    completeness: {},
  },
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it('opens one repository dashboard at a time and scopes imports to the selected repository', async () => {
  const alpha = review('sample/alpha', 'a', 'Synthetic alpha report');
  const beta = review('sample/beta', 'b', 'Synthetic beta report');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/auth/status') return Response.json({ mode: 'legacy', available: false });
      if (path === '/api/config')
        return Response.json({
          repos: ['sample/alpha', 'sample/beta'],
          labels: ['bug'],
          model: 'jev-test',
        });
      if (path.startsWith('/api/issues?')) {
        const repo = new URL(path, 'https://example.test').searchParams.get('repo');
        return Response.json({ items: repo === 'sample/beta' ? [beta] : [alpha], page: 1 });
      }
      if (path.startsWith('/api/jobs')) return Response.json({ items: [] });
      if (path === '/api/scan' && init?.method === 'POST')
        return Response.json({ queued: 1, page: 1 }, { status: 202 });
      throw Error(path);
    }),
  );
  render(<App />);
  fireEvent.change(await screen.findByLabelText('Admin token'), { target: { value: admin } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByRole('heading', { name: 'Repositories' });
  expect(screen.queryByRole('heading', { name: 'Issue inbox' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'sample/alpha' }));
  await screen.findByRole('heading', { name: 'Synthetic alpha report' });
  fireEvent.click(screen.getByRole('button', { name: 'All repositories' }));
  expect(screen.queryByRole('heading', { name: 'Issue inbox' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Search repositories'), {
    target: { value: 'BETA' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open sample/beta dashboard' }));
  await screen.findByRole('heading', { name: 'Synthetic beta report' });
  expect(screen.queryByText('Synthetic alpha report')).toBeNull();
  expect(fetch).toHaveBeenCalledWith('/api/issues?page=1&repo=sample%2Fbeta', expect.anything());
  expect(fetch).toHaveBeenCalledWith('/api/jobs?repo=sample%2Fbeta', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Import issues' }));
  expect(screen.getByText('sample/beta', { selector: '.import-repository' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Import this page' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/scan',
      expect.objectContaining({ body: JSON.stringify({ repo: 'sample/beta', page: 1 }) }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'All repositories' }));
  expect(screen.getByLabelText('Search repositories')).toHaveProperty('value', 'BETA');
});
it('searches a large available-repository list by name without rendering every row', async () => {
  const repositories = Array.from({ length: 80 }, (_, i) => ({
    id: String(i + 100),
    installationId: '1',
    name: `sample/repo-${String(i).padStart(2, '0')}`,
    connected: false,
  }));
  repositories.push({
    id: '999',
    installationId: '1',
    name: 'sample/needle-repo',
    connected: false,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/auth/status') return Response.json({ mode: 'github', available: true });
      if (path === '/api/session')
        return Response.json({
          user: { id: '101', login: 'synthetic-user' },
          csrf: 'synthetic-csrf',
          keyConfigured: false,
          installUrl: null,
          dailyLimit: 200,
        });
      if (path === '/api/config')
        return Response.json({ repos: [], labels: ['bug'], model: 'jev-test' });
      if (path.startsWith('/api/issues?')) return Response.json({ items: [], page: 1 });
      if (path.startsWith('/api/jobs')) return Response.json({ items: [] });
      if (path === '/api/connections') return Response.json({ repositories });
      throw Error(path);
    }),
  );
  render(<App />);
  await screen.findByRole('heading', { name: 'Repositories' });
  await screen.findByLabelText('Search repositories');
  expect(screen.getByText('sample/repo-00')).toBeTruthy();
  expect(screen.queryByText('sample/repo-31')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show more repositories' }));
  expect(screen.getByText('sample/repo-31')).toBeTruthy();
  expect(screen.queryByText('sample/needle-repo')).toBeNull();
  fireEvent.change(screen.getByLabelText('Search repositories'), {
    target: { value: 'NEEDLE' },
  });
  expect(await screen.findByText('sample/needle-repo')).toBeTruthy();
  expect(screen.queryByText('sample/repo-00')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add Jev key to open sample/needle-repo' }));
  const keyField = await screen.findByLabelText('Your Jev API key');
  await waitFor(() => expect(document.activeElement).toBe(keyField));
});
it('does not announce that access is empty while repositories are still loading', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/auth/status') return Response.json({ mode: 'github', available: true });
      if (path === '/api/session')
        return Response.json({
          user: { id: '101', login: 'synthetic-user' },
          csrf: 'synthetic-csrf',
          keyConfigured: false,
          installUrl: null,
          dailyLimit: 200,
        });
      if (path === '/api/config')
        return Response.json({ repos: [], labels: [], model: 'jev-test' });
      if (path === '/api/connections') return pending;
      throw Error(path);
    }),
  );
  render(<App />);
  await screen.findByRole('heading', { name: 'Repositories' });
  expect(screen.getByText('Loading repositories…')).toBeTruthy();
  expect(screen.queryByText(/No accessible repositories found/)).toBeNull();
  finish(Response.json({ repositories: [] }));
  expect(await screen.findByText(/No accessible repositories found/)).toBeTruthy();
});
it('opens the newly connected repository dashboard after account setup', async () => {
  let connected = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/auth/status') return Response.json({ mode: 'github', available: true });
      if (path === '/api/session')
        return Response.json({
          user: { id: '101', login: 'synthetic-user' },
          csrf: 'synthetic-csrf',
          keyConfigured: true,
          installUrl: null,
          dailyLimit: 200,
        });
      if (path === '/api/config')
        return Response.json({
          repos: connected ? ['sample/gamma'] : [],
          labels: ['bug'],
          model: 'jev-test',
        });
      if (path.startsWith('/api/issues?'))
        return Response.json({
          items: [review('sample/gamma', 'c', 'Synthetic gamma report')],
          page: 1,
        });
      if (path.startsWith('/api/jobs')) return Response.json({ items: [] });
      if (path === '/api/connections' && init?.method === 'POST') {
        connected = true;
        return Response.json({ ok: true });
      }
      if (path === '/api/connections')
        return Response.json({
          repositories: [{ id: '303', installationId: '1', name: 'sample/gamma', connected }],
        });
      if (path === '/api/connections/disconnect') throw Error('Unexpected disconnect');
      throw Error(path);
    }),
  );
  render(<App />);
  await screen.findByLabelText('Search repositories');
  fireEvent.change(screen.getByLabelText('Search repositories'), {
    target: { value: 'gamma' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect sample/gamma and open' }));
  expect(await screen.findByRole('heading', { name: 'Synthetic gamma report' })).toBeTruthy();
  expect(screen.getByText('sample/gamma', { selector: '.repository-current' })).toBeTruthy();
});
it('shows a repository load failure on the repository list', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/auth/status') return Response.json({ mode: 'legacy', available: false });
      if (path === '/api/config')
        return Response.json({ repos: ['sample/alpha'], labels: [], model: 'jev-test' });
      if (path.startsWith('/api/issues?'))
        return Response.json({ error: 'Synthetic repository load failed.' }, { status: 503 });
      if (path.startsWith('/api/jobs')) return Response.json({ items: [] });
      throw Error(path);
    }),
  );
  render(<App />);
  fireEvent.change(await screen.findByLabelText('Admin token'), { target: { value: admin } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open sample/alpha dashboard' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('Synthetic repository load failed.'),
  );
  expect(screen.queryByRole('heading', { name: 'Issue inbox' })).toBeNull();
});
it('explains how to add repositories in an empty legacy deployment', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/auth/status') return Response.json({ mode: 'legacy', available: false });
      if (path === '/api/config')
        return Response.json({ repos: [], labels: [], model: 'jev-test' });
      throw Error(path);
    }),
  );
  render(<App />);
  fireEvent.change(await screen.findByLabelText('Admin token'), { target: { value: admin } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  expect(
    await screen.findByText('Set ALLOWED_REPOS in your deployment configuration first.'),
  ).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Issue inbox' })).toBeNull();
});
it('shows a repository discovery error without claiming there are no authorized repositories', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/auth/status') return Response.json({ mode: 'github', available: true });
      if (path === '/api/session')
        return Response.json({
          user: { id: '101', login: 'synthetic-user' },
          csrf: 'synthetic-csrf',
          keyConfigured: true,
          installUrl: null,
          dailyLimit: 200,
        });
      if (path === '/api/config')
        return Response.json({ repos: [], labels: [], model: 'jev-test' });
      if (path === '/api/connections')
        return Response.json({ error: 'Synthetic discovery failed.' }, { status: 502 });
      throw Error(path);
    }),
  );
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('Synthetic discovery failed.'),
  );
  expect(screen.queryByText(/No accessible repositories found/)).toBeNull();
});
