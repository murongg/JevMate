import { useEffect, useState } from 'react';
import Icon from './Icon';
import { useI18n } from './I18n';
import type { Call, ConnectedRepository, UserSession } from './types';

export default function RepositoryDirectory({
  call,
  session,
  configured,
  query,
  onQueryChange,
  onOpen,
  onManageKey,
  onChanged,
}: {
  call: Call;
  session: UserSession | null;
  configured: string[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (repo: string) => Promise<void>;
  onManageKey: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t, error: localizeError } = useI18n();
  const [available, setAvailable] = useState<ConnectedRepository[]>([]);
  const [loading, setLoading] = useState(!!session);
  const [limit, setLimit] = useState(24);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    call<{ repositories: ConnectedRepository[] }>('/api/connections')
      .then((data) => {
        if (active) setAvailable(data.repositories);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Operation failed. Try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [call, userId]);
  const entries = session
    ? available
    : configured.map((name) => ({ id: name, installationId: '', name, connected: true }));
  const term = query.trim().toLowerCase();
  const matching = entries
    .filter((repo) => repo.name.toLowerCase().includes(term))
    .sort((a, b) => Number(b.connected) - Number(a.connected));
  const shown = matching.slice(0, limit);
  const connectedCount = entries.filter((repo) => repo.connected).length;
  async function refresh() {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const data = await call<{ repositories: ConnectedRepository[] }>('/api/connections');
      setAvailable(data.repositories);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operation failed. Try again.');
    } finally {
      setLoading(false);
    }
  }
  async function enter(repo: ConnectedRepository) {
    if (session && !repo.connected && !session.keyConfigured) {
      onManageKey();
      return;
    }
    setBusy(repo.id);
    setError('');
    try {
      if (session && !repo.connected) {
        await call('/api/connections', { repoId: repo.id });
        setAvailable((current) =>
          current.map((entry) => (entry.id === repo.id ? { ...entry, connected: true } : entry)),
        );
      }
      await onOpen(repo.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operation failed. Try again.');
    } finally {
      setBusy('');
    }
  }
  async function disconnect(repo: ConnectedRepository) {
    setBusy(repo.id);
    setError('');
    try {
      await call('/api/connections/disconnect', { repoId: repo.id });
      setAvailable((current) =>
        current.map((entry) => (entry.id === repo.id ? { ...entry, connected: false } : entry)),
      );
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operation failed. Try again.');
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="repository-directory" aria-label={t('repoDirectory')}>
      <header className="directory-header">
        <div>
          <span className="directory-eyebrow">{t('repoDirectoryEyebrow')}</span>
          <h1>{t('repoDirectory')}</h1>
          <p>{t('repoDirectoryIntro')}</p>
        </div>
        <div className="directory-header-actions">
          {session?.installUrl && (
            <a href={session.installUrl} target="_blank" rel="noreferrer">
              {t('installApp')} <Icon name="external" />
            </a>
          )}
          {session && (
            <button disabled={loading} onClick={refresh}>
              <Icon name="refresh" /> {t('refreshRepos')}
            </button>
          )}
        </div>
      </header>
      {session && !session.keyConfigured && (
        <div className="directory-setup">
          <span>{t('keyRequiredToConnect')}</span>
          <button onClick={onManageKey}>{t('setupKey')}</button>
        </div>
      )}
      <div className="directory-search">
        <label htmlFor="repository-directory-search">{t('searchRepositories')}</label>
        <div>
          <Icon name="search" />
          <input
            id="repository-directory-search"
            type="search"
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setLimit(24);
            }}
            placeholder={t('searchReposPlaceholder')}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {localizeError(error)}
        </p>
      )}
      {loading ? (
        <p role="status" className="directory-empty">
          {t('loadingRepos')}
        </p>
      ) : (
        <>
          <div className="directory-count">
            <span>
              {t('repoDirectoryCounts', { connected: connectedCount, total: entries.length })}
            </span>
            <span>
              {t('repoDirectoryShowing', { shown: shown.length, total: matching.length })}
            </span>
          </div>
          {matching.length ? (
            <ul className="directory-list">
              {shown.map((repo) => (
                <li key={repo.id}>
                  <span className="directory-repo-icon">
                    <Icon name="repo" />
                  </span>
                  <div className="directory-repo-name">
                    <button
                      className="directory-repo-link"
                      disabled={!!busy}
                      onClick={() => enter(repo)}
                    >
                      {repo.name}
                    </button>
                    <span>{t(repo.connected ? 'repoConnected' : 'repoAvailable')}</span>
                  </div>
                  <div className="directory-repo-actions">
                    <button
                      disabled={!!busy}
                      aria-label={t(
                        repo.connected
                          ? 'openRepoDashboardNamed'
                          : session?.keyConfigured
                            ? 'connectRepoNamed'
                            : 'setupRepoNamed',
                        { repo: repo.name },
                      )}
                      onClick={() => enter(repo)}
                    >
                      {t(
                        repo.connected
                          ? 'openRepoDashboard'
                          : session?.keyConfigured
                            ? 'connectAndOpen'
                            : 'setupKey',
                      )}
                      <Icon name="arrow" />
                    </button>
                    {session && repo.connected && (
                      <button
                        className="directory-disconnect"
                        disabled={!!busy}
                        aria-label={t('disconnectRepoNamed', { repo: repo.name })}
                        onClick={() => disconnect(repo)}
                      >
                        {t('disconnectRepo')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : !error ? (
            <p className="directory-empty">
              {term ? t('noRepoMatches') : t(session ? 'noAvailableRepos' : 'configureRepos')}
            </p>
          ) : null}
          {matching.length > shown.length && (
            <button className="directory-more" onClick={() => setLimit((current) => current + 24)}>
              {t('showMoreRepos')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
