import { useI18n } from './I18n';
export default function Signal({ value }: { value: number }) {
  const { t, percent } = useI18n();
  return (
    <div className="signal">
      <span className="signal-cells" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} className={i < Math.round(value * 12) ? 'lit' : ''} />
        ))}
      </span>
      <small>{t('confidence', { value: percent(value) })}</small>
    </div>
  );
}
