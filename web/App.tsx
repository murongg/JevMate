import { useEffect, useState, type FormEvent } from 'react';
import { client, snapshot } from './api';
import Review from './Review';
import { I18nProvider, useI18n, type Message } from './I18n';
import Language from './Language';
import type { Call, Snapshot, UserSession } from './types';
import Account from './Account';
import Brand from './Brand';
import Bot from './Bot';
import Icon from './Icon';

export default function App() {
  return (
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  );
}
function Workspace() {
  const { t, label, error: localizeError } = useI18n();
  const [api, setApi] = useState<Call | null>(null),
    [data, setData] = useState<Snapshot | null>(null);
  const [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState<Message | null>(null);
  const [filter, setFilter] = useState('pending'),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState<string | null>(null);
  const [repo, setRepo] = useState(''),
    [scanPage, setScanPage] = useState(1),
    [mobileDetail, setMobileDetail] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [boot, setBoot] = useState<{
    mode: 'loading' | 'legacy' | 'github' | 'error';
    available: boolean;
  }>({ mode: 'loading', available: false });
  const [session, setSession] = useState<UserSession | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const status = await fetch('/auth/status', { credentials: 'same-origin' });
        if (!status.ok) throw new Error('Connection failed. Try again.');
        const settings = (await status.json()) as { mode: 'legacy' | 'github'; available: boolean };
        if (settings.mode === 'github' && settings.available) {
          const response = await fetch('/api/session', { credentials: 'same-origin' });
          if (response.ok) {
            const identity = (await response.json()) as UserSession;
            const call = client('', identity.csrf),
              next = await snapshot(call, 1);
            if (active) {
              setSession(identity);
              setApi(() => call);
              setData(next);
              setRepo(next.config.repos[0] || '');
              setAccountOpen(!identity.keyConfigured || !next.config.repos.length);
            }
          } else if (response.status !== 401) throw new Error('Connection failed. Try again.');
        }
        if (active) setBoot(settings);
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Connection failed. Try again.');
          setBoot({ mode: 'github', available: true });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  async function refreshAccount() {
    if (!api) return;
    setSession(await api<UserSession>('/api/session'));
    const next = await snapshot(api, 1);
    setData(next);
    setRepo(next.config.repos[0] || '');
  }
  async function logout() {
    setBusy(true);
    setError('');
    try {
      if (session && api) await api('/auth/logout', {});
      setApi(null);
      setData(null);
      setSession(null);
      setNotice(null);
      setSelected(null);
      setMobileDetail(false);
      setAccountOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function returnToList() {
    // Completing a review must not replace its action buttons with another issue below the fold.
    setMobileDetail(false);
    setSelected(null);
    requestAnimationFrame(() => document.getElementById('search')?.focus());
  }
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const call = client(token.trim());
      const next = await snapshot(call, 1);
      setApi(() => call);
      setData(next);
      setRepo(next.config.repos[0] || '');
      setToken('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function run(operation: (call: Call) => Promise<Message | void>, page = data?.page || 1) {
    if (!api) return;
    setBusy(true);
    setError('');
    setNotice(null);
    try {
      // Resolve notices at render time so a language switch during the request is respected.
      const message = await operation(api);
      if (message) setNotice(message);
      setData(await snapshot(api, page));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  if (!api || !data)
    return (
      <main className="login-page">
        <header className="login-header">
          <Brand />
          <div className="login-header-tools">
            <span className="console-label">{t('console')}</span>
            <Language />
          </div>
        </header>
        <div className="login-body">
          <section className="login-story">
            <div className="bot-stage">
              <span className="stage-corner tl" />
              <span className="stage-corner tr" />
              <Bot />
              <span className="stage-corner bl" />
              <span className="stage-corner br" />
              <span className="bot-caption">JEV / ISSUE TRIAGE</span>
            </div>
            <h1>
              {t('loginHeading')}
              <br />
              <span>{t('loginHeadingEnd')}</span>
            </h1>
            <p>{t('loginIntro')}</p>
            <div className="flow">
              <span>
                <Icon name="repo" />
                {t('flowInput')}
              </span>
              <Icon name="arrow" />
              <span>
                <Bot />
                {t('flowModel')}
              </span>
              <Icon name="arrow" />
              <span>
                <Icon name="check" />
                {t('flowReview')}
              </span>
            </div>
          </section>
          <section className="login-panel">
            <div className="panel-terminal">
              <span className="terminal-dot" />
              <span>jevmate / connect</span>
              <span className="terminal-version">v0.1</span>
            </div>
            <div className="login-panel-body">
              <div className="login-access-icon">
                <Icon name="repo" />
              </div>
              <h2>{t('loginAccess')}</h2>
              <p>{t(boot.mode === 'legacy' ? 'loginAccessHint' : 'githubLoginHint')}</p>
              {boot.mode === 'loading' ? (
                <p role="status">{t('loadingSession')}</p>
              ) : boot.mode === 'github' ? (
                <div className="github-login">
                  {error && (
                    <div role="alert" className="error">
                      {localizeError(error)}
                    </div>
                  )}
                  {boot.available ? (
                    <a className="primary" href="/auth/github">
                      <Icon name="repo" />
                      {t('githubLogin')}
                      <Icon name="arrow" />
                    </a>
                  ) : (
                    <p>{t('githubUnavailable')}</p>
                  )}
                </div>
              ) : (
                <form onSubmit={login}>
                  <label htmlFor="token">{t('adminToken')}</label>
                  <div className="token-input">
                    <span aria-hidden="true">&gt;</span>
                    <input
                      id="token"
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      required
                      minLength={32}
                      autoComplete="off"
                      placeholder={t('tokenPlaceholder')}
                    />
                  </div>
                  <small>{t('tokenHint')}</small>
                  {error && (
                    <div role="alert" className="error">
                      {localizeError(error)}
                    </div>
                  )}
                  <button className="primary" disabled={busy}>
                    {busy ? t('connecting') : t('openWorkspace')}
                    <Icon name="arrow" />
                  </button>
                </form>
              )}
            </div>
            <div className="login-panel-foot">
              <Icon name="check" />
              <span>{t('loginNote')}</span>
            </div>
          </section>
        </div>
        <footer>{t('loginFooter')}</footer>
      </main>
    );
  const visible = data.items.filter(
    (item) =>
      (filter === 'all' ||
        (filter === 'pending'
          ? ['pending', 'applying'].includes(item.status)
          : item.status === filter)) &&
      `${item.title} ${item.repo} #${item.number}`.toLowerCase().includes(query.toLowerCase()),
  );
  const current = visible.find((item) => item.id === selected) || visible[0];
  const count = data.items.filter((item) => ['pending', 'applying'].includes(item.status)).length;
  return (
    <div className="shell">
      <header className="commandbar">
        <Brand />
        <div className="workspace-context">
          <span className="context-divider" />
          <Icon name="repo" />
          <span>{session?.user.login || data.config.repos[0]?.split('/')[0] || 'JevMate'}</span>
          <span className="context-path">/ {t('workspaceLabel')}</span>
        </div>
        <div className="commandbar-tools">
          <span className="connection-mode">
            <span className="live-indicator" />
            {t('manualMode')}
          </span>
          <Language />
          {session && (
            <button aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
              {t('account')}
            </button>
          )}
          <button className="signout-button" disabled={busy} onClick={logout}>
            <Icon name="arrow" />
            {t('signOut')}
          </button>
        </div>
      </header>
      <main className="workspace">
        {session && api && accountOpen && (
          <Account
            call={api}
            session={session}
            onChanged={refreshAccount}
            onClose={() => setAccountOpen(false)}
          />
        )}
        <header className="workspace-header">
          <div>
            <h1>
              {t('inbox')}
              <span className="headline-count" aria-hidden="true">
                {data.items.length}
              </span>
            </h1>
            <p>{t('inboxIntro')}</p>
          </div>
          <div className="workspace-tools">
            <button className="refresh-button" disabled={busy} onClick={() => run(async () => {})}>
              <Icon name="refresh" className={busy ? 'spin' : ''} />
              {busy ? t('syncing') : t('refresh')}
            </button>
            <button
              className="import-toggle"
              aria-expanded={importOpen}
              aria-controls="import-panel"
              onClick={() => setImportOpen((open) => !open)}
            >
              <Icon name={importOpen ? 'close' : 'download'} />
              {t('importToggle')}
            </button>
          </div>
        </header>
        <div className="scopebar">
          {' '}
          <nav aria-label={t('viewScope')}>
            {[
              ['pending', t('pending')],
              ['all', t('allRecords')],
              ['applied', t('applied')],
              ['dismissed', t('dismissed')],
            ].map(([value, name]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setMobileDetail(false);
                }}
              >
                <Icon
                  name={
                    value === 'all'
                      ? 'all'
                      : value === 'pending'
                        ? 'pending'
                        : value === 'applied'
                          ? 'applied'
                          : 'dismissed'
                  }
                />
                <span className="nav-name">{name}</span>
                {value === 'pending' && <span className="nav-count">{count}</span>}
              </button>
            ))}
          </nav>
          <span className="model-badge">
            <Bot />
            {data.config.model}
          </span>
        </div>
        {importOpen && (
          <form
            id="import-panel"
            className="import-bar"
            onSubmit={(e) => {
              e.preventDefault();
              run(async (call) => {
                const res = await call<{ queued: number }>('/api/scan', { repo, page: scanPage });
                setImportOpen(false);
                return { key: 'queued', params: { count: res.queued } };
              });
            }}
          >
            <div>
              <label htmlFor="repo">{t('importIssues')}</label>
              <select
                id="repo"
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                  setScanPage(1);
                }}
                disabled={!data.config.repos.length}
              >
                {data.config.repos.length ? (
                  data.config.repos.map((r) => <option key={r}>{r}</option>)
                ) : (
                  <option value="">{t('noRepositories')}</option>
                )}
              </select>
            </div>
            <div className="page-input">
              <label htmlFor="scan-page">{t('githubPage')}</label>
              <input
                id="scan-page"
                type="number"
                min="1"
                max="1000"
                required
                value={scanPage}
                onChange={(e) => setScanPage(Number(e.target.value))}
              />
            </div>
            <button disabled={busy || !repo}>{t('importPage')}</button>
            <small>{t('importHint')}</small>
          </form>
        )}
        {error && (
          <div role="alert" className="error banner">
            {localizeError(error)}
          </div>
        )}
        {notice && (
          <div role="status" className="notice banner">
            {t(notice.key, notice.params)}
          </div>
        )}
        {data.jobs.length > 0 && (
          <details className="jobs">
            <summary>
              {t('jobsSummary', {
                failed: data.jobs.filter((j) => j.status === 'failed').length,
                total: data.jobs.length,
              })}
            </summary>
            <ul>
              {data.jobs.map((job) => (
                <li key={job.id}>
                  <div>
                    <strong>
                      {job.repo} #{job.number}
                    </strong>
                    <p>
                      {job.error
                        ? localizeError(job.error)
                        : t(job.status === 'processing' ? 'analyzing' : 'waiting')}
                    </p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async (call) => {
                        await call(`/api/jobs/${job.id}/retry`, {});
                        return { key: 'requeued' };
                      })
                    }
                  >
                    {t('requeue')}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <section
          className={`inbox ${mobileDetail ? 'show-detail' : ''}`}
          aria-label={t('issueReview')}
        >
          <div className="issue-index">
            <div className="list-tools">
              <label htmlFor="search" className="sr-only">
                {t('search')}
              </label>
              <div className="search-input">
                <Icon name="search" />
                <input
                  id="search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                />
              </div>
              <div className="list-meta">
                <span>{t('pageCount', { count: visible.length })}</span>
                <span>{t('pageNumber', { page: data.page })}</span>
              </div>
            </div>
            <ul className="issue-list">
              {visible.map((item) => (
                <li key={item.id}>
                  <button
                    className={current?.id === item.id ? 'selected' : ''}
                    aria-pressed={current?.id === item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setMobileDetail(true);
                    }}
                  >
                    <span className="issue-number">
                      <span className="issue-id">
                        <Icon name={item.status === 'applied' ? 'applied' : 'pending'} />#
                        {item.number}
                      </span>
                      <span>{label('status', item.status)}</span>
                    </span>
                    <strong>{item.title}</strong>
                    <span className="issue-repo">{item.repo}</span>
                    <span className="suggested">
                      {item.decision.labels.length
                        ? item.decision.labels.map((value) => (
                            <span className="tag" key={value}>
                              <Icon name="tag" />
                              {value}
                            </span>
                          ))
                        : t('manualJudgment')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {visible.length === 0 && (
              <p className="list-empty">{query ? t('noMatches') : t('noRecords')}</p>
            )}
            <div className="pagination">
              <button
                disabled={busy || data.page === 1}
                onClick={() => run(async () => {}, data.page - 1)}
              >
                <Icon name="previous" />
                {t('previous')}
              </button>
              <button
                disabled={busy || data.items.length < 50}
                onClick={() => run(async () => {}, data.page + 1)}
              >
                {t('next')}
                <Icon name="next" />
              </button>
            </div>
          </div>
          {current ? (
            <Review
              key={`${current.id}-${current.status}`}
              item={current}
              labels={data.config.labels}
              busy={busy}
              onBack={returnToList}
              onApply={(labels) =>
                run(async (call) => {
                  await call(`/api/issues/${current.id}/apply`, { labels });
                  returnToList();
                  return { key: 'labelsAdded' };
                })
              }
              onDismiss={() =>
                run(async (call) => {
                  await call(`/api/issues/${current.id}/dismiss`, {});
                  returnToList();
                  return { key: 'skipped' };
                })
              }
            />
          ) : (
            <div className="empty">
              <div className="empty-mark">
                <Bot />
              </div>
              <h2>{data.items.length ? t('pageComplete') : t('getStarted')}</h2>
              <p>{data.items.length ? t('historyHint') : t('startHint')}</p>
              {!data.config.repos.length && <p>{t(session ? 'connectHint' : 'configureRepos')}</p>}
            </div>
          )}
        </section>
        <footer className="workspace-foot">
          {t('manualMode')} <span>{data.config.model} · JevMate 0.1</span>
        </footer>
      </main>
    </div>
  );
}
