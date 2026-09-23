import { useState } from 'react';
import type { Call, UserSession } from './types';
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
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(false);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice(false);
    try {
      await action();
      await onChanged();
      setNotice(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operation failed. Try again.');
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
      <form
        className="account-key-form"
        onSubmit={(event) => {
          event.preventDefault();
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
          onChange={(event) => setKey(event.target.value)}
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
    </section>
  );
}
