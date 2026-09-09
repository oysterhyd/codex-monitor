// Lightweight, account-scoped desktop data. No dashboard/history payloads.
function widgetSnapshot(store, now = Date.now()) {
  const account = store.get('currentAccount') || 'unassigned';
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const rows = store.db.prepare('SELECT ts,input,cached,output FROM usage WHERE account=? AND ts>=? AND ts<=? ORDER BY ts')
    .all(account, new Date(Math.min(+yesterday, now - 86400000)).toISOString(), new Date(now).toISOString());
  let total = 0, previous = 0, input = 0, cached = 0, output = 0;
  const timeline = Array.from({ length: 96 }, (_, i) => ({ time: now - (95 - i) * 900000, total: 0 }));
  const speed = Array.from({ length: 20 }, (_, i) => ({ time: now - (19 - i) * 3000, total: 0 }));
  for (const row of rows) {
    const time = Date.parse(row.ts), tokens = row.input + row.output;
    if (time >= +today) { total += tokens; input += row.input; cached += row.cached; }
    else if (time >= +yesterday) previous += tokens;
    const bin = Math.ceil((time - (now - 86400000)) / 900000) - 1;
    if (bin >= 0 && bin < 96) timeline[bin].total += tokens;
    const speedBin = Math.ceil((time - (now - 60000)) / 3000) - 1;
    if (speedBin >= 0 && speedBin < 20) { output += row.output; speed[speedBin].total += row.output / 3; }
  }
  const quotas = store.db.prepare(`SELECT q.* FROM (SELECT DISTINCT bucket,slot FROM quotas WHERE account=?) b
    JOIN quotas q ON q.rowid=(SELECT rowid FROM quotas WHERE account=? AND bucket=b.bucket AND slot=b.slot ORDER BY ts DESC,rowid DESC LIMIT 1)`)
    .all(account, account);
  const buckets = [...new Set(quotas.map(q => q.bucket))].sort((a,b) => (a === 'codex' ? -1 : b === 'codex' ? 1 : a.localeCompare(b)));
  const bucket = buckets.find(b => quotas.some(q => q.bucket === b && q.minutes === 300)) || buckets[0];
  const quotaStatus = store.get('quotaStatus');
  return { account, bucket, total, previous, change: previous ? (total - previous) / previous : null,
    cacheRate: input ? cached / input : null, tps: output / 60, speed, timeline,
    quotas: quotas.filter(q => q.bucket === bucket), scan: store.get('scan'),
    quotaStatus: quotaStatus?.account === account ? quotaStatus : null,
    language: store.settings().language, sampledAt: new Date(now).toISOString() };
}
module.exports = { widgetSnapshot };
