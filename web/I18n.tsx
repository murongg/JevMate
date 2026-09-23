import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './locales/en';
import { zhCN, errors, dynamicErrors } from './locales/zh-CN';
export type Locale = 'en' | 'zh-CN';
export type Params = Record<string, string | number>;
export type Message = { key: MessageKey; params?: Params };
const storageKey = 'jevmate.locale.v1';
const catalogs = {
  en: {
    messages: en,
    errors: {} as Record<string, string>,
    dynamicErrors: [] as typeof dynamicErrors,
  },
  'zh-CN': { messages: zhCN, errors, dynamicErrors },
};
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === 'zh-CN' ? stored : 'en';
  } catch {
    return 'en';
  }
}
function translator(locale: Locale) {
  const catalog = catalogs[locale];
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
  const t = (key: MessageKey, params: Params = {}) =>
    catalog.messages[key].replace(/\{(\w+)\}/g, (token, name: string) => {
      const value = params[name];
      return value === undefined ? token : typeof value === 'number' ? number.format(value) : value;
    });
  return {
    t,
    number: (value: number) => number.format(value),
    percent: (value: number) => percent.format(value),
    list: (values: string[]) => list.format(values),
    label: (namespace: 'name' | 'status', value: string) => {
      const key = `${namespace}.${value}`;
      return Object.hasOwn(en, key) ? t(key as MessageKey) : value;
    },
    error: (message: string) => {
      if (Object.hasOwn(catalog.errors, message)) return catalog.errors[message];
      for (const [pattern, format] of catalog.dynamicErrors) {
        const match = message.match(pattern);
        if (match) return format(match[1]);
      }
      // Keep unknown server diagnostics intact rather than hiding useful recovery information.
      return message;
    },
  };
}
type I18n = ReturnType<typeof translator> & { locale: Locale; setLocale: (locale: Locale) => void };
const Context = createContext<I18n | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  const value = translator(locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = catalogs[locale].messages.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', catalogs[locale].messages.description);
  }, [locale]);
  function setLocale(next: Locale) {
    if (next !== 'en' && next !== 'zh-CN') return;
    updateLocale(next);
    // Preferences are optional; blocked browser storage must never prevent using the workspace.
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Session-only preference. */
    }
  }
  return <Context.Provider value={{ ...value, locale, setLocale }}>{children}</Context.Provider>;
}
export function useI18n() {
  const value = useContext(Context);
  if (!value) throw new Error('I18nProvider is required.');
  return value;
}
