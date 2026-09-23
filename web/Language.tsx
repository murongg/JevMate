import { useI18n, type Locale } from './I18n';
export default function Language() {
  const { t, locale, setLocale } = useI18n();
  return (
    <label className="language">
      <span className="sr-only">{t('language')}</span>
      <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        <option value="en" lang="en">
          English
        </option>
        <option value="zh-CN" lang="zh-CN">
          简体中文
        </option>
      </select>
    </label>
  );
}
