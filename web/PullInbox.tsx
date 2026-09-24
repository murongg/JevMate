import { useEffect, useState } from 'react';
import type { Call } from './types';
import { useI18n } from './I18n';
import Bot from './Bot';
import Icon from './Icon';

interface PullItem {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  headSha: string;
  analyzed: boolean;
  analysisId: string | null;
  status: string | null;
}
interface PullAnalysis {
  id: string;
  repo: string;
  number: number;
  headSha: string;
  title: string;
  body: string;
  files: { filename: string; status: string; additions: number; deletions: number }[];
  decision: {
    risk: { choice: 'low' | 'medium' | 'high'; confidence: number };
    tests: number;
    security: number;
    breaking: number;
    checks: string[];
    model: string;
    inputTokens: number;
  };
  status: 'pending' | 'publishing' | 'published' | 'stale';
  reviewBody: string | null;
  reviewId: string | null;
}

export default function PullInbox({ call, repo }: { call: Call; repo: string }) {
  const { t, percent, error: localizeError } = useI18n();
  const [items, setItems] = useState<PullItem[]>([]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<PullAnalysis | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = items.find((item) => item.number === selected) || items[0];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    call<{ items: PullItem[] }>(`/api/pulls?repo=${encodeURIComponent(repo)}&page=${page}`)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setSelected((previous) =>
          result.items.some((item) => item.number === previous)
            ? previous
            : result.items[0]?.number || null,
        );
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load PRs.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [call, repo, page]);

  useEffect(() => {
    let active = true;
    const id = current?.analysisId;
    if (!id) {
      setAnalysis(null);
      setMessage('');
      return;
    }
    // An on-demand result is already in state; refetching it could overwrite a draft being edited.
    if (analysis?.id === id) return;
    call<PullAnalysis>(`/api/pulls/${id}`)
      .then((result) => {
        if (!active) return;
        setAnalysis(result);
        setMessage(result.reviewBody || draftMessage(result));
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Unable to load assessment.');
      });
    return () => {
      active = false;
    };
  }, [call, current?.analysisId, current?.number]);

  function draftMessage(result: PullAnalysis) {
    const additions = result.files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = result.files.reduce((sum, file) => sum + file.deletions, 0);
    const checks = result.decision.checks.map(checkLabel);
    return [
      t('prDraftHeading', { number: result.number, title: result.title }),
      t('prDraftFiles', { count: result.files.length, additions, deletions }),
      t('prDraftRisk', { risk: riskLabel(result.decision.risk.choice) }),
      ...(checks.length ? [t('prDraftChecks', { checks: checks.join(', ') })] : []),
      '',
      t('prDraftNotes'),
    ].join('\n');
  }
  function riskLabel(value: 'low' | 'medium' | 'high') {
    return t(value === 'low' ? 'prRiskLow' : value === 'medium' ? 'prRiskMedium' : 'prRiskHigh');
  }
  function checkLabel(value: string) {
    if (value === 'tests') return t('prCheckTests');
    if (value === 'security') return t('prCheckSecurity');
    if (value === 'compatibility') return t('prCheckCompatibility');
    return value;
  }
  async function analyze() {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      const result = await call<PullAnalysis>(`/api/pulls/${current.number}/analyze`, { repo });
      setAnalysis(result);
      setMessage(result.reviewBody || draftMessage(result));
      setItems((previous) =>
        previous.map((item) =>
          item.number === current.number
            ? { ...item, analyzed: true, analysisId: result.id, status: result.status }
            : item,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to analyze PR.');
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!analysis || !message.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await call<{ reviewId: string }>(`/api/pulls/${analysis.id}/publish`, {
        body: message.trim(),
      });
      setAnalysis({
        ...analysis,
        status: 'published',
        reviewId: result.reviewId,
        reviewBody: message,
      });
      setItems((previous) =>
        previous.map((item) =>
          item.number === analysis.number ? { ...item, status: 'published' } : item,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to publish review.');
      try {
        const latest = await call<PullAnalysis>(`/api/pulls/${analysis.id}`);
        setAnalysis(latest);
        setItems((previous) =>
          previous.map((item) =>
            item.number === latest.number ? { ...item, status: latest.status } : item,
          ),
        );
      } catch {
        // Keep the draft visible when the status check itself is unavailable.
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pull-workspace" aria-label={t('prInbox')}>
      <header className="workspace-header">
        <div>
          <h1>{t('prInbox')}</h1>
          <p>{t('prInboxIntro')}</p>
        </div>
        <span className="model-badge">
          <Bot /> {t('prManualMode')}
        </span>
      </header>
      {error && (
        <div role="alert" className="error banner">
          {localizeError(error)}
        </div>
      )}
      <div className="pull-layout">
        <div className="pull-index">
          <div className="pull-index-header">
            <span>{t('prOpenCount', { count: items.length })}</span>
            <button disabled={loading || page === 1} onClick={() => setPage(page - 1)}>
              <Icon name="previous" /> {t('previous')}
            </button>
            <button disabled={loading || items.length < 25} onClick={() => setPage(page + 1)}>
              {t('next')} <Icon name="next" />
            </button>
          </div>
          {loading ? (
            <p className="pull-empty">{t('prLoading')}</p>
          ) : items.length ? (
            <ul className="pull-list">
              {items.map((item) => (
                <li key={item.number}>
                  <button
                    className={current?.number === item.number ? 'selected' : ''}
                    aria-pressed={current?.number === item.number}
                    disabled={busy}
                    onClick={() => {
                      setSelected(item.number);
                      setAnalysis(null);
                    }}
                  >
                    <span className="pull-list-meta">
                      #{item.number} ·{' '}
                      {item.draft
                        ? t('prDraft')
                        : item.status === 'published'
                          ? t('prPublishedShort')
                          : item.analyzed
                            ? t('prAnalyzed')
                            : t('prUnanalyzed')}
                    </span>
                    <strong>{item.title}</strong>
                    <span className="pull-head">{item.headSha.slice(0, 7)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pull-empty">{t('prNone')}</p>
          )}
        </div>
        <div className="pull-detail">
          {current ? (
            <>
              <div className="pull-detail-top">
                <span className="reference">
                  {repo} <span>#{current.number}</span>
                </span>
                <a
                  href={`https://github.com/${repo}/pull/${current.number}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('viewGithub')} <Icon name="external" />
                </a>
              </div>
              <h2>{current.title}</h2>
              <p className="pull-description">{current.body || t('prNoDescription')}</p>
              {analysis ? (
                <>
                  <div className="pull-summary">
                    <h3>{t('prChangeSummary')}</h3>
                    <ul>
                      {analysis.files.map((file) => (
                        <li key={file.filename}>
                          <code>{file.filename}</code>
                          <span>
                            {file.status} <b>+{file.additions}</b> / −{file.deletions}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="pull-assessment">
                    <div className="assessment-heading">
                      <Bot /> {t('prAssessment')} <span>{analysis.decision.model}</span>
                    </div>
                    <p>
                      <strong>{riskLabel(analysis.decision.risk.choice)}</strong> ·{' '}
                      {t('confidence', { value: percent(analysis.decision.risk.confidence) })}
                    </p>
                    <div className="pull-checks">
                      {analysis.decision.checks.length ? (
                        analysis.decision.checks.map((check) => (
                          <span key={check}>{checkLabel(check)}</span>
                        ))
                      ) : (
                        <span>{t('prNoFlags')}</span>
                      )}
                    </div>
                    <small>{t('prAssessmentCaveat')}</small>
                  </div>
                  <div className="pull-compose">
                    <label htmlFor="pull-review-body">{t('prReviewMessage')}</label>
                    <textarea
                      id="pull-review-body"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      maxLength={5000}
                      rows={9}
                      disabled={analysis.status !== 'pending' || busy}
                    />
                    {analysis.status === 'pending' ? (
                      <button
                        className="primary"
                        disabled={busy || !message.trim()}
                        onClick={publish}
                      >
                        <Icon name="check" /> {busy ? t('processing') : t('prPublish')}
                      </button>
                    ) : (
                      <p className="pull-state">
                        {t(
                          analysis.status === 'published'
                            ? 'prPublished'
                            : analysis.status === 'stale'
                              ? 'prStale'
                              : 'prUncertain',
                        )}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="pull-start">
                  <p>{t('prAnalyzeHint')}</p>
                  <button className="primary" disabled={busy} onClick={analyze}>
                    <Bot /> {busy ? t('analyzing') : t('prAnalyze')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="pull-empty">{t('prSelect')}</div>
          )}
        </div>
      </div>
    </section>
  );
}
