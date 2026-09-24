// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PullInbox from '../web/PullInbox';
import App from '../web/App';
import { I18nProvider } from '../web/I18n';
import type { Call } from '../web/types';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it('opens a separate PR inbox inside a GitHub repository dashboard', async () => {
  const fetcher = vi.fn(async (path: string) => {
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
      return Response.json({ repos: ['sample/repo'], labels: [], model: 'jev-test' });
    if (path === '/api/connections')
      return Response.json({
        repositories: [
          { id: '1010', installationId: '1011', name: 'sample/repo', connected: true },
        ],
      });
    if (path.startsWith('/api/issues?')) return Response.json({ items: [], page: 1 });
    if (path.startsWith('/api/jobs?')) return Response.json({ items: [] });
    if (path.startsWith('/api/pulls?')) return Response.json({ items: [], page: 1 });
    throw Error('Unexpected request: ' + path);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  await screen.findByRole('heading', { name: 'Repositories' });
  fireEvent.click(await screen.findByRole('button', { name: 'sample/repo' }));
  expect(await screen.findByRole('heading', { name: 'Issue inbox' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Pull requests' }));
  expect(await screen.findByRole('heading', { name: 'PR inbox' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Issue inbox' })).toBeNull();
  expect(fetcher).toHaveBeenCalledWith('/api/pulls?repo=sample%2Frepo&page=1', expect.anything());
});

it('keeps PR review text editable and posts only after explicit confirmation', async () => {
  const calls: { path: string; body?: unknown }[] = [];
  let finishSavedRead: ((value: unknown) => void) | null = null;
  const assessment = {
    id: 'synthetic-analysis',
    repo: 'sample/repo',
    number: 7,
    headSha: 'a'.repeat(40),
    title: 'Synthetic improvement',
    body: 'Synthetic description',
    status: 'pending',
    reviewBody: null,
    reviewId: null,
    files: [{ filename: 'src/synthetic.ts', status: 'modified', additions: 2, deletions: 1 }],
    decision: {
      risk: { choice: 'medium', confidence: 0.7 },
      tests: 0.3,
      security: 0.8,
      breaking: 0.1,
      checks: ['tests', 'security'],
      model: 'jev-test',
      inputTokens: 120,
    },
  };
  const call = vi.fn(async (path: string, body?: unknown) => {
    calls.push({ path, body });
    if (path.startsWith('/api/pulls?'))
      return {
        page: 1,
        items: [
          {
            number: 7,
            title: 'Synthetic improvement',
            body: 'Synthetic description',
            draft: false,
            headSha: 'a'.repeat(40),
            analyzed: false,
            analysisId: null,
            status: null,
          },
        ],
      };
    if (path === '/api/pulls/7/analyze') return assessment;
    if (path === '/api/pulls/synthetic-analysis')
      return new Promise((resolve) => {
        finishSavedRead = resolve;
      });
    if (path === '/api/pulls/synthetic-analysis/publish') return { ok: true, reviewId: '777' };
    throw Error('Unexpected call: ' + path);
  }) as Call;
  render(
    <I18nProvider>
      <PullInbox call={call} repo="sample/repo" />
    </I18nProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'Synthetic improvement' })).toBeTruthy();
  expect(calls.some((entry) => entry.path.endsWith('/analyze'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Analyze with Jev' }));
  expect(await screen.findByText('Medium risk')).toBeTruthy();
  expect(screen.getByText('src/synthetic.ts')).toBeTruthy();
  const editor = screen.getByRole('textbox', { name: 'Review message' });
  fireEvent.change(editor, { target: { value: 'Checked the synthetic change.' } });
  if (finishSavedRead) await act(async () => finishSavedRead!(assessment));
  expect(editor).toHaveProperty('value', 'Checked the synthetic change.');
  expect(calls.some((entry) => entry.path.endsWith('/publish'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Publish comment review' }));
  await waitFor(() =>
    expect(calls).toContainEqual({
      path: '/api/pulls/synthetic-analysis/publish',
      body: { body: 'Checked the synthetic change.' },
    }),
  );
  expect(await screen.findByText('Review published on GitHub.')).toBeTruthy();
});

it('removes the publish action after the server reports a stale PR', async () => {
  let stale = false;
  const analysis = {
    id: 'synthetic-analysis',
    repo: 'sample/repo',
    number: 7,
    headSha: 'a'.repeat(40),
    title: 'Synthetic improvement',
    body: 'Synthetic description',
    files: [{ filename: 'src/synthetic.ts', status: 'modified', additions: 2, deletions: 1 }],
    decision: {
      risk: { choice: 'low', confidence: 0.8 },
      tests: 0.8,
      security: 0.1,
      breaking: 0.1,
      checks: [],
      model: 'jev-test',
      inputTokens: 20,
    },
    reviewBody: null,
    reviewId: null,
  };
  const call = (async (path: string) => {
    if (path.startsWith('/api/pulls?'))
      return {
        page: 1,
        items: [
          {
            number: 7,
            title: analysis.title,
            body: analysis.body,
            draft: false,
            headSha: analysis.headSha,
            analyzed: true,
            analysisId: analysis.id,
            status: 'pending',
          },
        ],
      };
    if (path === '/api/pulls/synthetic-analysis')
      return { ...analysis, status: stale ? 'stale' : 'pending' };
    if (path.endsWith('/publish')) {
      stale = true;
      throw Error('PR changed since analysis. Analyze the latest commit before publishing.');
    }
    throw Error(path);
  }) as Call;
  render(
    <I18nProvider>
      <PullInbox call={call} repo="sample/repo" />
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Publish comment review' }));
  expect(
    await screen.findByText('This PR changed. Analyze its latest commit before publishing.'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Publish comment review' })).toBeNull();
});
