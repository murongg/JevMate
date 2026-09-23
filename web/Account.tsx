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
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { t, error: localizeError } = useI18n();
  const [key, setKey] = useState(''),
    [repos, setRepos] = useState<ConnectedRepository[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(false);
  useEffect(() => {
    let active = true;
    call<{ repositories: ConnectedRepository[] }>('/api/connections')
      .then((data) => {
        if (active) setRepos(data.repositories);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Operation failed. Try again.');
      });
    return () => {
      active = false;
    };
  }, [call]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice(false);
    try {
      await action();
      await onChanged();
      const data = await call<{ repositories: ConnectedRepository[] }>('/api/connections');
      setRepos(data.repositories);
      setNotice(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed. Try again.');
    } finally {
      setBusy(false);
    }
  }
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
          {!repos.length && <p>{t('noAvailableRepos')}</p>}
          <ul className="connections">
            {repos.map((repo) => (
              <li key={repo.id}>
                <span>
                  <Icon name="repo" />
                  {repo.name}
                </span>
                <button
                  disabled={busy || (!repo.connected && !session.keyConfigured)}
                  onClick={() =>
                    act(() =>
                      call(repo.connected ? '/api/connections/disconnect' : '/api/connections', {
                        repoId: repo.id,
                      }),
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
