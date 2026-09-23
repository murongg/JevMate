// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../web/App';
const token = 'synthetic-admin-token-that-is-long-enough';
const item = {
  id: 'a'.repeat(64),
  repo: 'example/repo',
  number: 1,
  title: 'Synthetic issue',
  body: '<script>alert(1)</script>',
  status: 'pending',
  chosen: null,
  created_at: '2026-01-01T00:00:00Z',
  decision: {
    category: { choice: 'bug', confidence: 0.8 },
    module: { choice: 'unknown', confidence: 0.2 },
    missing: ['reproduction'],
    labels: ['bug', 'needs-info'],
    model: 'jev-test',
    inputTokens: 100,
    completeness: { reproduction: 0.1, version: 0.8, expected: 0.9 },
  },
};
function mockApi() {
  return vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/config')
        return Response.json({
          repos: ['example/repo'],
          labels: ['bug', 'needs-info'],
          model: 'jev-test',
        });
      if (input.startsWith('/api/issues?')) return Response.json({ items: [item], page: 1 });
      if (input === '/api/jobs') return Response.json({ items: [] });
      if (input.endsWith('/apply')) return Response.json({ ok: true });
      throw Error(input);
    }),
  );
}
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('requires authentication, loads review data, and sends only selected labels', async () => {
  mockApi();
  render(<App />);
  expect(screen.queryByText('Synthetic issue')).toBeNull();
  fireEvent.change(screen.getByLabelText('Admin token'), { target: { value: token } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByRole('heading', { name: 'Synthetic issue' });
  expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'needs-info' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and add labels' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      `/api/issues/${item.id}/apply`,
      expect.objectContaining({ body: JSON.stringify({ labels: ['bug'] }) }),
    ),
  );
  expect(localStorage.length).toBe(0);
});
it('keeps authentication errors visible and allows retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ error: 'Enter the deployment admin token.' }, { status: 401 }),
    ),
  );
  render(<App />);
  fireEvent.change(screen.getByLabelText('Admin token'), { target: { value: token } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('Enter the deployment admin token.'),
  );
  expect(screen.getByRole('button', { name: 'Open workspace' }).hasAttribute('disabled')).toBe(
    false,
  );
});
it('has a working logout action that removes private issue content', async () => {
  mockApi();
  render(<App />);
  fireEvent.change(screen.getByLabelText('Admin token'), { target: { value: token } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByRole('heading', { name: 'Synthetic issue' });
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(screen.queryByText('Synthetic issue')).toBeNull();
  expect(screen.getByLabelText('Admin token')).toHaveProperty('value', '');
});
it.each(['Confirm and add labels', 'Skip suggestion'])(
  'returns to the list after %s instead of silently swapping mobile review context',
  async (action) => {
    let handled = false;
    const second = { ...item, id: 'b'.repeat(64), number: 2, title: 'Second synthetic issue' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/config')
          return Response.json({
            repos: ['example/repo'],
            labels: ['bug', 'needs-info'],
            model: 'jev-test',
          });
        if (input.startsWith('/api/issues?'))
          return Response.json({ items: handled ? [second] : [item, second], page: 1 });
        if (input === '/api/jobs') return Response.json({ items: [] });
        if (input.endsWith('/apply') || input.endsWith('/dismiss')) {
          handled = true;
          return Response.json({ ok: true });
        }
        throw Error(input);
      }),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText('Admin token'), { target: { value: token } });
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    await screen.findByRole('heading', { name: 'Synthetic issue' });
    fireEvent.click(screen.getByRole('button', { name: /#1.*Synthetic issue/ }));
    expect(screen.getByRole('region', { name: 'Issue review' }).className).toContain('show-detail');
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Issue review' }).className).not.toContain(
        'show-detail',
      ),
    );
  },
);

it('defaults to English even with a Chinese browser locale', () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
  render(<App />);
  expect(screen.getByRole('button', { name: 'Open workspace' })).toBeTruthy();
  expect(document.documentElement.lang).toBe('en');
  expect(document.title).toBe('JevMate · Issue workspace');
});
it('persists an explicit language choice and restores it after remount', () => {
  const { unmount } = render(<App />);
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'zh-CN' } });
  expect(screen.getByRole('button', { name: '进入工作台' })).toBeTruthy();
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(localStorage.getItem('jevmate.locale.v1')).toBe('zh-CN');
  unmount();
  render(<App />);
  expect(screen.getByLabelText('管理令牌')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('语言'), { target: { value: 'en' } });
  expect(screen.getByLabelText('Admin token')).toBeTruthy();
});
it('falls back to English for unknown preferences and works when storage is unavailable', () => {
  localStorage.setItem('jevmate.locale.v1', 'unsupported');
  const first = render(<App />);
  expect(screen.getByLabelText('Admin token')).toBeTruthy();
  first.unmount();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  render(<App />);
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'zh-CN' } });
  expect(screen.getByLabelText('管理令牌')).toBeTruthy();
});
it('switches workspace copy without resetting label selections or translating issue content', async () => {
  mockApi();
  render(<App />);
  fireEvent.change(screen.getByLabelText('Admin token'), { target: { value: token } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByRole('heading', { name: 'Synthetic issue' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'needs-info' }));
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'zh-CN' } });
  expect(screen.getByRole('heading', { name: 'Issue 收件箱' })).toBeTruthy();
  expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'needs-info' })).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('button', { name: '确认并添加标签' }));
  await screen.findByRole('status');
  expect(screen.getByRole('status').textContent).toContain('标签已添加');
  fireEvent.change(screen.getByLabelText('语言'), { target: { value: 'en' } });
  expect(screen.getByRole('status').textContent).toBe(
    'Labels added. Existing labels were preserved.',
  );
});
it('relocalizes an existing API error when the language changes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ error: 'Enter the deployment admin token.' }, { status: 401 }),
    ),
  );
  render(<App />);
  fireEvent.change(screen.getByLabelText('Admin token'), { target: { value: token } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'zh-CN' } });
  expect(screen.getByRole('alert').textContent).toBe('请输入此部署的管理令牌。');
});
it('keeps import controls out of the inbox until requested and closes them after queuing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input === '/api/config')
        return Response.json({
          repos: ['example/repo'],
          labels: ['bug', 'needs-info'],
          model: 'jev-test',
        });
      if (input.startsWith('/api/issues?')) return Response.json({ items: [item], page: 1 });
      if (input === '/api/jobs') return Response.json({ items: [] });
      if (input === '/api/scan') return Response.json({ queued: 1, page: 1 }, { status: 202 });
      throw Error(input);
    }),
  );
  render(<App />);
  fireEvent.change(screen.getByLabelText('Admin token'), { target: { value: token } });
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByRole('heading', { name: 'Synthetic issue' });
  expect(screen.queryByLabelText('GitHub page')).toBeNull();
  const toggle = screen.getByRole('button', { name: 'Import issues' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(screen.getByLabelText('GitHub page')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Import this page' }));
  await screen.findByRole('status');
  expect(screen.queryByLabelText('GitHub page')).toBeNull();
  expect(fetch).toHaveBeenCalledWith(
    '/api/scan',
    expect.objectContaining({ body: JSON.stringify({ repo: 'example/repo', page: 1 }) }),
  );
});
