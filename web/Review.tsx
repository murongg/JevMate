import { useState } from 'react';
import type { Review as Item } from './types';
import { useI18n } from './I18n';
import Icon from './Icon';
import Signal from './Signal';
import Bot from './Bot';
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
  const { t, label, list } = useI18n();
  const [selected, setSelected] = useState(item.chosen || item.decision.labels);
  const pending = item.status === 'pending',
    retry = item.status === 'applying';
  const editable = pending && !busy;
  const { category, module, missing, model, inputTokens } = item.decision;
  return (
    <article className="review" aria-label={t('issueDetails')}>
      <div className="review-heading">
        <button className="back" onClick={onBack}>
          <Icon name="previous" />
          {t('back')}
        </button>
        <span className={`status ${item.status}`}>
          <span className="status-dot" />
          {label('status', item.status)}
        </span>
        <a
          href={`https://github.com/${item.repo}/issues/${item.number}`}
          target="_blank"
          rel="noreferrer"
        >
          {t('viewGithub')}
          <Icon name="external" />
        </a>
      </div>
      <p className="reference">
        <Icon name="repo" />
        {item.repo} <span>#{item.number}</span>
      </p>
      <h2>{item.title}</h2>
      <div className="assessment-heading">
        <Bot />
        <span>{t('decisionLabel')}</span>
        <span className="assessment-model">{model}</span>
      </div>
      <div className="judgments">
        <div>
          <span>{t('category')}</span>
          <strong>{label('name', category.choice)}</strong>
          <Signal value={category.confidence} />
        </div>
        <div>
          <span>{t('module')}</span>
          <strong>{label('name', module.choice)}</strong>
          <Signal value={module.confidence} />
        </div>
      </div>
      {missing.length > 0 && (
        <div className="missing">
          <strong>
            <Icon name="pending" />
            {t('missingInfo')}
          </strong>
          <p>{t('verifyMissing', { fields: list(missing.map((key) => label('name', key))) })}</p>
        </div>
      )}
      <section className="source">
        <h3>
          <Icon name="repo" />
          {t('originalIssue')}
        </h3>
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
                    <span>{label}</span>
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
                <Icon name="check" />
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
        <span className="model-meta">
          {t('inputTokens', { count: inputTokens })}
          <span>{t('shortcutHint')}</span>
        </span>
        <br />
        {t('confidenceHint')}
      </footer>
    </article>
  );
}
