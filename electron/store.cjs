const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { migrateAccounts, observeAccount, accountAt, UNKNOWN } = require("./accounts.cjs");
const officialPrices = require("./official-prices.cjs");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const iso = (value) => {
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const defaults = {
  theme: "system",
  language: "zh-CN",
  muted: false,
  autoStart: false,
  quotaInterval: 60,
  codexExecutable: "",
  clearedAt: null,
};

class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,offset INTEGER,state TEXT,mtime REAL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,project TEXT,origin TEXT,created TEXT);
      CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,session TEXT,turn TEXT,ts TEXT,model TEXT,input INTEGER,cached INTEGER,output INTEGER,reasoning INTEGER,cache_write INTEGER,kind TEXT);
      CREATE INDEX IF NOT EXISTS usage_time ON usage(ts);
      CREATE INDEX IF NOT EXISTS usage_turn_session ON usage(turn,session);
      CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY,session TEXT,model TEXT,started TEXT,ended TEXT,status TEXT,duration REAL,ttft REAL,last_seen TEXT);
      CREATE TABLE IF NOT EXISTS quotas(id TEXT PRIMARY KEY,ts TEXT,bucket TEXT,slot TEXT,used REAL,minutes REAL,resets REAL,plan TEXT,source TEXT);
      CREATE INDEX IF NOT EXISTS quota_time ON quotas(ts);
      CREATE INDEX IF NOT EXISTS turns_started ON turns(started);
      CREATE INDEX IF NOT EXISTS turns_active ON turns(status,last_seen);
      CREATE INDEX IF NOT EXISTS quota_bucket_time ON quotas(bucket,slot,ts DESC);
      CREATE TABLE IF NOT EXISTS prices(id INTEGER PRIMARY KEY,model TEXT,effective TEXT,input REAL,cached REAL,output REAL,cache_write REAL,source TEXT);
      CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY,ts TEXT);
    `);
    migrateAccounts(this);
    if (!this.get("seeded")) {
      const rates = officialPrices.rates;
      for (const [model, input, cached, output, write] of rates)
        this.db
          .prepare(
            "INSERT INTO prices(model,effective,input,cached,output,cache_write,source) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            model,
            "1970-01-01T00:00:00.000Z",
            input,
            cached,
            output,
            write,
            officialPrices.source,
          );
      this.set("seeded", true);
    }
    if (
      !this.db
        .prepare("PRAGMA table_info(prices)")
        .all()
        .some((c) => c.name === "retired")
    ) {
      this.db.exec(
        "ALTER TABLE prices ADD COLUMN retired INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!this.get("standard-price-correction-v1")) {
      this.db.exec("BEGIN");
      try {
        for (const [
          model,
          input,
          cached,
          output,
          write,
        ] of officialPrices.rates) {
          const old = this.db
            .prepare(
              "SELECT id FROM prices WHERE model=? AND source=? AND input=? AND cached=? AND output=? AND cache_write=? AND retired=0",
            )
            .all(
              model,
              "官方标准短上下文价格 · 核对于 2026-09-09；历史按此基准估算",
              input / 2,
              cached / 2,
              output / 2,
              write / 2,
            );
          if (!old.length) continue;
          for (const row of old)
            this.db
              .prepare("UPDATE prices SET retired=1 WHERE id=?")
              .run(row.id);
          this.db
            .prepare(
              "INSERT INTO prices(model,effective,input,cached,output,cache_write,source) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              model,
              "1970-01-01T00:00:00.000Z",
              input,
              cached,
              output,
              write,
              officialPrices.source,
            );
        }
        this.set("standard-price-correction-v1", true);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
  }
  get(key) {
    const row = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : null;
  }
  set(key, value) {
    this.db
      .prepare("INSERT OR REPLACE INTO kv VALUES(?,?)")
      .run(key, JSON.stringify(value));
  }
  settings() {
    return { ...defaults, ...this.get("settings") };
  }
  saveSettings(input) {
    const next = this.settings();
    if (["zh-CN", "en"].includes(input.language)) next.language = input.language;
    if (["system", "light", "dark"].includes(input.theme))
      next.theme = input.theme;
    for (const k of ["muted", "autoStart"])
      if (typeof input[k] === "boolean") next[k] = input[k];
    if (input.quotaInterval !== undefined) {
      if (![60, 120, 300].includes(input.quotaInterval))
        throw new Error("刷新间隔无效");
      next.quotaInterval = input.quotaInterval;
    }
    if (
      typeof input.codexExecutable === "string" &&
      input.codexExecutable.length < 1024
    )
      next.codexExecutable = input.codexExecutable;
    this.set("settings", next);
    return next;
  }
  savePrice(p) {
    if (
      typeof p.model !== "string" ||
      !/^[a-zA-Z0-9._:/-]{1,100}$/.test(p.model)
    )
      throw new Error("模型名称无效");
    for (const k of ["input", "cached", "output", "cache_write"])
      if (number(p[k]) === null || p[k] > 100000)
        throw new Error("价格须为有限的非负数");
    const effective = iso(p.effective);
    if (!effective) throw new Error("生效时间无效");
    this.db
      .prepare(
        "INSERT INTO prices(model,effective,input,cached,output,cache_write,source) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        p.model,
        effective,
        p.input,
        p.cached,
        p.output,
        p.cache_write,
        "手动设置",
      );
    return this.prices();
  }
  prices() {
    return this.db
      .prepare(
        "SELECT * FROM prices ORDER BY effective DESC, CASE WHEN source='手动设置' THEN 1 ELSE 0 END DESC, id DESC",
      )
      .all();
  }
  addQuota(raw, ts, source = "日志", account = accountAt(this, ts)) {
    if (
      !raw ||
      !iso(ts) ||
      (this.settings().clearedAt && ts <= this.settings().clearedAt)
    )
      return;
    const bucket = String(raw.limitId || raw.limit_id || "codex");
    for (const slot of ["primary", "secondary"]) {
      const w = raw[slot];
      if (!w) continue;
      const used = number(w.usedPercent ?? w.used_percent),
        minutes = number(w.windowDurationMins ?? w.window_minutes),
        resets = number(w.resetsAt ?? w.resets_at);
      if (used === null || minutes === null) continue;
      if (source === "日志" && this.db.prepare("SELECT 1 FROM quotas WHERE ts=? AND bucket=? AND slot=? AND used=? AND resets IS ? AND source=? LIMIT 1").get(ts,bucket,slot,Math.min(100,used),resets,source)) continue;
      this.db
        .prepare("INSERT OR IGNORE INTO quotas(id,ts,bucket,slot,used,minutes,resets,plan,source,account) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(
          hash([account, ts, bucket, slot, used, resets].join("|")),
          ts,
          bucket,
          slot,
          Math.min(100, used),
          minutes,
          resets,
          raw.planType || raw.plan_type || null,
          source,
          account,
        );
    }
  }
  process(o, s) {
    const p = o.payload || {},
      ts = iso(o.timestamp);
    if (!ts) return;
    if (o.type === "session_meta") {
      s.session = p.id;
      s.desktop = p.originator === "Codex Desktop";
      s.project = p.cwd || "未归属项目";
      if (s.desktop && s.session)
        this.db
          .prepare("INSERT OR IGNORE INTO sessions VALUES(?,?,?,?)")
          .run(s.session, s.project, "Codex Desktop", ts);
      return;
    }
    if (!s.desktop || !s.session) return;
    const cleared = this.settings().clearedAt,
      allowed = !cleared || ts > cleared;
    if (o.type === "turn_context") {
      s.model = p.model || "unknown";
      s.turn = p.turn_id || s.turn;
      return;
    }
    if (o.type === "event_msg") {
      if (p.type === "task_started") {
        s.turn = p.turn_id || hash(s.session + ts);
        s.modern = false;
        if (allowed)
          this.db
            .prepare("INSERT OR IGNORE INTO turns(id,session,model,started,ended,status,duration,ttft,last_seen,account) VALUES(?,?,?,?,?,?,?,?,?,?)")
            .run(
              s.turn,
              s.session,
              s.model || "unknown",
              ts,
              null,
              "running",
              null,
              null,
              ts,
              accountAt(this, ts),
            );
      }
      if (p.type === "task_complete" || p.type === "turn_aborted") {
        const id = p.turn_id || s.turn;
        if (allowed && id) {
          this.db
            .prepare(
              "UPDATE turns SET ended=?,status=?,duration=?,ttft=?,model=?,last_seen=? WHERE id=?",
            )
            .run(
              ts,
              p.type === "turn_aborted"
                ? "aborted"
                : p.error
                  ? "failed"
                  : "completed",
              number(p.duration_ms),
              number(p.time_to_first_token_ms),
              s.model || "unknown",
              ts,
              id,
            );
        }
      }
      if (p.type === "token_count") {
        if (allowed) this.addQuota(p.rate_limits, ts);
        const total = p.info?.total_token_usage;
        if (total) {
          if (!s.modern && allowed) {
            const prev = s.total;
            const usage = {};
            for (const k of [
              "input_tokens",
              "cached_input_tokens",
              "output_tokens",
              "reasoning_output_tokens",
              "cache_write_input_tokens",
            ])
              usage[k] = Math.max(0, (total[k] || 0) - (prev?.[k] || 0));
            // A lower cumulative total indicates reset/compaction, not negative usage.
            if (prev && total.total_tokens < prev.total_tokens)
              Object.assign(usage, p.info.last_token_usage || {});
            if (usage.input_tokens + usage.output_tokens > 0)
              this.addUsage(
                "legacy:" + hash(ts + JSON.stringify(total)),
                usage,
                ts,
                s,
                "累计差分",
              );
          }
          s.total = total;
        }
      }
    }
    if (o.type === "token_usage_record") {
      s.modern = true;
      if (p.thread_token_usage) s.total = p.thread_token_usage;
      // Parent rollouts can contain forwarded subagent usage; the owning rollout is authoritative.
      if (p.thread_id && p.thread_id !== s.session) return;
      if (allowed && p.usage)
        this.addUsage(
          p.response_id || hash(ts + JSON.stringify(p.usage)),
          p.usage,
          ts,
          { ...s, turn: p.turn_id || s.turn },
          "逐次记录",
        );
    }
  }
  addUsage(id, u, ts, s, kind) {
    const input = number(u.input_tokens),
      output = number(u.output_tokens),
      cached = number(u.cached_input_tokens) ?? 0;
    if (input === null || output === null || cached > input) return;
    this.db
      .prepare(`INSERT OR ${this.replayingRecovered ? "REPLACE" : "IGNORE"} INTO usage(id,session,turn,ts,model,input,cached,output,reasoning,cache_write,kind,account) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id,
        s.session,
        s.turn || null,
        ts,
        s.model || "unknown",
        input,
        cached,
        output,
        number(u.reasoning_output_tokens) ?? 0,
        number(u.cache_write_input_tokens) ?? 0,
        kind,
        this.db.prepare("SELECT account FROM usage WHERE id=?").get(id)?.account || accountAt(this, ts),
      );
    if (s.turn)
      this.db
        .prepare("UPDATE turns SET model=?,last_seen=? WHERE id=?")
        .run(s.model || "unknown", ts, s.turn);
  }
  async scan(home, onProgress = () => {}, options = {}) {
    observeAccount(this, home);
    this.replayingRecovered = !!this.get("replayRecovered");
    const now = Date.now();
    const full = options.full || !this.catalog || this.catalogHome !== home || now - this.lastDiscovery >= 60000;
    if(full) { this.catalog = new Map(); this.catalogHome=home; }
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.isFile() && e.name.endsWith('.jsonl') && !this.catalog.has(f)) this.catalog.set(f,now);
      }
    };
    if(full) {
      walk(path.join(home,'sessions'));
      walk(path.join(home,'archived_sessions'));
      this.lastDiscovery=now;
    } else {
      // New rollouts use dated directories. A complete discovery catches other layouts and moved archives.
      for(let days=0;days<2;days++) {
        const d=new Date(now-days*86400000);
        for(const parts of [[d.getFullYear(),d.getMonth()+1,d.getDate()],[d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()]])
          walk(path.join(home,'sessions',...parts.map((n,i)=>i?String(n).padStart(2,'0'):String(n))));
      }
    }
    const files = [...this.catalog].filter(([,modified])=>full || now-modified<120000).map(([file])=>file);
    let changed = false;
    const diagnostics = [];
    const report = (code,file) => {
      if(diagnostics.length<20) diagnostics.push({code,fileId:hash(file).slice(0,12)});
    };
    let scanned = 0,
      errors = 0;
    for (const file of files) {
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        errors++; report('file_stat',file);
        this.catalog.delete(file);
        continue;
      }
      this.catalog.set(file,st.mtimeMs);
      const old = this.db.prepare("SELECT * FROM files WHERE path=?").get(file);
      if (old && old.offset === st.size && old.mtime === st.mtimeMs) {
        scanned++;
        continue;
      }
      changed = true;
      let offset = old && old.offset <= st.size ? old.offset : 0;
      const state = offset && old ? JSON.parse(old.state) : {};
      if (state.desktop === false && offset) {
        this.db
          .prepare("UPDATE files SET offset=?,mtime=? WHERE path=?")
          .run(st.size, st.mtimeMs, file);
        scanned++;
        continue;
      }
      this.db.exec("BEGIN");
      try {
        let pending = Buffer.alloc(0);
        for await (const chunk of fs.createReadStream(file, {
          start: offset,
          highWaterMark: 256 * 1024,
        })) {
          const data = Buffer.concat([pending, chunk]);
          let start = 0,
            index;
          while ((index = data.indexOf(10, start)) >= 0) {
            const line = data.subarray(start, index);
            offset += index - start + 1;
            start = index + 1;
            // Only statistical records are parsed. Message and tool bodies are never stored.
            const head = line.subarray(0, 180).toString("utf8");
            if (
              /"type"\s*:\s*"(session_meta|turn_context|event_msg|token_usage_record)"/.test(
                head,
              )
            ) {
              try {
                this.process(JSON.parse(line.toString("utf8")), state);
              } catch {
                errors++; report('record_parse',file);
              }
            }
          }
          pending = data.subarray(start);
        }
        this.db
          .prepare("INSERT OR REPLACE INTO files VALUES(?,?,?,?)")
          .run(file, offset, JSON.stringify(state), st.mtimeMs);
        this.db.exec("COMMIT");
      } catch {
        this.db.exec("ROLLBACK");
        errors++; report('file_read',file);
      }
      scanned++;
      if (scanned % 10 === 0) onProgress({ scanned, total: files.length });
    }
    // Records appended while a scan was in progress may be read after the observation boundary.
    // On the next observation, attach only timestamps within this verified interval.
    const observation = this.db.prepare("SELECT * FROM account_observations WHERE id=?").get(this.observationId);
    if (observation?.account !== UNKNOWN) {
      for (const [table,time] of [["usage","ts"],["turns","started"],["quotas","ts"]])
        this.db.prepare(`UPDATE ${table} SET account=? WHERE account=? AND ${time}>=? AND ${time}<=?`).run(observation.account,UNKNOWN,observation.started,observation.ended);
    }
    const status = {
      scanned,
      total: this.catalog.size,
      checked: files.length,
      full,
      changed,
      diagnostics,
      errors,
      lastScan: new Date().toISOString(),
      sourceExists: fs.existsSync(path.join(home, "sessions")),
    };
    this.set("scan", status);
    if (this.replayingRecovered && !errors) this.set("replayRecovered",false);
    this.replayingRecovered = false;
    return status;
  }
  clear() {
    this.db.exec("BEGIN");
    try {
      this.db.exec(
        "DELETE FROM usage; DELETE FROM turns; DELETE FROM quotas; DELETE FROM notices;",
      );
      this.set("settings", {
        ...this.settings(),
        clearedAt: new Date().toISOString(),
      });
      this.db.exec("COMMIT");
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw e;
    }
  }
  checkpoint() {
    try { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
    catch (error) {
      if (!/malformed|corrupt/i.test(error.message)) throw error;
      // Rebuild derived indexes without changing stored records. Some damaged
      // indexes surface only during a WAL checkpoint, after integrity checks pass.
      this.db.exec("REINDEX");
      const check = this.db.prepare("PRAGMA integrity_check").all();
      if (check.length !== 1 || Object.values(check[0])[0] !== "ok") throw error;
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
  }
  close() {
    try { this.checkpoint(); } finally { this.db.close(); }
  }
}
module.exports = { Store, hash };
