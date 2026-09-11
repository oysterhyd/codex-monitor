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
// costOf() needs the latest non-retired price per model whose effective date has
// already passed. store.prices() is ordered so that this is the first match, which
// lets the scan stop at the first hit instead of walking the whole price history
// for every usage row. Input order is preserved so ties resolve identically.
function priceIndex(prices) {
  const index = new Map();
  for (const p of prices) {
    if (p.retired) continue;
    const bucket = index.get(p.model);
    if (bucket) bucket.push(p);
    else index.set(p.model, [p]);
  }
  return index;
}
function pickPrice(bucket, ts) {
  // prices() is ordered effective DESC, and the original prices.find() returned the
  // FIRST element satisfying the predicate, i.e. the most recent applicable price.
  // Scanning forwards preserves that; scanning backwards would pick the oldest one.
  for (let i = 0; i < bucket.length; i++) {
    if (bucket[i].effective <= ts) return bucket[i];
  }
  return null;
}
function costWith(row, prices, index) {
  const bucket = index && index.get(row.model);
  const p = bucket ? pickPrice(bucket, row.ts) : prices.find(
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
  if (filter.account === "current") filter = {...filter, account: store.get("currentAccount") || "unassigned"};
  const { start, end } = bounds(filter);
  const page = filter.page || 'all';
  const analytics = ['all', 'overview', 'history'].includes(page);
  const recordsWanted = ['all', 'history'].includes(page);
  const historyWanted = ['all', 'quota'].includes(page);
  // options.models / options.projects are only rendered by the overview and
  // history pages; options.sessions additionally by the settings page. The quota
  // page reads none of them, yet DISTINCT model is a full scan of usage.
  const optionsWanted = ['all', 'overview', 'history', 'settings'].includes(page);
  const breakdownWanted = ['all', 'overview', 'history'].includes(page);
  const pageSize = Math.max(1, Math.min(200, Math.floor(Number(filter.pageSize) || 200)));
  const requestedPage = Math.max(1, Math.floor(Number(filter.recordPage) || 1));
  const prices = store.prices();
  const pricesByModel = priceIndex(prices);
  const sessions = store.sql("SELECT * FROM sessions").all(),
    sessionMap = new Map(sessions.map((s) => [s.id, s]));
  // Resolve account membership once, rather than querying each session twice per snapshot.
  const accountSessions = filter.account
    ? new Set(store.sql("SELECT DISTINCT session FROM usage WHERE account=?").all(filter.account).map(r => r.session))
    : null;
  const availableSessions = accountSessions ? sessions.filter(s => accountSessions.has(s.id)) : sessions;
  // Account membership for the running-turn list is resolved in SQL, not here (see the note on
  // the `activeTurns` query below). A set built from `SELECT DISTINCT turn,session FROM usage
  // WHERE account=?` would be planned as a walk of every row the account owns plus a temp B-tree,
  // regardless of any turn IN (...) scoping, so it costs O(account rows) on every account-filtered
  // snapshot; pushing the predicate onto the running turns instead makes each lookup an indexed
  // probe on usage_turn_session, and costs nothing at all when no turn is running.
  // This predicate therefore tests only the remaining dimensions - it must NOT re-test account,
  // because a turn's own row can legitimately carry a different account from the usage written
  // under it.
  const accepts = (r) =>
    (!filter.model || r.model === filter.model) &&
    (!filter.project ||
      sessionMap.get(r.session)?.project === filter.project) &&
    (!filter.session || r.session === filter.session);
  const conditions = ['u.ts>=?', 'u.ts<?'];
  const params = [start, end];
  for (const [key, column] of [['account','u.account'], ['model','u.model'], ['session','u.session'], ['project','s.project']]) {
    if (filter[key]) { conditions.push(`${column}=?`); params.push(filter[key]); }
  }
  const rows = analytics ? store.sql(`SELECT u.* FROM usage u LEFT JOIN sessions s ON s.id=u.session WHERE ${conditions.join(' AND ')} ORDER BY u.ts`).all(...params) : [];
  const turnConditions=['t.started>=?','t.started<?'], turnParams=[start,end];
  if(filter.account) {turnConditions.push('(t.account=? OR EXISTS (SELECT 1 FROM usage u WHERE u.turn=t.id AND u.session=t.session AND u.account=?))');turnParams.push(filter.account,filter.account);}
  if(filter.model) {turnConditions.push('(t.model=? OR EXISTS (SELECT 1 FROM usage u WHERE u.turn=t.id AND u.session=t.session AND u.model=?))');turnParams.push(filter.model,filter.model);}
  if(filter.session){turnConditions.push('t.session=?');turnParams.push(filter.session);}
  if(filter.project){turnConditions.push('s.project=?');turnParams.push(filter.project);}
  const turns = analytics ? store.sql(`SELECT t.* FROM turns t LEFT JOIN sessions s ON s.id=t.session WHERE ${turnConditions.join(' AND ')} ORDER BY t.started DESC,t.id DESC`).all(...turnParams) : [];
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
  // The breakdown maps (and the per-row local-date bucketing) are only rendered by
  // the overview and history pages, so they are skipped for settings/quota pages.
  const accumulators = [];
  if (breakdownWanted) {
    accumulators.push([models, r => r.model], [projects, r => sessionMap.get(r.session)?.project || "未归属项目"], [tasks, r => r.session]);
  }
  accumulators.push([timeline, r => bucketOf(r.ts, hourly)]);
  for (const r of rows) {
    const c = costWith(r, prices, pricesByModel);
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
    for (const [map, keyOf] of accumulators) {
      const key = keyOf(r);
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
  const recordPage = Math.min(requestedPage, Math.max(1, Math.ceil(turns.length / pageSize)));
  const selectedTurns = recordsWanted ? turns.slice((recordPage - 1) * pageSize, recordPage * pageSize) : [];
  const usageByTurn = new Map(), outputByTurn = new Map();
  if (analytics) {
    for (const r of store.sql(`SELECT t.id, COALESCE(SUM(u.output),0) output FROM turns t
      LEFT JOIN usage u ON u.turn=t.id AND u.session=t.session ${filter.account ? 'AND u.account=?' : ''}
      WHERE t.started>=? AND t.started<? GROUP BY t.id`).iterate(...(filter.account ? [filter.account,start,end] : [start,end]))) outputByTurn.set(r.id,r.output);
  }
  if (selectedTurns.length) {
    const ids = selectedTurns.map(t=>t.id);
    for (const r of store.sql(`SELECT u.* FROM usage u JOIN turns t ON t.id=u.turn AND t.session=u.session
      WHERE t.id IN (${ids.map(()=>'?').join(',')}) ORDER BY u.ts`).iterate(...ids)) {
      if (filter.account && r.account !== filter.account) continue;
      if (!usageByTurn.has(r.turn)) usageByTurn.set(r.turn,[]);
      usageByTurn.get(r.turn).push(r);
    }
  }
  const emptyTotals = () => ({input:0,cached:0,output:0,inputCost:0,outputCost:0,cost:0,unpriced:0,requests:0});
  const add = (total,row) => {
    total.requests++;
    for(const key of ['input','cached','output']) total[key]+=row[key];
    const price=costWith(row,prices,pricesByModel);
    if(price.cost===null) total.unpriced++;
    else for(const key of ['inputCost','outputCost','cost']) total[key]+=price[key];
  };
  const finish = total => {
    if(!total.requests || total.unpriced===total.requests) total.inputCost=total.outputCost=total.cost=null;
    return total;
  };
  const turnRecords = selectedTurns.map(t => {
    const totals=emptyTotals(), models=new Map();
    for(const row of usageByTurn.get(t.id)||[]) {
      add(totals,row);
      if(!models.has(row.model)) models.set(row.model,{model:row.model,...emptyTotals()});
      add(models.get(row.model),row);
    }
    return {...t,...finish(totals),models:[...models.values()].map(finish),project:sessionMap.get(t.session)?.project||'未归属项目'};
  });
  const speeds = timed.map(t=>({...t,output:outputByTurn.get(t.id)||0})).filter(t=>t.output>0);
  const duration = speeds.reduce((s, t) => s + t.duration, 0),
    output = speeds.reduce((s, t) => s + t.output, 0);
  // Running turns. The account predicate carries BOTH disjuncts the shipped filter used: a turn
  // counts when its OWN row carries the account, or when a usage row for that (turn,session)
  // does. Dropping the first half silently loses turns that have no usage row under the filtered
  // account (verified: pristine activeForA 4 vs 2 without it). Both halves are index-friendly -
  // the first is a column test on turns, the second seeks usage_turn_session - so this stays an
  // indexed probe per running turn and costs nothing at all when no turn is running.
  // `accepts` below must NOT re-test account, or the first half would be filtered out again.
  const captureCutoff = new Date(Date.now() - 120000).toISOString();
  const activeTurns = store.sql(`SELECT t.* FROM turns t WHERE t.status='running' AND t.last_seen>=?
      AND (? IS NULL OR t.account=?
        OR EXISTS (SELECT 1 FROM usage u WHERE u.turn=t.id AND u.session=t.session AND u.account=?))
    ORDER BY t.started DESC,t.id DESC`)
    .all(captureCutoff, filter.account || null, filter.account || null, filter.account || null);
  const active = activeTurns.filter(accepts);
  const quotaAccount = filter.account || store.get('currentAccount') || 'unassigned';
  const quotaWhere = 'account=? AND ';
  const quotaParams = [quotaAccount];
  const analyticsAccountParams = filter.account ? [filter.account] : [];
  const latest = store.sql(`SELECT q.* FROM
    (SELECT DISTINCT account,bucket,slot FROM quotas WHERE account=?) b JOIN quotas q ON q.rowid=(
      SELECT rowid FROM quotas WHERE account=b.account AND bucket=b.bucket AND slot=b.slot ORDER BY ts DESC,rowid DESC LIMIT 1)
    `).all(...quotaParams);
  const history = [];
  let historySamples = 0;
  if(historyWanted) {
    const extent = store.sql(`SELECT MIN(ts) first,MAX(ts) last FROM quotas WHERE ${quotaWhere}ts>=? AND ts<?`).get(...quotaParams,start,end);
    const width = Math.max(1,(Date.parse(extent.last)-Date.parse(extent.first))/150);
    const bins = new Map(), previousByWindow = new Map(), gapEdges = new Map();

    for(const q of store.sql(`SELECT * FROM quotas WHERE ${quotaWhere}ts>=? AND ts<? ORDER BY ts`).iterate(...quotaParams,start,end)) {
      historySamples++;
      const windowKey = `${q.account}:${q.bucket}:${q.slot}`;
      const previous = previousByWindow.get(windowKey);
      // Sparse log samples within a quota window can still show a sampled trend.
      // Leave a gap only when an entire window (capped at six hours) is unobserved.
      const maxGap = Math.max(60, Math.min(q.minutes || 300, 360)) * 60000;
      if (previous && Date.parse(q.ts) - Date.parse(previous.ts) > maxGap) {
        q.gapBefore = true;
        gapEdges.set(previous.id, previous); gapEdges.set(q.id, q);
      }
      previousByWindow.set(windowKey, q);
      const key = `${q.account}:${q.bucket}:${q.slot}:${q.resets}:${Math.floor((Date.parse(q.ts)-Date.parse(extent.first))/width)}`;
      let bin=bins.get(key);
      if(!bin) bins.set(key,bin={first:q,last:q,min:q,max:q});
      bin.last=q;
      if(q.used<bin.min.used)bin.min=q;
      if(q.used>bin.max.used)bin.max=q;
    }
    const points=new Map(gapEdges);
    for(const bin of bins.values()) for(const q of Object.values(bin)) points.set(q.id,q);
    history.push(...[...points.values()].sort((a,b)=>a.ts.localeCompare(b.ts)));
  }
  const rank = (map) => Object.values(map).sort((a, b) => b.total - a.total);
  // turns is ordered started DESC, id DESC, so the first turn with recorded output is
  // the newest speed sample — the same row the previous in-memory scan picked.
  let latestSpeed = null;
  for (const t of timed) {
    if (outputByTurn.get(t.id) > 0) { latestSpeed = { ...t, output: outputByTurn.get(t.id) }; break; }
  }
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
    quotas: latest,
    records: { page: recordPage, pageSize, total: turns.length, pages: Math.max(1,Math.ceil(turns.length/pageSize)) },
    quotaHistorySamples: historySamples,
    quotaHistory: history,
    quotaAccount,
    scan: store.get("scan"),
    quotaStatus: store.get("quotaStatus")?.account === quotaAccount ? store.get("quotaStatus") : null,
    currentAccount: store.get("currentAccount"),
    accounts: store.sql("SELECT * FROM accounts ORDER BY label,id").all(),
    coverage: store.sql(`SELECT MIN(ts) first,MAX(ts) last,COUNT(*) records FROM usage ${filter.account ? "WHERE account=?" : ""}`)
      .get(...analyticsAccountParams),
    options: {
      models: optionsWanted
        ? store.sql(`SELECT DISTINCT model FROM usage ${filter.account ? "WHERE account=?" : ""} ORDER BY model`)
          .all(...analyticsAccountParams)
          .map((r) => r.model)
        : [],
      projects: optionsWanted
        ? [...new Set(availableSessions.map((s) => s.project))].sort()
        : [],
      sessions: optionsWanted
        ? availableSessions.map((s) => ({ id: s.id, project: s.project }))
        : [],
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
    "account",
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
  if (filter.account === "current") filter = {...filter, account: store.get("currentAccount") || "unassigned"};
  const { start, end } = bounds(filter),
    prices = store.prices();
  const pricesByModel = priceIndex(prices);
  // Same predicates the previous JS .filter() applied, pushed into SQL so the whole
  // date range is no longer materialised before being discarded. The project
  // predicate lives in the JOIN's ON clause to keep the LEFT JOIN from dropping
  // rows whose session is missing or has a NULL project.
  const conditions = ['u.ts>=?', 'u.ts<?'],
    params = [start, end];
  if (filter.account) { conditions.push('u.account=?'); params.push(filter.account); }
  if (filter.model) { conditions.push('u.model=?'); params.push(filter.model); }
  if (filter.session) { conditions.push('u.session=?'); params.push(filter.session); }
  if (filter.project) { conditions.push('s.project=?'); params.push(filter.project); }
  return store.sql(
      `SELECT u.*,s.project FROM usage u LEFT JOIN sessions s ON s.id=u.session${filter.project ? ' AND s.project=?' : ''} WHERE ${conditions.join(' AND ')} ORDER BY u.ts`,
    )
    .all(...(filter.project ? [filter.project, ...params] : params))
    .map((r) => ({ ...r, ...costWith(r, prices, pricesByModel) }));
}
module.exports = { costOf, bounds, summarize, csv, exportRows, bucketOf };
