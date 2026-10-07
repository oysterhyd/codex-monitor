const compactFormat = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 2,
});
export const compact = n => n == null ? '—' : compactFormat.format(n);
