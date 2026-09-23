import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { useI18n } from './I18n';

export default function RepositoryPicker({
  repos,
  selected,
  disabled,
  onSelect,
}: {
  repos: string[];
  selected: string;
  disabled: boolean;
  onSelect: (repo: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const matches = repos.filter((repo) => repo.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="repository-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="repository-trigger"
        aria-label={`${t('selectRepo')}: ${selected || t('chooseRepo')}`}
        aria-expanded={open}
        aria-controls="repository-options"
        disabled={disabled || !repos.length}
        onClick={() => {
          setQuery('');
          setOpen((value) => !value);
        }}
      >
        <Icon name="repo" />
        <span>{selected || t('chooseRepo')}</span>
        <Icon name="next" />
      </button>
      {open && (
        <div
          id="repository-options"
          className="repository-options"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <label htmlFor="repository-search">{t('searchConnectedRepos')}</label>
          <input
            ref={search}
            id="repository-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchReposPlaceholder')}
          />
          {matches.length ? (
            <ul>
              {matches.map((repo) => (
                <li key={repo}>
                  <button
                    type="button"
                    aria-current={repo === selected ? 'page' : undefined}
                    onClick={() => {
                      setOpen(false);
                      trigger.current?.focus();
                      onSelect(repo);
                    }}
                  >
                    {repo}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('noRepoMatches')}</p>
          )}
        </div>
      )}
    </div>
  );
}
