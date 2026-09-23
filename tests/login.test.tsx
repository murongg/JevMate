// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import App from '../web/App';
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('offers GitHub login without exposing the legacy admin-token form in public mode', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      input === '/auth/status'
        ? Response.json({ mode: 'github', available: true })
        : Response.json({ error: 'unauthorized' }, { status: 401 }),
    ),
  );
  render(<App />);
  expect(
    (await screen.findByRole('link', { name: 'Continue with GitHub' })).getAttribute('href'),
  ).toBe('/auth/github');
  expect(screen.queryByLabelText('Admin token')).toBeNull();
});
it('restores a GitHub session and saves only the current user’s key using CSRF-protected requests', async () => {
  let hasKey = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/auth/status') return Response.json({ mode: 'github', available: true });
      if (input === '/api/session')
        return Response.json({
          user: { id: '101', login: 'synthetic-user' },
          csrf: 'synthetic-csrf',
          keyConfigured: hasKey,
          installUrl: 'https://github.com/apps/example/installations/new',
          dailyLimit: 200,
        });
      if (input === '/api/config')
        return Response.json({ repos: [], labels: ['bug'], model: 'jev-test' });
      if (input.startsWith('/api/issues?')) return Response.json({ items: [], page: 1 });
      if (input === '/api/jobs') return Response.json({ items: [] });
      if (input === '/api/connections')
        return Response.json({
          repositories: [],
          installUrl: 'https://github.com/apps/example/installations/new',
        });
      if (input === '/api/account/key') {
        hasKey = true;
        return Response.json({ ok: true, keyConfigured: true });
      }
      if (input === '/auth/logout') return Response.json({ ok: true });
      throw Error(input);
    }),
  );
  render(<App />);
  await screen.findByText('synthetic-user');
  fireEvent.click(screen.getByRole('button', { name: 'Account & Jev key' }));
  fireEvent.change(await screen.findByLabelText('Your Jev API key'), {
    target: { value: 'synthetic-private-key-for-test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/account/key',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'synthetic-csrf' }),
        body: JSON.stringify({ key: 'synthetic-private-key-for-test' }),
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Your Jev API key')).toHaveProperty('value', ''),
  );
  expect(localStorage.length).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('link', { name: 'Continue with GitHub' })).toBeTruthy();
  expect(screen.queryByText('synthetic-user')).toBeNull();
});
