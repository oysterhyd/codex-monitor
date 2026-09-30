export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function calendarCells(year) {
  const first = new Date(year, 0, 1, 12), last = new Date(year, 11, 31, 12);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  last.setDate(last.getDate() + (7 - last.getDay()) % 7);
  const cells = [];
  for (const day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
    cells.push({date: localDay(day), month: day.getMonth(), inYear: day.getFullYear() === year});
  }
  return cells;
}

export function heatLevel(value, maximum) {
  if (!value || !maximum) return 0;
  // A square-root scale leaves small but real days visible next to a very busy day.
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / maximum) * 4)));
}
