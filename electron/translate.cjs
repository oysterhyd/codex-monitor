const translations = require('./translations.json');
function translate(language, message, ...values) {
  const text = language === 'en' ? translations[message] ?? message : message;
  return text.replace(/\{(\d+)\}/g, (_, i) => values[i] ?? `{${i}}`);
}
module.exports = { translate };
