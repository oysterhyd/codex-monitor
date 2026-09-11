import systemTranslations from "../electron/system-translations.json";
import translations from '../electron/translations.json';
let language = 'zh-CN';
// Constructing a DateTimeFormat costs roughly 30x formatting one value, and a single
// render formats hundreds, so keep one instance per language and option set.
// Rebuilt on every language change; the language is also part of the key so a stale
// instance can never format for the wrong locale.
const dateFormats = new Map();
export function setLanguage(value) {
  const next = value === 'en' ? 'en' : 'zh-CN';
  if (next !== language) dateFormats.clear();
  language = next;
  document.documentElement.lang = language;
}
export const dateLocale = () => language === 'en' ? 'en-US' : 'zh-CN';
export function dateFormat(key, options) {
  const cacheKey = language + '|' + key;
  let format = dateFormats.get(cacheKey);
  if (!format) {
    format = new Intl.DateTimeFormat(dateLocale(), options);
    dateFormats.set(cacheKey, format);
  }
  return format;
}
export function tr(message, ...values) {
  const text = language === 'en' ? translations[message] ?? message : message;
  return text.replace(/\{(\d+)\}/g, (_, i) => values[i] ?? `{${i}}`);
}

// Translate only application-owned metadata, never project names or file paths.
const systemKeys = Object.keys(systemTranslations).sort((a, b) => b.length - a.length);
export function systemText(message) {
  if (!message || language !== 'en') return message;
  if (systemTranslations[message]) return systemTranslations[message];
  // Main-process literals that are also application UI copy live in the shared
  // dictionary, so an exact match there translates them too. Substring substitution
  // below still handles status lines that embed a known phrase.
  if (translations[message]) return translations[message];
  let result = message;
  for (const key of systemKeys) result = result.split(key).join(systemTranslations[key]);
  return result.replace(/（HTTP (\d+)）/g, ' (HTTP $1)');
}
