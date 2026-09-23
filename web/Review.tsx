import { useState } from 'react';
import type { Review as Item } from './types';
import { useI18n } from './I18n';
export default function Review({
  item,
  labels,
  busy,
  onApply,
  onDismiss,
  onBack,
}: {
  item: Item;
  labels: string[];
  busy: boolean;
  onApply: (labels: string[]) => void;
  onDismiss: () => void;
  onBack: () => void;
}) {
  const { t, label, percent, list } = useI18n();
  const [selected, setSelected] = useState(item.chosen || item.decision.labels);
  const pending = item.status === 'pending',
    retry = item.status === 'applying';
  const editable = pending && !busy;
  const { category, module, missing, model, inputTokens } = item.decision;
  return (
    <article className="review" aria-label={t('issueDetails')}>
      <div className="review-heading">
        <button className="back" onClick={onBack}>
          {t('back')}
        </button>
        <span className={`status ${item.status}`}>{label('status', item.status)}</span>
        <a
          href={`https://github.com/${item.repo}/issues/${item.number}`}
          target="_blank"
          rel="noreferrer"
        >
          {t('viewGithub')}
        </a>
      </div>
      <p className="reference">
        {item.repo} <span>#{item.number}</span>
      </p>
      <h2>{item.title}</h2>
      <div className="judgments">
        <div>
          <span>{t('category')}</span>
          <strong>{label('name', category.choice)}</strong>
          <small>{t('confidence', { value: percent(category.confidence) })}</small>
        </div>
        <div>
          <span>{t('module')}</span>
          <strong>{label('name', module.choice)}</strong>
          <small>{t('confidence', { value: percent(module.confidence) })}</small>
        </div>
      </div>
      {missing.length > 0 && (
        <div className="missing">
          <strong>{t('missingInfo')}</strong>
          <p>{t('verifyMissing', { fields: list(missing.map((key) => label('name', key))) })}</p>
        </div>
      )}
      <section className="source">
        <h3>{t('originalIssue')}</h3>
        <pre>{item.body || t('noBody')}</pre>
      </section>
      <section className="decision">
        <h3>{pending ? t('confirmLabels') : retry ? t('retryOperation') : t('reviewHistory')}</h3>
        <p>
          {pending
            ? t('confirmHint')
            : retry
              ? t('retryHint')
              : item.status === 'stale'
                ? t('staleHint')
                : item.status === 'applied'
                  ? t('appliedHint')
                  : t('skippedHint')}
        </p>
        {pending || retry ? (
          <>
            <fieldset disabled={!editable}>
              <legend className="sr-only">{t('selectLabels')}</legend>
              <div className="labels">
                {labels.map((label) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={selected.includes(label)}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked ? [...old, label] : old.filter((x) => x !== label),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="actions">
              <button
                className="primary"
                disabled={busy || selected.length === 0}
                onClick={() => onApply(selected)}
              >
                {busy ? t('processing') : retry ? t('retryLabels') : t('confirmAction')}
              </button>
              {pending && (
                <button disabled={busy} onClick={onDismiss}>
                  {t('skipAction')}
                </button>
              )}
            </div>
          </>
        ) : item.chosen?.length ? (
          <p className="applied-labels">{item.chosen.join(' · ')}</p>
        ) : null}
      </section>
      <footer className="model-note">
        {model} · {t('inputTokens', { count: inputTokens })}
        <br />
        {t('confidenceHint')}
      </footer>
    </article>
  );
}
