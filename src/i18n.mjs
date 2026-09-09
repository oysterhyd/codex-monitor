import systemTranslations from "../electron/system-translations.json";
import translations from '../electron/translations.json';
let language = 'zh-CN';
export function setLanguage(value) {
  language = value === 'en' ? 'en' : 'zh-CN';
  document.documentElement.lang = language;
}
export const dateLocale = () => language === 'en' ? 'en-US' : 'zh-CN';
export function tr(message, ...values) {
  const text = language === 'en' ? translations[message] ?? message : message;
  return text.replace(/\{(\d+)\}/g, (_, i) => values[i] ?? `{${i}}`);
}

// Translate only application-owned metadata, never project names or file paths.
const systemKeys = Object.keys(systemTranslations).sort((a, b) => b.length - a.length);
export function systemText(message) {
  if (!message || language !== 'en') return message;
  if (systemTranslations[message]) return systemTranslations[message];
  let result = message;
  for (const key of systemKeys) result = result.split(key).join(systemTranslations[key]);
  return result.replace(/（HTTP (\d+)）/g, ' (HTTP $1)');
}
