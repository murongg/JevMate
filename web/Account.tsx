import { useEffect, useState } from 'react';
import type { Call, UserSession, ConnectedRepository } from './types';
import { useI18n } from './I18n';
import Icon from './Icon';
export default function Account({
  call,
  session,
  onChanged,
  onClose,
}: {
  call: Call;
  session: UserSession;
  onChanged: (preferredRepo?: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t, error: localizeError } = useI18n();
  const [key, setKey] = useState(''),
    [repos, setRepos] = useState<ConnectedRepository[]>([]),
    [repoQuery, setRepoQuery] = useState(''),
    [loadingRepos, setLoadingRepos] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(false);
  useEffect(() => {
    let active = true;
    setLoadingRepos(true);
    call<{ repositories: ConnectedRepository[] }>('/api/connections')
      .then((data) => {
        if (active) {
          setRepos(data.repositories);
          setLoadingRepos(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : 'Operation failed. Try again.');
          setLoadingRepos(false);
        }
      });
    return () => {
      active = false;
    };
  }, [call]);
  async function act(action: () => Promise<unknown>, preferredRepo?: string) {
    setBusy(true);
    setError('');
    setNotice(false);
    try {
      await action();
      await onChanged(preferredRepo);
      const data = await call<{ repositories: ConnectedRepository[] }>('/api/connections');
      setRepos(data.repositories);
      setNotice(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const term = repoQuery.trim().toLowerCase();
  const matchingRepos = term
    ? repos.filter((repo) => repo.name.toLowerCase().includes(term))
    : repos.filter((repo) => repo.connected);
  const shownRepos = matchingRepos.slice(0, 30);
  return (
    <section className="account-panel" aria-label={t('accountTitle')}>
      <header>
        <div>
          <h2>{t('accountTitle')}</h2>
          <p>@{session.user.login}</p>
        </div>
        <button aria-label={t('closeAccount')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {error && (
        <div role="alert" className="error">
          {localizeError(error)}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {t('accountReady')}
        </div>
      )}
      <div className="account-columns">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await call('/api/account/key', { key: key.trim() });
              setKey('');
            });
          }}
        >
          <label htmlFor="jev-key">{t('yourKey')}</label>
          <input
            id="jev-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('keyPlaceholder')}
            minLength={16}
            maxLength={512}
            required
          />
          <p>{t('keyHint')}</p>
          {session.keyConfigured && <p className="key-configured">{t('keySaved')}</p>}
          <div className="actions">
            <button className="primary" disabled={busy || !key.trim()}>
              {busy ? t('accountBusy') : t('saveKey')}
            </button>
            {session.keyConfigured && (
              <button
                type="button"
                disabled={busy}
                onClick={() => act(() => call('/api/account/key/remove', {}))}
              >
                {t('removeKey')}
              </button>
            )}
          </div>
          <small>{t('dailyLimit', { count: session.dailyLimit })}</small>
        </form>
        <section aria-label={t('reposTitle')}>
          <h3>{t('reposTitle')}</h3>
          <div className="repo-actions">
            {session.installUrl && (
              <a href={session.installUrl} target="_blank" rel="noreferrer">
                {t('installApp')}
                <Icon name="external" />
              </a>
            )}
            <button disabled={busy} onClick={() => act(async () => {})}>
              <Icon name="refresh" />
              {t('refreshRepos')}
            </button>
          </div>
          {!!repos.length && (
            <div className="available-repository-search">
              <label htmlFor="available-repositories">{t('searchAvailableRepos')}</label>
              <input
                id="available-repositories"
                type="search"
                value={repoQuery}
                onChange={(event) => setRepoQuery(event.target.value)}
                placeholder={t('searchReposPlaceholder')}
              />
              <small>
                {term
                  ? t('repoSearchResults', {
                      shown: shownRepos.length,
                      total: matchingRepos.length,
                    })
                  : t('repoSearchPrompt', { count: repos.length })}
              </small>
            </div>
          )}
          {loadingRepos && <p role="status">{t('loadingRepos')}</p>}
          {!loadingRepos && !repos.length && <p>{t('noAvailableRepos')}</p>}
          {!!term && !matchingRepos.length && <p>{t('noRepoMatches')}</p>}
          <ul className="connections">
            {shownRepos.map((repo) => (
              <li key={repo.id}>
                <span>
                  <Icon name="repo" />
                  {repo.name}
                </span>
                <button
                  disabled={busy || (!repo.connected && !session.keyConfigured)}
                  onClick={() =>
                    act(
                      () =>
                        call(repo.connected ? '/api/connections/disconnect' : '/api/connections', {
                          repoId: repo.id,
                        }),
                      repo.connected ? undefined : repo.name,
                    )
                  }
                >
                  {repo.connected ? t('disconnectRepo') : t('connectRepo')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
