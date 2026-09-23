# Localization

JevMate ships English (`en`) and Simplified Chinese (`zh-CN`). English is the initial default even when the browser prefers Chinese. A valid, explicitly saved preference takes precedence on later visits.

## Boundaries

- `web/locales/en.ts` defines the canonical message keys.
- `web/locales/zh-CN.ts` implements the same `MessageKey` contract and known server-error translations.
- `web/I18n.tsx` owns locale selection, interpolation, `Intl` number/percent/list formatting, document metadata and error fallback.
- `web/Language.tsx` provides the accessible native language selector.
- Components use `useI18n()`; they do not detect browser language or own translation dictionaries.

Only the locale preference is written to the versioned `jevmate.locale.v1` localStorage key. Authentication tokens are still kept in memory. Invalid preferences fall back to English. Storage access failures are caught so the interface can still switch languages for the current page.

Notifications keep message keys and parameters in state, rather than already-translated strings, so existing and asynchronously arriving notices follow the current locale. Error diagnostics are translated at render time. Known API errors use their existing English messages for compatibility; if backend wording changes, update the error catalog. Unknown diagnostics are shown unchanged instead of losing troubleshooting information.

Do not translate issue titles/bodies, repository identifiers, label values sent to GitHub, or custom policy keys. Known built-in categories and module names have display translations; custom values fall back to their original name. Model instructions and the HTTP API contract remain independent from UI language.

## Add a language

1. Add a catalog in `web/locales/` implementing `Record<MessageKey, string>`. Preserve named placeholders such as `{count}`.
2. Add its locale to `Locale`, the catalogs registry, preference validation, and the selector. Use the language's own name in the selector.
3. Add known error translations and any HTTP-status patterns relevant to that language.
4. Update the document metadata messages and verify `Intl` support for the locale. If adding an RTL language, explicitly implement and verify layout direction; the current two locales are LTR.
5. Run `npm run check` and check both mobile and desktop. Tests for language persistence, storage failure, switched notifications and unchanged GitHub label payloads live in `tests/app.test.tsx`.

Count phrases use neutral labels (for example, “Issues queued: {count}”) to avoid incorrect singular/plural concatenation. Add locale-appropriate plural selection if a new message requires it.
