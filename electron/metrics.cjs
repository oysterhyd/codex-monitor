function costOf(row, prices) {
  const p = prices.find(
    (p) => !p.retired && p.model === row.model && p.effective <= row.ts,
  );
  if (!p) return { cost: null, inputCost: null, outputCost: null, saved: null, priceId: null };
  const plain = Math.max(0, row.input - row.cached - row.cache_write);
  return {
    inputCost: (plain * p.input + row.cached * p.cached + row.cache_write * p.cache_write) / 1e6,
    outputCost: row.output * p.output / 1e6,
    cost:
      (plain * p.input +
        row.cached * p.cached +
        row.cache_write * p.cache_write +
        row.output * p.output) /
      1e6,
    saved: (row.cached * (p.input - p.cached)) / 1e6,
    priceId: p.id,
  };
}
function bounds(filter = {}, now = new Date()) {
  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (filter.range === "7d") start.setDate(start.getDate() - 6);
  if (filter.range === "30d") start.setDate(start.getDate() - 29);
  if (filter.range === "all") start = new Date(0);
  if (filter.range === "custom") {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(filter.start || "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(filter.end || "")
    )
      throw new Error("请选择完整日期范围");
    start = new Date(filter.start + "T00:00:00");
    end = new Date(filter.end + "T00:00:00");
    end.setDate(end.getDate() + 1);
  }
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start)
    throw new Error("日期范围无效");
  return { start: start.toISOString(), end: end.toISOString() };
}
function bucketOf(ts, hourly) {
  const d = new Date(ts),
    pad = (v) => String(v).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    (hourly ? ` ${pad(d.getHours())}:00` : "")
  );
}
function summarize(store, filter = {}) {
  const { start, end } = bounds(filter);
  const prices = store.prices();
  const sessions = store.db.prepare("SELECT * FROM sessions").all(),
    sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const accepts = (r) =>
    (!filter.model || r.model === filter.model) &&
    (!filter.project ||
      sessionMap.get(r.session)?.project === filter.project) &&
    (!filter.session || r.session === filter.session);
  const rows = store.db
    .prepare("SELECT * FROM usage WHERE ts>=? AND ts<? ORDER BY ts")
    .all(start, end)
    .filter(accepts);
  const turns = store.db
    .prepare(
      "SELECT * FROM turns WHERE started>=? AND started<? ORDER BY started DESC",
    )
    .all(start, end)
    .filter(accepts);
  const sums = {
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    cache_write: 0,
    cost: 0,
    saved: 0,
    unpriced: 0,
    requests: 0,
    legacyRequests: 0,
  };
  const models = {},
    projects = {},
    tasks = {},
    timeline = {};
  const hourly = filter.range === "today" || !filter.range;
  for (const r of rows) {
    const c = costOf(r, prices);
    Object.assign(r, c);
    sums.requests++;
    if (r.kind !== "逐次记录") sums.legacyRequests++;
    for (const k of ["input", "cached", "output", "reasoning", "cache_write"])
      sums[k] += r[k];
    if (c.cost === null) sums.unpriced++;
    else {
      sums.cost += c.cost;
      sums.saved += c.saved;
    }
    const project = sessionMap.get(r.session)?.project || "未归属项目";
    for (const [map, key] of [
      [models, r.model],
      [projects, project],
      [tasks, r.session],
      [timeline, bucketOf(r.ts, hourly)],
    ]) {
      map[key] ??= {
        name: key,
        total: 0,
        input: 0,
        output: 0,
        cached: 0,
        cost: 0,
        unpriced: 0,
        requests: 0,
      };
      map[key].total += r.input + r.output;
      map[key].input += r.input;
      map[key].output += r.output;
      map[key].cached += r.cached;
      map[key].cost += c.cost || 0;
      map[key].unpriced += c.cost === null ? 1 : 0;
      map[key].requests++;
    }
  }
  const completed = turns.filter((t) => t.status === "completed"),
    failed = turns.filter((t) => t.status === "failed"),
    aborted = turns.filter((t) => t.status === "aborted");
  const timed = completed.filter((t) => t.duration > 0);
  const latency = turns.filter((t) => t.ttft !== null);
  const turnUsage = store.db.prepare("SELECT * FROM usage WHERE turn=? AND session=?");
  const turnRecords = turns.slice(0, 200).map(t => {
    const records = turnUsage.all(t.id, t.session);
    const totals = { input: 0, cached: 0, output: 0, inputCost: 0, outputCost: 0, cost: 0, unpriced: 0, requests: records.length };
    for (const row of records) {
      for (const key of ['input', 'cached', 'output']) totals[key] += row[key];
      const price = costOf(row, prices);
      if (price.cost === null) totals.unpriced++;
      else for (const key of ['inputCost', 'outputCost', 'cost']) totals[key] += price[key];
    }
    if (!records.length || totals.unpriced === records.length) {
      totals.inputCost = totals.outputCost = totals.cost = null;
    }
    return { ...t, ...totals, project: sessionMap.get(t.session)?.project || "未归属项目" };
  });
  // Include full turn output for speed, even when the date filter starts midway through a turn.
  const speeds = timed
    .map((t) => ({
      ...t,
      output: store.db
        .prepare("SELECT COALESCE(SUM(output),0) n FROM usage WHERE turn=?")
        .get(t.id).n,
    }))
    .filter((t) => t.output > 0);
  const duration = speeds.reduce((s, t) => s + t.duration, 0),
    output = speeds.reduce((s, t) => s + t.output, 0);
  const active = store.db
    .prepare("SELECT * FROM turns WHERE status='running' AND last_seen>=?")
    .all(new Date(Date.now() - 120000).toISOString())
    .filter(accepts);
  const quotas = store.db
    .prepare("SELECT * FROM quotas ORDER BY ts DESC")
    .all();
  const latest = {};
  for (const q of quotas) latest[`${q.bucket}:${q.slot}`] ??= q;
  const history = quotas.filter((q) => q.ts >= start && q.ts < end).reverse();
  const rank = (map) => Object.values(map).sort((a, b) => b.total - a.total);
  const latestSpeed = speeds[0];
  return {
    range: { start, end },
    sums: {
      ...sums,
      total: sums.input + sums.output,
      cacheRate: sums.input ? sums.cached / sums.input : null,
    },
    performance: {
      completed: completed.length,
      failed: failed.length,
      aborted: aborted.length,
      successRate:
        completed.length + failed.length
          ? completed.length / (completed.length + failed.length)
          : null,
      active: active.length,
      activeReason:
        "最近 2 分钟有统计事件且未结束的任务；等待或静默任务可能不计入",
      avgDuration: timed.length
        ? timed.reduce((s, t) => s + t.duration, 0) / timed.length
        : null,
      ttft: latency.length
        ? latency.reduce((s, t) => s + t.ttft, 0) / latency.length
        : null,
      ttftSamples: latency.length,
      taskTps: duration ? output / (duration / 1000) : null,
      latestTps: latestSpeed
        ? latestSpeed.output / (latestSpeed.duration / 1000)
        : null,
      latestAt: latestSpeed?.ended || null,
      exactTps: null,
    },
    models: rank(models),
    projects: rank(projects),
    tasks: rank(tasks).map((t) => ({
      ...t,
      project: sessionMap.get(t.name)?.project || "未归属项目",
    })),
    timeline: Object.values(timeline)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        ...p,
        time: new Date(
          p.name.includes(" ")
            ? p.name.replace(" ", "T")
            : p.name + "T00:00:00",
        ).getTime(),
      })),
    turns: turnRecords,
    quotas: Object.values(latest),
    quotaHistory: history,
    scan: store.get("scan"),
    quotaStatus: store.get("quotaStatus"),
    coverage: store.db
      .prepare("SELECT MIN(ts) first,MAX(ts) last,COUNT(*) records FROM usage")
      .get(),
    options: {
      models: store.db
        .prepare("SELECT DISTINCT model FROM usage ORDER BY model")
        .all()
        .map((r) => r.model),
      projects: [...new Set(sessions.map((s) => s.project))].sort(),
      sessions: sessions.map((s) => ({ id: s.id, project: s.project })),
    },
    settings: store.settings(),
    prices,
    recovery: store.get("recovery"),
  };
}
function csv(rows) {
  const cols = [
    "ts",
    "model",
    "session",
    "turn",
    "input",
    "cached",
    "output",
    "reasoning",
    "cache_write",
    "cost",
    "saved",
    "priceId",
    "kind",
  ];
  const cell = (value) => {
    let s = String(value ?? "");
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      cols.join(","),
      ...rows.map((r) => cols.map((k) => cell(r[k])).join(",")),
    ].join("\r\n")
  );
}
function exportRows(store, filter) {
  const { start, end } = bounds(filter),
    prices = store.prices();
  return store.db
    .prepare(
      "SELECT u.*,s.project FROM usage u LEFT JOIN sessions s ON s.id=u.session WHERE ts>=? AND ts<? ORDER BY ts",
    )
    .all(start, end)
    .filter(
      (r) =>
        (!filter.model || r.model === filter.model) &&
        (!filter.project || r.project === filter.project) &&
        (!filter.session || r.session === filter.session),
    )
    .map((r) => ({ ...r, ...costOf(r, prices) }));
}
module.exports = { costOf, bounds, summarize, csv, exportRows, bucketOf };
