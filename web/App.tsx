import { useState, type FormEvent } from 'react';
import { client, snapshot } from './api';
import Review from './Review';
import { I18nProvider, useI18n, type Message } from './I18n';
import Language from './Language';
import type { Call, Snapshot } from './types';

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M9 10v8a5 5 0 0 0 10 0v-8M19 18l4-5"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
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
          <div className="login-brand">
            <Mark />
            <span>JevMate</span>
          </div>
          <Language />
        </header>
        <section className="login-panel">
          <h1>
            {t('loginHeading')}
            <br />
            {t('loginHeadingEnd')}
          </h1>
          <p>{t('loginIntro')}</p>
          <form onSubmit={login}>
            <label htmlFor="token">{t('adminToken')}</label>
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
            <small>{t('tokenHint')}</small>
            {error && (
              <div role="alert" className="error">
                {localizeError(error)}
              </div>
            )}
            <button className="primary" disabled={busy}>
              {busy ? t('connecting') : t('openWorkspace')}
            </button>
          </form>
        </section>
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
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          <span>JevMate</span>
        </div>
        <p className="sidebar-description">{t('sidebarDescription')}</p>
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
              {name}
              {value === 'pending' && <span>{count}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="connection">{t('connected')}</span>
          <p>
            {t('judgment')}
            <br />
            {t('decision')}
          </p>
          <button
            disabled={busy}
            onClick={() => {
              setApi(null);
              setData(null);
              setError('');
              setNotice(null);
              setSelected(null);
            }}
          >
            {t('signOut')}
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <h1>{t('inbox')}</h1>
            <p>{t('inboxIntro')}</p>
          </div>
          <div className="workspace-tools">
            <Language />
            <button disabled={busy} onClick={() => run(async () => {})}>
              {busy ? t('syncing') : t('refresh')}
            </button>
          </div>
        </header>
        <form
          className="import-bar"
          onSubmit={(e) => {
            e.preventDefault();
            run(async (call) => {
              const res = await call<{ queued: number }>('/api/scan', { repo, page: scanPage });
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
              <input
                id="search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
              />
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
                      #{item.number}
                      <span>{label('status', item.status)}</span>
                    </span>
                    <strong>{item.title}</strong>
                    <span className="issue-repo">{item.repo}</span>
                    <span className="suggested">
                      {item.decision.labels.join(' · ') || t('manualJudgment')}
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
                {t('previous')}
              </button>
              <button
                disabled={busy || data.items.length < 50}
                onClick={() => run(async () => {}, data.page + 1)}
              >
                {t('next')}
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
                <Mark />
              </div>
              <h2>{data.items.length ? t('pageComplete') : t('getStarted')}</h2>
              <p>{data.items.length ? t('historyHint') : t('startHint')}</p>
              {!data.config.repos.length && <p>{t('configureRepos')}</p>}
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
