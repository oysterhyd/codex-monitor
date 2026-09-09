import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Pulse as Activity,
  ChartLine,
  ClockCounterClockwise,
  GearSix,
  ArrowClockwise,
  DownloadSimple,
  ArrowUpRight,
  CheckCircle,
  WarningCircle,
  Database,
  BellSlash,
  Sun,
  Monitor as MonitorIcon,
  Moon,
  Lightning,
  Coins,
  Stack,
  Target,
  FolderOpen,
  UserCircle,
  CaretDown,
} from "@phosphor-icons/react";
import "./style.css";
import "./glass.css";
import { tr, setLanguage, dateLocale, systemText } from "./i18n.mjs";
import monitorIcon from "../assets/monitor-glass.png";
import { createRefresh } from "./refresh.mjs";
import { chartPaths } from "./chart-paths.mjs";

const api = window.monitor;
const compact = (n) =>
  n == null
    ? "—"
    : Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(n);
const full = (n) =>
  n == null
    ? "—"
    : Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(n);
const money = (n) =>
  n == null
    ? "—"
    : "$" +
      n.toLocaleString("en", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const pct = (n) => (n == null ? "—" : (n * 100).toFixed(1) + "%");
const recordMoney = (n, t) => !t.requests ? "—" : n == null ? tr("未定价") :
  "$" + n.toLocaleString("en", { minimumFractionDigits: 4, maximumFractionDigits: 6 }) + (t.unpriced ? tr(" + 未定价") : "");
const date = (t) =>
  t
    ? new Date(t).toLocaleString(dateLocale(), {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const duration = (n) =>
  n == null
    ? "—"
    : n < 60000
      ? (n / 1000).toFixed(1) + tr(" 秒")
      : (n / 60000).toFixed(1) + tr(" 分钟");
const shortPath = (p) => p === "未归属项目" ? systemText(p) : p?.split(/[\\/]/).filter(Boolean).at(-1) || p;

function Animated({ value, format = compact }) {
  const [shown, setShown] = useState(value),
    prev = useRef(value);
  useEffect(() => {
    if (
      value == null ||
      prev.current == null ||
      document.hidden
    ) {
      setShown(value);
      prev.current = value;
      return;
    }
    const start = performance.now(),
      from = prev.current;
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 450);
      setShown(from + (value - from) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    prev.current = value;
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{format(shown)}</>;
}
function Empty({ children }) {
  return (
    <div className="empty">
      <ChartLine size={28} />
      <span>{children || tr("这个时间范围内还没有记录")}</span>
    </div>
  );
}
function Chart({
  points,
  value = "total",
  color = "var(--accent)",
  percent = false,
  step = false,
  label,
  replayKey,
  range,
}) {
  const [hover, setHover] = useState(null);
  useEffect(() => setHover(null), [replayKey]);
  if (!points.length) return <Empty />;
  const max = percent ? 100 : Math.max(1, ...points.map((p) => p[value] || 0));
  const first = range?.start ? Date.parse(range.start) : points[0].time,
    last = range?.end ? Date.parse(range.end) : points.at(-1).time;
  const xy = points.map((p, i) => [
    44 +
      (last > first
        ? (p.time - first) / (last - first)
        : points.length === 1 ? 0.5 : i / (points.length - 1)) *
        836,
    150 - ((p[value] || 0) / max) * 128,
  ]);
  const { line, area } = chartPaths(points, xy, { step });
  const chosen = hover == null ? null : points[hover];
  return (
    <div className="chart-wrap">
      <svg
        viewBox="0 0 920 190"
        role="img"
        aria-label={label || tr("用量趋势")}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1="44"
              x2="880"
              y1={150 - v * 128}
              y2={150 - v * 128}
              stroke="var(--border)"
              strokeDasharray="4 5"
            />
            <text x="0" y={154 - v * 128} fill="var(--muted)" fontSize="16">
              {percent ? max * v + "%" : compact(max * v)}
            </text>
          </g>
        ))}
        <g key={replayKey} className="chart-reveal">
        <path
          d={area}
          fill={color}
          opacity=".08"
        />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {xy.map(([x, y], i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={x - 8} y="12" width="16" height="144" fill="transparent" />
            <circle
              cx={x}
              cy={y}
              r={hover === i ? 5 : points.length < 30 ? 2.5 : step ? 1.5 : 0}
              fill={color}
            />
          </g>
        ))}
        </g>
        {(last > first ? [0, 0.5, 1] : [0]).map((fraction) => (
            <text
              className="chart-tick"
              key={fraction}
              x={44 + fraction * 836}
              y="179"
              textAnchor={
                fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"
              }
              fill="var(--muted)"
              fontSize="16"
            >
              {date(first + fraction * (last - first))}
            </text>
          ))}
      </svg>
      <div className="chart-caption">
        {chosen
          ? `${chosen.name} · ${percent ? chosen[value].toFixed(1) + "%" : full(chosen[value]) + " tokens"}`
          : "\u00a0"}
      </div>
    </div>
  );
}
function Panel({ title, meta, children, className = "" }) {
  return (
    <section className={"panel " + className}>
      <div className="panel-head">
        <h2><span className="panel-icon" aria-hidden="true">{title.toLowerCase().includes(tr("价格").toLowerCase()) ? <Coins size={21} /> : title.toLowerCase().includes(tr("外观").toLowerCase()) ? <GearSix size={21} /> : title.toLowerCase().includes(tr("额度").toLowerCase()) || title.toLowerCase().includes(tr("来源").toLowerCase()) ? <Database size={21} /> : <ChartLine size={21} />}</span>{title}</h2>
        {meta && <span>{meta}</span>}
      </div>
      {children}
    </section>
  );
}
function Metric({ label, value, format, foot, icon: Icon, color, onClick }) {
  return (
    <button
      className="metric"
      onClick={onClick}
      style={{ "--card-color": color || "var(--accent)" }}
    >
      <div className="metric-label">
        <span>{label}</span>
        <Icon size={19} />
      </div>
      <div className="metric-value">
        <Animated value={value} format={format} />
      </div>
      <div className="metric-foot">
        {foot}
        <ArrowUpRight size={15} />
      </div>
    </button>
  );
}
function WindowQuota({ q }) {
  const stale = q.resets != null && q.resets * 1000 < Date.now();
  const remaining = 100 - q.used;
  return (
    <div className="quota-window">
      <div className="row">
        <span>
          {q.minutes >= 1440
            ? tr("{0} 天窗口", Math.round(q.minutes / 1440))
            : tr("{0} 小时窗口", q.minutes / 60)}
        </span>
        <b>
          {remaining.toFixed(0)}
          <small>{tr("% 剩余")}</small>
        </b>
      </div>
      <div className="track">
        <i
          style={{
            width: remaining + "%",
            background: remaining <= 20 ? "var(--amber)" : "var(--accent)",
          }}
        />
      </div>
      <div className="row muted">
        <span>
          {stale
            ? tr("已过重置时间，等待新快照")
            : tr("重置 ") + date(q.resets ? q.resets * 1000 : null)}
        </span>
        <span>
          {systemText(q.source)} · {date(q.ts)}
        </span>
      </div>
    </div>
  );
}
function Rank({ rows, type, onSelect }) {
  return rows.length ? (
    <div className="rank">
      {rows.slice(0, 8).map((r, i) => (
        <button key={r.name} onClick={() => onSelect(r.name)}>
          <div className="rank-name">
            <span
              className="dot"
              style={{ background: `hsl(${155 + i * 27} 44% 54%)` }}
            />
            <span title={r.name}>
              {type === "model" ? r.name : shortPath(r.name)}
            </span>
            <b>{compact(r.total)}</b>
          </div>
          <div className="track">
            <i style={{ width: (r.total / rows[0].total) * 100 + "%" }} />
          </div>
          <div className="rank-meta">
            <span>{r.requests}{tr("次用量记录")}</span>
            <span>
              {r.unpriced === r.requests
                ? tr("未定价")
                : money(r.cost) + (r.unpriced ? tr(" + 未定价") : "")}
            </span>
          </div>
        </button>
      ))}
    </div>
  ) : (
    <Empty />
  );
}

function App() {
  const [page, setPage] = useState("overview"),
    [data, setData] = useState(null),
    [filter, setFilter] = useState({ range: "today" }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [progress, setProgress] = useState(null),
    [quotaKey, setQuotaKey] = useState(""),
    [view, setView] = useState("models"),
    [recordPage,setRecordPage] = useState(1),
    [expanded,setExpanded] = useState(null);
  const requestFilter = useRef(null);
  requestFilter.current = {...filter,page,recordPage,pageSize:50};
  const refresh = useRef(null);
  if(!refresh.current) refresh.current=createRefresh(
    async value=>({...await api.snapshot(value), chartRange: value.range, chartTransitionKey: JSON.stringify(value)}),
    next=>{setLanguage(next.settings.language);setData(next);setError('');setProgress(null);},
    e=>setError(e.message),
  );
  function load() { if(api) return refresh.current.request(requestFilter.current); }
  useEffect(() => {
    setRecordPage(1); setExpanded(null);
  },[JSON.stringify(filter)]);
  useEffect(() => {
    load();
  }, [JSON.stringify(filter),page,recordPage]);
  useEffect(() => {
    const timer=setInterval(()=>{if(!document.hidden)load();},30000);
    const wake=()=>{if(!document.hidden)load();};
    document.addEventListener('visibilitychange',wake);
    const off=api?.onUpdate(msg=>{
      if(msg?.type==='progress')setProgress(msg.data);
      if(msg?.type==='error')setError(msg.data);
      if((!msg || ['updated','recovered'].includes(msg.type))&&!document.hidden)load();
    });
    return ()=>{clearInterval(timer);off?.();document.removeEventListener('visibilitychange',wake);};
  },[]);
  useEffect(() => {
    document.documentElement.dataset.theme = data?.settings.theme || "system";
  }, [data?.settings.theme]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const act = async (fn, success) => {
    setBusy(true);
    try {
      const result = await fn();
      if (success && result !== false && result !== null) setToast(success);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const choose = (key, value) => setFilter((f) => ({ ...f, [key]: value }));
  const nav = [
    ["overview", Activity, tr("总览")],
    ["history", ClockCounterClockwise, tr("历史分析")],
    ["quota", ChartLine, tr("账户额度")],
    ["settings", GearSix, tr("设置与价格")],
  ];
  const s = data?.sums,
    p = data?.performance,
    quotas = data?.quotas || [];
  const accountLabel = id => id === "unassigned" ? tr("未归属") : (data?.accounts?.find(a => a.id === id)?.label || tr("未归属"));
  const quotaId = q => `${q.account}:${q.bucket}:${q.slot}`;
  const primary =
    quotas.find((q) => q.account === data?.quotaAccount && q.bucket === "codex" && q.slot === "primary") ||
    quotas[0];
  const selected =
    quotas.find((q) => quotaId(q) === quotaKey) || primary;
  const quotaPoints = selected
    ? (data?.quotaHistory || [])
        .filter((q) => q.account === selected.account && q.bucket === selected.bucket && q.slot === selected.slot)
        .map((q) => ({
          name: date(q.ts),
          time: Date.parse(q.ts),
          remaining: 100 - q.used,
          resets: q.resets,
        }))
    : [];
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><img src={monitorIcon} alt="" /> <span>Codex Monitor</span></div>
        <nav className="glass-nav" aria-label={tr("主导航")} style={{ "--active-index": nav.findIndex(([id]) => id === page) }}>
          <span className="nav-lens" aria-hidden="true" />
          {nav.map(([id, Icon, name]) => (
            <button key={id} className={page === id ? "selected" : ""}
              aria-current={page === id ? "page" : undefined} onClick={() => setPage(id)}>
              <Icon size={20} aria-hidden="true" />{name}
            </button>
          ))}
        </nav>
          <div className="header-actions">
            {data?.settings.muted && <BellSlash size={16} />}
            <span className="status-pill">
              <span className="status-dot" />
              {progress
                ? tr("正在导入")
                : data?.scan?.sourceExists
                  ? tr("采集运行中")
                  : tr("等待数据源")}
            </span>
            <button
              className="icon-button"
              aria-label={tr("刷新数据与额度")}
              title={tr("刷新数据与额度")}
              disabled={busy}
              onClick={() => act(() => api.refresh(), tr("数据已刷新"))}
            >
              <ArrowClockwise size={18} className={busy ? "spin" : ""} />
            </button>
          </div>
        </header>
      <main>
        <div key={page} className={`content${page === "settings" ? " settings-content" : ""}`}>
          <div className="page-title">
            <div>
              <h1>
                {page === "overview"
                  ? tr("用量总览")
                  : page === "history"
                    ? tr("历史分析")
                    : page === "quota"
                      ? tr("账户额度")
                      : tr("设置与价格")}
              </h1>
              <p>
                {page === "overview"
                  ? tr("查看 Token 用量、费用估算和账户剩余额度。")
                  : page === "history"
                    ? tr("按模型、项目和任务查询用量明细。")
                    : page === "quota"
                      ? tr("查看各额度窗口的剩余比例、重置时间及历史记录。")
                      : tr("管理应用外观、数据来源和模型计价规则。")}
              </p>
            </div>
            {page !== "settings" && (
              <button
                className="button"
                disabled={busy || !data}
                onClick={() => act(() => api.export(filter), tr("CSV 已导出"))}
              >
                <DownloadSimple size={16} />{tr("导出 CSV")}</button>
            )}
          </div>
          {!api && (
            <div className="alert">{tr("请使用 Windows 应用启动；浏览器预览不连接本机数据。")}</div>
          )}
          {error && (
            <div className="alert" role="alert">
              <WarningCircle size={18} />
              {systemText(error)}
              <button onClick={load}>{tr("重试")}</button>
            </div>
          )}
          {progress && (
            <div className="notice">{tr("首次导入历史 ·")}{progress.scanned} / {progress.total}{" "}{tr("个文件，完成后自动展示。")}</div>
          )}
          {!data ? (
            <Empty>{tr("正在连接本机采集服务…")}</Empty>
          ) : (
            <>
              {page !== "settings" && (
                <div className="filters">
                  <div className="segmented range-selector" role="group" aria-label={tr("时间范围")}
                    style={{ "--active-index": ["today", "7d", "30d", "all", "custom"].indexOf(filter.range) }}>
                    <span className="range-lens" aria-hidden="true" />
                    {[
                      ["today", tr("今日")],
                      ["7d", tr("近 7 天")],
                      ["30d", tr("近 30 天")],
                      ["all", tr("全部")],
                      ["custom", tr("自定义")],
                    ].map(([id, text]) => (
                      <button
                        key={id}
                        aria-pressed={filter.range === id}
                        className={filter.range === id ? "active" : ""}
                        onClick={() =>
                          setFilter((f) => ({
                            ...f,
                            range: id,
                            ...(id === "custom"
                              ? {
                                  start: new Date().toLocaleDateString("en-CA"),
                                  end: new Date().toLocaleDateString("en-CA"),
                                }
                              : {}),
                          }))
                        }
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                  {filter.range === "custom" && (
                    <div className="date-inputs">
                      <input
                        aria-label={tr("开始日期")}
                        type="date"
                        value={filter.start || ""}
                        onChange={(e) => choose("start", e.target.value)}
                      />
                      <span>{tr("至")}</span>
                      <input
                        aria-label={tr("结束日期")}
                        type="date"
                        value={filter.end || ""}
                        onChange={(e) => choose("end", e.target.value)}
                      />
                    </div>
                  )}
                  <div className="account-control">
                    <UserCircle size={19} aria-hidden="true" />
                    <select aria-label={tr("账号筛选")} value={filter.account || ""}
                      onChange={e => { setFilter(f => ({ range: f.range, start: f.start, end: f.end, account: e.target.value })); setQuotaKey(""); }}>
                      <option value="current">{tr("当前账号")} · {accountLabel(data.currentAccount)}</option>
                      {page !== "quota" && <option value="">{tr("全部账号")}</option>}
                      {page === "quota" && !filter.account && <option value="">{tr("当前账号")} · {accountLabel(data.currentAccount)}</option>}
                      {(data.accounts || []).filter(a => a.id !== data.currentAccount).map(a => <option key={a.id} value={a.id}>{a.label} · {a.id.slice(0, 6)}</option>)}
                      {filter.account === data.currentAccount && <option value={data.currentAccount}>{accountLabel(data.currentAccount)}</option>}
                      <option value="unassigned">{tr("未归属")}</option>
                    </select>
                    <CaretDown size={14} aria-hidden="true" />
                  </div>
                  {page !== "quota" && (
                    <>
                      <select
                        aria-label={tr("模型筛选")}
                        value={filter.model || ""}
                        onChange={(e) => choose("model", e.target.value)}
                      >
                        <option value="">{tr("全部模型")}</option>
                        {data.options.models.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                      <select
                        aria-label={tr("项目筛选")}
                        value={filter.project || ""}
                        onChange={(e) => choose("project", e.target.value)}
                      >
                        <option value="">{tr("全部项目")}</option>
                        {data.options.projects.map((m) => (
                          <option key={m} value={m}>
                            {shortPath(m)}
                          </option>
                        ))}
                      </select>
                      {filter.session && (
                        <button
                          className="chip"
                          onClick={() => choose("session", "")}
                        >{tr("任务")}{filter.session.slice(0, 8)} ×
                        </button>
                      )}
                      {(filter.model || filter.project) && (
                        <button
                          className="text-button"
                          onClick={() =>
                            setFilter({
                              range: filter.range,
                              account: filter.account,
                              start: filter.start,
                              end: filter.end,
                            })
                          }
                        >{tr("清除筛选")}</button>
                      )}
                    </>
                  )}
                </div>
              )}
              {page === "history" && <AccountAssignment data={data} filter={filter} act={act} busy={busy} />}
              {(page === "overview" || page === "history") && (
                <>
                  <div className="metrics">
                    <Metric
                      label={tr("账户剩余额度")}
                      icon={Target}
                      value={primary ? 100 - primary.used : null}
                      format={(n) => (n == null ? "—" : n.toFixed(0) + "%")}
                      foot={
                        primary
                          ? tr("{0} 小时窗口", primary.minutes / 60)
                          : tr("尚未获得额度快照")
                      }
                      onClick={() => setPage("quota")}
                    />
                    <Metric
                      label={
                        filter.range === "today" ? tr("今日 Token") : tr("Token 消耗")
                      }
                      icon={Stack}
                      value={s.total}
                      foot={tr("{0} 次用量记录", full(s.requests))}
                      onClick={() => {
                        setPage("history");
                        setView("tasks");
                      }}
                    />
                    <Metric
                      label={tr("API 等值估算 · USD")}
                      icon={Coins}
                      value={
                        s.requests === s.unpriced && s.requests ? null : s.cost
                      }
                      format={money}
                      foot={
                        s.unpriced
                          ? tr("{0} 条未定价 · 金额不完整", s.unpriced)
                          : tr("按标准短上下文价格估算")
                      }
                      color="var(--amber)"
                      onClick={() => setPage("settings")}
                    />
                    <Metric
                      label={tr("缓存命中率")}
                      icon={Lightning}
                      value={s.cacheRate}
                      format={pct}
                      foot={tr("{0} 缓存输入 tokens", compact(s.cached))}
                      color="var(--blue)"
                      onClick={() => {
                        setPage("history");
                        setView("models");
                      }}
                    />
                  </div>
                  <div className="two-col">
                    <Panel
                      title={tr("Token 使用趋势")}
                      meta={
                        filter.range === "today"
                          ? tr("按本地小时汇总")
                          : tr("按本地日期汇总")
                      }
                    >
                      <div className="legend">
                        <span>
                          <i />{tr("输入（含缓存）")}<b>{compact(s.input)}</b>
                        </span>
                        <span>
                          <i className="blue" />{tr("输出")}<b>{compact(s.output)}</b>
                        </span>
                      </div>
                      <Chart points={data.timeline} range={data.chartRange === "all" ? undefined : data.range} replayKey={data.chartTransitionKey} label={tr("Token 总量趋势")} />
                    </Panel>
                    <Panel title={tr("任务平均输出速率")}>
                      <div className="speed" title={tr("包含工具与等待时间；日志未提供独立生成时长")}>
                        <Animated
                          value={p.latestTps}
                          format={(n) => (n == null ? "—" : n.toFixed(1))}
                        />
                        <span>tokens / sec</span>
                      </div>
                      <div className="speed-context">
                        {p.latestAt
                          ? tr("最近完成 · ") + date(p.latestAt)
                          : tr("尚无带完整耗时的已完成任务")}
                      </div>
                      <div className="mini-stats">
                        <div>
                          <span>{tr("范围内加权平均")}</span>
                          <b>
                            {p.taskTps?.toFixed(1) || "—"} <small>tok/s</small>
                          </b>
                        </div>
                        <div>
                          <span>{tr("近期活跃任务")}</span>
                          <b title={systemText(p.activeReason)}>{p.active}</b>
                        </div>
                      </div>
                    </Panel>
                  </div>
                  {page === "overview" ? (
                    <div className="two-col equal">
                      <Panel title={tr("模型分布")}>
                        <Rank
                          rows={data.models}
                          type="model"
                          onSelect={(m) => {
                            choose("model", m);
                            setPage("history");
                          }}
                        />
                      </Panel>
                      <Panel
                        title={tr("账户额度")}
                        meta={
                          data.quotaStatus?.ok ? tr("在线查询正常") : tr("保留最近快照")
                        }
                      >
                        {quotas.length ? (
                          quotas.slice(0, 4).map((q) => (
                            <div key={q.id}>
                              <span className="bucket-label">{q.bucket}</span>
                              <WindowQuota q={q} />
                            </div>
                          ))
                        ) : (
                          <Empty>{tr("额度尚不可用，请检查 Codex 登录状态")}</Empty>
                        )}
                        {data.quotaStatus?.reason && (
                          <div className="panel-note warning">
                            {systemText(data.quotaStatus.reason)}
                          </div>
                        )}
                      </Panel>
                    </div>
                  ) : (
                    <Panel title={tr("消耗明细")}>
                      <div className="segmented inner">
                        {[
                          ["models", tr("按模型")],
                          ["projects", tr("按项目")],
                          ["tasks", tr("按任务")],
                        ].map(([id, name]) => (
                          <button
                            key={id}
                            className={view === id ? "active" : ""}
                            onClick={() => setView(id)}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>
                                {view === "models"
                                  ? tr("模型")
                                  : view === "projects"
                                    ? tr("项目")
                                    : tr("任务 ID")}
                              </th>
                              <th>{tr("输入")}</th>
                              <th>{tr("缓存")}</th>
                              <th>{tr("输出")}</th>
                              <th>{tr("等值 USD")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data[view].map((r) => (
                              <tr
                                key={r.name}
                                onClick={() =>
                                  choose(
                                    view === "models"
                                      ? "model"
                                      : view === "projects"
                                        ? "project"
                                        : "session",
                                    r.name,
                                  )
                                }
                              >
                                <td>
                                  <button className="table-link" title={r.name}>
                                    {view === "projects"
                                      ? shortPath(r.name)
                                      : r.name}
                                    {r.project && (
                                      <small>{shortPath(r.project)}</small>
                                    )}
                                  </button>
                                </td>
                                <td>{full(r.input)}</td>
                                <td>{full(r.cached)}</td>
                                <td>{full(r.output)}</td>
                                <td>
                                  {r.unpriced === r.requests
                                    ? tr("未定价")
                                    : money(r.cost)}
                                  {r.unpriced > 0 &&
                                    r.unpriced < r.requests && (
                                      <small>{tr("部分未定价")}</small>
                                    )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!data[view].length && <Empty />}
                      </div>
                    </Panel>
                  )}
                  <Panel title={tr("运行指标")}>
                    <div className="performance">
                      {[
                        [
                          tr("请求次数"),
                          full(s.requests),
                          s.legacyRequests
                            ? tr("{0} 次为累计差分估计；仅统计有用量记录的响应", s.legacyRequests)
                            : tr("有用量记录的响应数，不含无用量失败请求"),
                        ],
                        [
                          tr("任务成功率"),
                          pct(p.successRate),
                          tr("完成 ÷（完成 + 失败），取消任务不计入"),
                        ],
                        [
                          tr("失败任务"),
                          full(p.failed),
                          tr("另有 {0} 个取消任务", p.aborted),
                        ],
                        [
                          tr("平均首 Token 延迟"),
                          duration(p.ttft),
                          tr("{0} 个有延迟字段的任务样本", p.ttftSamples),
                        ],
                        [
                          tr("平均任务耗时"),
                          duration(p.avgDuration),
                          tr("仅统计有耗时字段的完成任务"),
                        ],
                        [
                          tr("缓存节省估算"),
                          s.requests === s.unpriced && s.requests
                            ? "—"
                            : money(s.saved),
                          s.unpriced
                            ? tr("部分未定价，金额不完整")
                            : tr("相对普通输入价格的差额"),
                        ],
                        [
                          tr("推理输出"),
                          compact(s.reasoning),
                          tr("已包含在输出 token 中"),
                        ],
                        [
                          tr("缓存写入"),
                          compact(s.cache_write),
                          tr("单独展示原始写入统计"),
                        ],
                      ].map(([a, b, c]) => (
                        <div key={a}>
                          <span>{a}</span>
                          <strong title={c}>{b}</strong>
                        </div>
                      ))}
                    </div>
                  </Panel>
                  {page === "history" && (
                    <Panel title={tr("任务运行记录")} meta={tr("共 {0} 条", data.records?.total || 0)}>
                      <div className="table-scroll">
                        <table className="run-records">
                          <thead>
                            <tr>
                              <th>{tr("开始时间 / 任务")}</th>
                              <th>{tr("模型")}</th>
                              <th>{tr("状态")}</th>
                              <th>{tr("输入 Token")}</th>
                              <th>{tr("输出 Token")}</th>
                              <th>{tr("估算费用")}</th>
                              <th>{tr("耗时")}</th>
                              <th>{tr("首 Token")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.turns.map((t) => (
                              <React.Fragment key={t.id}><tr>
                                <td title={t.id}>
                                  {date(t.started)}
                                  <small>
                                    {t.session.slice(0, 8)} ·{" "}
                                    {shortPath(t.project)}
                                  </small>
                                </td>
                                <td><button className="record-detail" onClick={()=>setExpanded(expanded===t.id?null:t.id)} aria-expanded={expanded===t.id}>
                                  {t.models?.length>1 ? tr("{0} 个模型", t.models.length) : (t.models?.[0]?.model || t.model)}<small>{expanded===t.id?tr("收起明细"):tr("查看明细")}</small>
                                </button></td>
                                <td>
                                  {
                                    {
                                      completed: tr("已完成"),
                                      failed: tr("失败"),
                                      aborted: tr("已取消"),
                                      running: tr("未结束"),
                                    }[t.status]
                                  }
                                </td>
                                <td title={tr("缓存输入 {0} tokens", full(t.cached))}>{t.requests ? full(t.input) : "—"}<small>{recordMoney(t.inputCost, t)}</small></td>
                                <td>{t.requests ? full(t.output) : "—"}<small>{recordMoney(t.outputCost, t)}</small></td>
                                <td>{recordMoney(t.cost, t)}</td>
                                <td>{duration(t.duration)}</td>
                                <td>{duration(t.ttft)}</td>
                              </tr>
                              {expanded===t.id && <tr className="record-expanded"><td colSpan={8}>
                                <div>{tr("完整任务 ·")}{t.id}</div>
                                <TaskAccount record={t} data={data} filter={filter} act={act} busy={busy} />
                                <div className="model-details">{t.models?.map(m=><div key={m.model}>
                                  <strong>{m.model}</strong><span>{tr("输入 {0} · 缓存 {1} · 输出 {2}", full(m.input), full(m.cached), full(m.output))}</span>
                                  <span>{tr("输入 {0} · 输出 {1} · 合计 {2}", recordMoney(m.inputCost,m), recordMoney(m.outputCost,m), recordMoney(m.cost,m))}</span>
                                </div>)}</div>
                                {!t.models?.length && <span>{tr("暂无用量记录")}</span>}
                              </td></tr>}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="pagination">
                        <button className="button" disabled={!data.records || data.records.page<=1} onClick={()=>{setRecordPage(data.records.page-1);setExpanded(null);}}>{tr("上一页")}</button>
                        <span>{tr("第 {0} / {1} 页 · 每页 50 条", data.records?.page || 1, data.records?.pages || 1)}</span>
                        <button className="button" disabled={!data.records || data.records.page>=data.records.pages} onClick={()=>{setRecordPage(data.records.page+1);setExpanded(null);}}>{tr("下一页")}</button>
                      </div>
                    </Panel>
                  )}
                </>
              )}
              {page === "quota" && (
                <>
                  {data.quotaStatus?.reason && (
                    <div className="alert">{systemText(data.quotaStatus.reason)}</div>
                  )}
                  <div className="quota-grid">
                    {quotas.map((q) => (
                      <Panel
                        key={q.id}
                        title={q.bucket}
                        meta={q.plan?.toUpperCase()}
                      >
                        <WindowQuota q={q} />
                      </Panel>
                    ))}
                  </div>
                  <Panel title={tr("剩余额度历史")} meta={data.quotaHistorySamples>data.quotaHistory.length ? tr("已保留采样端点与峰谷") : undefined}>
                    <div className="segmented quota-window-selector" role="group" aria-label={tr("额度窗口")}
                      style={{ "--active-index": Math.max(0, quotas.findIndex(q => quotaId(q) === quotaId(selected || {}))), "--segment-count": Math.max(1, quotas.length) }}>
                      {quotas.length > 0 && <span className="range-lens" aria-hidden="true" />}
                      {quotas.map(q => <button key={q.id} className={q.id === selected?.id ? "active" : ""}
                        aria-pressed={q.id === selected?.id} onClick={() => setQuotaKey(quotaId(q))}>
                        {q.bucket !== "codex" ? `${q.bucket} · ` : ""}{q.minutes >= 1440 ? tr("{0} 天窗口", q.minutes / 1440) : tr("{0} 小时窗口", q.minutes / 60)}
                      </button>)}
                    </div>
                    <Chart
                      points={quotaPoints}
                      range={data.chartRange === "all" ? undefined : data.range}
                      replayKey={`${data.chartTransitionKey}:${selected?.account}:${selected?.bucket}:${selected?.slot}`}
                      value="remaining"
                      step
                      percent
                      label={tr("剩余额度历史曲线")}
                    />
                  </Panel>
                </>
              )}
              {page === "settings" && (
                <Settings data={data} act={act} busy={busy} />
              )}
              <footer>
                <span>
                  <Database size={13} />{tr("本机数据 ·")}{" "}
                  {data.coverage.first
                    ? date(data.coverage.first) + tr(" 起")
                    : tr("等待首条记录")}{" "}
                  · {full(data.coverage.records)}{tr("条")}</span>
                <span>
                  {data.scan?.errors > 0
                    ? tr("{0} 条解析异常 · ", data.scan.errors)
                    : ""}{tr("采集更新")}{date(data.scan?.lastScan)}
                </span>
              </footer>
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

function attributionAccount(data, filter) {
  const id = filter.account === "current" ? data.currentAccount : filter.account;
  return data.accounts?.find(a => a.id === id);
}
function TaskAccount({ record, data, filter, act, busy }) {
  const account = attributionAccount(data, filter);
  return account ? <button className="button" disabled={busy}
    onClick={() => act(() => api.assignAccount({account:account.id,turn:record.id,session:record.session,range:"all"}), tr("账号归属已更新"))}>
    {tr("归属至 {0}", account.label)}
  </button> : null;
}
function AccountAssignment({ data, filter, act, busy }) {
  const account = attributionAccount(data, filter);
  return account ? <div className="attribution-toolbar">
    <span>{tr("历史记录归属")}</span>
    <button className="text-button" disabled={busy} title={tr("缺少账号信息的旧记录保留为未归属。确认日期范围后，可将该范围内全部未归属用量、任务和额度记录指定给一个账号。")}
      onClick={() => act(() => api.assignAccount({ range: filter.range, start: filter.start, end: filter.end, account: account.id }), tr("账号归属已更新"))}>
      {tr("将未归属记录归入 {0}", account.label)}
    </button>
  </div> : null;
}
function AccountManager({ data, act, busy }) {
  const [label, setLabel] = useState("");
  return <Panel title={tr("账号管理")} className="settings-wide">
    <p>{tr("自动识别本机登录账号；仅保存账号标识摘要和显示名称，不保存登录凭据。可添加历史账号并修改显示名称。")}</p>
    <form className="button-row" onSubmit={e => { e.preventDefault(); act(async () => { const result = await api.account({ label }); setLabel(""); return result; }, tr("账号已保存")); }}>
      <input aria-label={tr("账号名称")} placeholder={tr("账号名称")} required maxLength={100} value={label} onChange={e => setLabel(e.target.value)} />
      <button className="button" disabled={busy || !label.trim()}>{tr("添加账号")}</button>
    </form>
    {(data.accounts || []).map(a => <AccountName key={a.id} account={a} current={a.id === data.currentAccount} act={act} busy={busy} />)}
  </Panel>;
}
function AccountName({ account, current, act, busy }) {
  const [label, setLabel] = useState(account.label);
  return <form className="setting-row" onSubmit={e => { e.preventDefault(); act(() => api.account({ id: account.id, label }), tr("账号已保存")); }}>
    <input aria-label={`${tr("账号名称")} ${account.id.slice(0, 6)}`} required maxLength={100} value={label} onChange={e => setLabel(e.target.value)} />
    <span>{account.id.slice(0, 6)}{current ? ` · ${tr("当前登录")}` : ""}</span>
    <button className="button" disabled={busy || label === account.label || !label.trim()}>{tr("保存")}</button>
  </form>;
}

function Settings({ data, act, busy }) {
  const [price, setPrice] = useState({
    model: "",
    input: "",
    cached: "",
    output: "",
    cache_write: "0",
    effective: "1970-01-01T00:00",
  });
  const set = (k, v) => setPrice((p) => ({ ...p, [k]: v }));
  return (
    <div className="settings-layout">
      <Panel title={tr("外观与后台")}>
        <div className="setting-row">
          <div><b>{tr("语言")}</b><small>{tr("界面语言立即生效，并在下次启动时保留")}</small></div>
          <select aria-label={tr("语言")} value={data.settings.language || "zh-CN"}
            disabled={busy} onChange={e => act(() => api.settings({ language: e.target.value }))}>
            <option value="zh-CN">简体中文</option><option value="en">English</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <b>{tr("主题")}</b>
          </div>
          <div className="segmented">
            {[
              ["system", MonitorIcon, tr("系统")],
              ["light", Sun, tr("浅色")],
              ["dark", Moon, tr("深色")],
            ].map(([id, Icon, name]) => (
              <button
                key={id}
                aria-pressed={data.settings.theme === id}
                className={data.settings.theme === id ? "active" : ""}
                onClick={() => act(() => api.settings({ theme: id }))}
              >
                <Icon size={16} />
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <b>{tr("开机启动")}</b>
            <small>{tr("登录 Windows 后静默进入托盘")}</small>
          </div>
          <input
            aria-label={tr("开机启动")}
            type="checkbox"
            checked={data.settings.autoStart}
            onChange={(e) =>
              act(() => api.settings({ autoStart: e.target.checked }))
            }
          />
        </div>
        <div className="setting-row">
          <div>
            <b>{tr("静音额度提醒")}</b>
            <small>{tr("剩余 20% 和 10% 时提醒")}</small>
          </div>
          <input
            aria-label={tr("静音额度提醒")}
            type="checkbox"
            checked={data.settings.muted}
            onChange={(e) =>
              act(() => api.settings({ muted: e.target.checked }))
            }
          />
        </div>
        <div className="setting-row">
          <div>
            <b>{tr("额度查询间隔")}</b>
          </div>
          <select
            aria-label={tr("额度查询间隔")}
            value={data.settings.quotaInterval}
            onChange={(e) =>
              act(() => api.settings({ quotaInterval: Number(e.target.value) }))
            }
          >
            {[60, 120, 300].map((n) => (
              <option key={n} value={n}>
                {n / 60}{tr("分钟")}</option>
            ))}
          </select>
        </div>
      </Panel>
      <Panel title={tr("数据来源")}>
        <div className="path-row">
          <span>{tr("Codex 数据目录")}</span>
          <code>{data.paths.home}</code>
        </div>
        <div className="path-row">
          <span>{tr("监测数据库目录")}</span>
          <code>{data.paths.data}</code>
        </div>
        <div className="path-row">
          <span>{tr("额度查询程序")}</span>
          <code>
            {data.settings.codexExecutable || tr("自动发现本机 Codex App Server")}
          </code>
        </div>
        <div className="button-row">
          <button
            className="button"
            onClick={() =>
              act(async () => {
                const p = await api.pickExecutable();
                if (p) return api.settings({ codexExecutable: p });
                return null;
              }, tr("查询程序已更新"))
            }
          >
            <FolderOpen size={16} />{tr("选择 codex.exe")}</button>
          <button
            className="button"
            onClick={() =>
              act(() => api.settings({ codexExecutable: "" }), tr("已恢复自动发现"))
            }
          >{tr("恢复自动发现")}</button>
          <button className="button" onClick={() => api.openData()}>{tr("打开数据目录")}</button>
        </div>
      </Panel>
      <Panel title={tr("模型价格")} meta={tr("USD / 百万 tokens")} className="settings-wide">
        <div className="notice">{tr("按 API 标准价估算，不代表订阅账单。")}</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () =>
                api.price({
                  ...price,
                  input: Number(price.input),
                  cached: Number(price.cached),
                  output: Number(price.output),
                  cache_write: Number(price.cache_write),
                  effective: new Date(price.effective).toISOString(),
                }),
              tr("价格版本已保存"),
            );
          }}
        >
          <div className="price-form">
            <label>{tr("模型")}<input
                list="model-options"
                required
                placeholder={tr("例如 gpt-5.5")}
                value={price.model}
                onChange={(e) => set("model", e.target.value)}
              />
              <datalist id="model-options">
                {data.options.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            {[
              ["input", tr("普通输入")],
              ["cached", tr("缓存输入")],
              ["output", tr("输出")],
              ["cache_write", tr("缓存写入")],
            ].map(([k, t]) => (
              <label key={k}>
                {t}
                <input
                  required
                  type="number"
                  min="0"
                  max="100000"
                  step="any"
                  value={price[k]}
                  onChange={(e) => set(k, e.target.value)}
                />
              </label>
            ))}
            <label>{tr("生效时间")}<input
                required
                type="datetime-local"
                value={price.effective}
                onChange={(e) => set("effective", e.target.value)}
              />
            </label>
          </div>
          <button className="button primary" type="submit" disabled={busy}>{tr("保存价格版本")}</button>
        </form>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{tr("模型 / 版本")}</th>
                <th>{tr("输入")}</th>
                <th>{tr("缓存")}</th>
                <th>{tr("输出")}</th>
                <th>{tr("写入")}</th>
                <th>{tr("生效时间")}</th>
              </tr>
            </thead>
            <tbody>
              {data.prices
                .filter((p) => !p.retired)
                .map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="table-link"
                        onClick={() =>
                          setPrice({
                            model: p.model,
                            input: p.input,
                            cached: p.cached,
                            output: p.output,
                            cache_write: p.cache_write,
                            effective:
                              new Date().toLocaleDateString("en-CA") + "T00:00",
                          })
                        }
                      >
                        {p.model}{" "}
                        <small>
                          v{p.id} · {systemText(p.source)}
                        </small>
                      </button>
                    </td>
                    <td>${p.input}</td>
                    <td>${p.cached}</td>
                    <td>${p.output}</td>
                    <td>${p.cache_write}</td>
                    <td>
                      {p.effective.startsWith("1970")
                        ? tr("全部历史基准")
                        : date(p.effective)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <AccountManager data={data} act={act} busy={busy} />
      <Panel title={tr("历史管理")} className="settings-wide">
        <div className="setting-row">
          <div>
            <b>{tr("清空监测历史")}</b>
            <small>{tr("只删除本应用统计；Codex 原始记录、价格和设置保留。之后仅采集新增记录。")}</small>
          </div>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => act(() => api.clear(), tr("监测历史已清空"))}
          >{tr("清空历史")}</button>
        </div>
        {data.settings.clearedAt && (
          <p className="panel-note">{tr("上次清空：")}{date(data.settings.clearedAt)}
          </p>
        )}
      </Panel>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
