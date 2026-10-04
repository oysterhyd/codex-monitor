// Dates are grouped in the user's local timezone, like the existing usage chart.
const dayKey = value => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const ordinal = key => Date.parse(key + 'T00:00:00Z') / 86400000;

function activitySummary(store, filter, priceRow, now = new Date()) {
  const candidate = Number(filter.activityYear);
  const year = Number.isInteger(candidate) && candidate >= 1970 && candidate <= now.getFullYear()
    ? candidate : now.getFullYear();
  const start = new Date(year, 0, 1).toISOString();
  const end = new Date(year + 1, 0, 1).toISOString();
  const dimensions = [], values = [];
  for (const [key, column] of [['account', 'u.account'], ['model', 'u.model'], ['session', 'u.session'], ['project', 's.project']]) {
    if (filter[key]) { dimensions.push(`${column}=?`); values.push(filter[key]); }
  }
  const join = 'FROM usage u LEFT JOIN sessions s ON s.id=u.session';
  const where = dimensions.length ? ' AND ' + dimensions.join(' AND ') : '';
  const first = store.sql(`SELECT MIN(u.ts) first ${join} WHERE 1=1${where}`).get(...values).first;
  const days = new Map(), sessions = new Set();
  const hours = Array.from({length: 24}, (_, hour) => ({hour, total: 0, requests: 0}));
  const today = dayKey(now);
  for (const row of store.sql(`SELECT u.* ${join} WHERE u.ts>=? AND u.ts<?${where} ORDER BY u.ts`).iterate(start, end, ...values)) {
    // One Date per row serves both derivations (ISO ts → local day key and hour).
    // 12,000-row synthetic activity snapshot: 33.487 → 30.674 ms, 11-round median
    // (scripts/simplification-benchmark.cjs, Node 22.22; includes shared pricing refactor).
    const timestamp = new Date(row.ts);
    const key = dayKey(timestamp);
    if (key > today) continue;
    if (!days.has(key)) days.set(key, {date: key, total: 0, output: 0, requests: 0, cost: 0, unpriced: 0, sessions: new Set()});
    const day = days.get(key), price = priceRow(row);
    day.total += row.input + row.output;
    day.output += row.output;
    day.requests++;
    if (price.cost == null) day.unpriced++;
    else day.cost += price.cost;
    day.sessions.add(row.session); sessions.add(row.session);
    const hour = hours[timestamp.getHours()];
    hour.total += row.input + row.output; hour.requests++;
  }
  const daily = [...days.values()].map(day => ({...day, sessions: day.sessions.size, cost: day.unpriced === day.requests ? null : day.cost}));
  const active = daily.filter(day => day.total > 0);
  let longestStreak = 0, streak = 0, previous = -Infinity;
  for (const day of active) {
    const index = ordinal(day.date);
    streak = index === previous + 1 ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak); previous = index;
  }
  let currentStreak = 0;
  if (year === now.getFullYear()) {
    const activeDays = new Set(active.map(day => ordinal(day.date)));
    let index = ordinal(today);
    if (!activeDays.has(index)) index--;
    while (activeDays.has(index)) { currentStreak++; index--; }
  }
  return {
    year, today, firstYear: first ? new Date(first).getFullYear() : now.getFullYear(),
    days: daily, hours,
    stats: {
      activeDays: active.length, longestStreak, currentStreak, sessions: sessions.size,
      total: daily.reduce((sum, day) => sum + day.total, 0),
      requests: daily.reduce((sum, day) => sum + day.requests, 0),
      peak: active.reduce((best, day) => !best || day.total > best.total ? day : best, null),
    },
  };
}

module.exports = {activitySummary, dayKey};
