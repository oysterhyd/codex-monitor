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
  CaretRight,
} from "@phosphor-icons/react";
import "./style.css";
import { createRefresh } from "./refresh.mjs";

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
const recordMoney = (n, t) => !t.requests ? "—" : n == null ? "未定价" :
  "$" + n.toLocaleString("en", { minimumFractionDigits: 4, maximumFractionDigits: 6 }) + (t.unpriced ? " + 未定价" : "");
const date = (t) =>
  t
    ? new Date(t).toLocaleString("zh-CN", {
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
      ? (n / 1000).toFixed(1) + " 秒"
      : (n / 60000).toFixed(1) + " 分钟";
const shortPath = (p) => p?.split(/[\\/]/).filter(Boolean).at(-1) || p;

function Animated({ value, format = compact }) {
  const [shown, setShown] = useState(value),
    prev = useRef(value);
  useEffect(() => {
    if (
      value == null ||
      prev.current == null ||
      document.hidden ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
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
      <span>{children || "这个时间范围内还没有记录"}</span>
    </div>
  );
}
function Chart({
  points,
  value = "total",
  color = "var(--accent)",
  percent = false,
  label,
}) {
  const [hover, setHover] = useState(null);
  if (!points.length) return <Empty />;
  const max = percent ? 100 : Math.max(1, ...points.map((p) => p[value] || 0));
  const first = points[0].time,
    last = points.at(-1).time;
  const xy = points.map((p, i) => [
    44 +
      (last > first
        ? (p.time - first) / (last - first)
        : i / Math.max(1, points.length - 1)) *
        836,
    150 - ((p[value] || 0) / max) * 128,
  ]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const chosen = hover == null ? null : points[hover];
  return (
    <div className="chart-wrap">
      <svg
        viewBox="0 0 920 190"
        role="img"
        aria-label={label || "用量趋势"}
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
        <path
          d={`${line} L${xy.at(-1)[0]},150 L44,150 Z`}
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
              r={hover === i ? 5 : points.length < 30 ? 2.5 : 0}
              fill={color}
            />
          </g>
        ))}
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
        <h2>{title}</h2>
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
            ? `${Math.round(q.minutes / 1440)} 天窗口`
            : `${q.minutes / 60} 小时窗口`}
        </span>
        <b>
          {remaining.toFixed(0)}
          <small>% 剩余</small>
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
            ? "已过重置时间，等待新快照"
            : "重置 " + date(q.resets ? q.resets * 1000 : null)}
        </span>
        <span>
          {q.source} · {date(q.ts)}
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
            <span>{r.requests} 次用量记录</span>
            <span>
              {r.unpriced === r.requests
                ? "未定价"
                : money(r.cost) + (r.unpriced ? " + 未定价" : "")}
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
    value=>api.snapshot(value),
    next=>{setData(next);setError('');setProgress(null);},
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
    ["overview", Activity, "总览"],
    ["history", ClockCounterClockwise, "历史分析"],
    ["quota", ChartLine, "账户额度"],
    ["settings", GearSix, "设置与价格"],
  ];
  const s = data?.sums,
    p = data?.performance,
    quotas = data?.quotas || [];
  const primary =
    quotas.find((q) => q.bucket === "codex" && q.slot === "primary") ||
    quotas[0];
  const selected =
    quotas.find((q) => q.bucket + ":" + q.slot === quotaKey) || primary;
  const quotaPoints = selected
    ? (data?.quotaHistory || [])
        .filter((q) => q.bucket === selected.bucket && q.slot === selected.slot)
        .map((q) => ({
          name: date(q.ts),
          time: Date.parse(q.ts),
          remaining: 100 - q.used,
        }))
    : [];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Activity size={24} weight="bold" />
          </div>
          <div>
            Codex<span>MONITOR</span>
          </div>
        </div>
        <div className="nav-label">工作空间</div>
        <nav>
          {nav.map(([id, Icon, name]) => (
            <button
              key={id}
              className={page === id ? "selected" : ""}
              onClick={() => setPage(id)}
            >
              <Icon size={20} weight={page === id ? "duotone" : "regular"} />
              {name}
              {page === id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local">
            <span className="status-dot" />
            本机监测<small>数据仅保存在此设备</small>
          </div>
          <div className="account">
            <div className="avatar">C</div>
            <div>
              ChatGPT 订阅
              <span>
                {primary?.plan ? primary.plan.toUpperCase() : "账户状态待获取"}{" "}
                · Windows
              </span>
            </div>
          </div>
          <span className="version">
            Codex Monitor / {data?.version || "0.1.0"}
          </span>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            我的设备
            <CaretRight size={12} />
            {nav.find((x) => x[0] === page)?.[2]}
          </div>
          <div className="header-actions">
            {data?.settings.muted && <BellSlash size={16} />}
            <span className="status-pill">
              <span className="status-dot" />
              {progress
                ? "正在导入"
                : data?.scan?.sourceExists
                  ? "采集运行中"
                  : "等待数据源"}
            </span>
            <button
              className="icon-button"
              aria-label="刷新数据与额度"
              title="刷新数据与额度"
              disabled={busy}
              onClick={() => act(() => api.refresh(), "数据已刷新")}
            >
              <ArrowClockwise size={18} className={busy ? "spin" : ""} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-title">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "YOUR CODEX, AT A GLANCE"
                  : "LOCAL ANALYTICS"}
              </div>
              <h1>
                {page === "overview"
                  ? "每一份消耗，都看得见。"
                  : page === "history"
                    ? "回看你的使用轨迹。"
                    : page === "quota"
                      ? "额度，心中有数。"
                      : "让监测适合你的习惯。"}
              </h1>
              <p>
                {page === "overview"
                  ? "账户额度与本机用量，一处掌握。"
                  : page === "history"
                    ? "按模型、项目和任务，了解 token 流向。"
                    : page === "quota"
                      ? "保留实际快照，观察各额度窗口的变化。"
                      : "数据留在本机，费用口径由你掌控。"}
              </p>
            </div>
            {page !== "settings" && (
              <button
                className="button"
                disabled={busy || !data}
                onClick={() => act(() => api.export(filter), "CSV 已导出")}
              >
                <DownloadSimple size={16} />
                导出 CSV
              </button>
            )}
          </div>
          {!api && (
            <div className="alert">
              请使用 Windows 应用启动；浏览器预览不连接本机数据。
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              <WarningCircle size={18} />
              {error}
              <button onClick={load}>重试</button>
            </div>
          )}
          {progress && (
            <div className="notice">
              首次导入历史 · {progress.scanned} / {progress.total}{" "}
              个文件，完成后自动展示。
            </div>
          )}
          {!data ? (
            <Empty>正在连接本机采集服务…</Empty>
          ) : (
            <>
              {page !== "settings" && (
                <div className="filters">
                  <div className="segmented">
                    {[
                      ["today", "今日"],
                      ["7d", "近 7 天"],
                      ["30d", "近 30 天"],
                      ["all", "全部"],
                      ["custom", "自定义"],
                    ].map(([id, text]) => (
                      <button
                        key={id}
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
                        aria-label="开始日期"
                        type="date"
                        value={filter.start || ""}
                        onChange={(e) => choose("start", e.target.value)}
                      />
                      <span>至</span>
                      <input
                        aria-label="结束日期"
                        type="date"
                        value={filter.end || ""}
                        onChange={(e) => choose("end", e.target.value)}
                      />
                    </div>
                  )}
                  {page !== "quota" && (
                    <>
                      <select
                        aria-label="模型筛选"
                        value={filter.model || ""}
                        onChange={(e) => choose("model", e.target.value)}
                      >
                        <option value="">全部模型</option>
                        {data.options.models.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                      <select
                        aria-label="项目筛选"
                        value={filter.project || ""}
                        onChange={(e) => choose("project", e.target.value)}
                      >
                        <option value="">全部项目</option>
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
                        >
                          任务 {filter.session.slice(0, 8)} ×
                        </button>
                      )}
                      {(filter.model || filter.project) && (
                        <button
                          className="text-button"
                          onClick={() =>
                            setFilter({
                              range: filter.range,
                              start: filter.start,
                              end: filter.end,
                            })
                          }
                        >
                          清除筛选
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {(page === "overview" || page === "history") && (
                <>
                  <div className="metrics">
                    <Metric
                      label="账户剩余额度"
                      icon={Target}
                      value={primary ? 100 - primary.used : null}
                      format={(n) => (n == null ? "—" : n.toFixed(0) + "%")}
                      foot={
                        primary
                          ? `${primary.minutes / 60} 小时窗口`
                          : "尚未获得额度快照"
                      }
                      onClick={() => setPage("quota")}
                    />
                    <Metric
                      label={
                        filter.range === "today" ? "今日 Token" : "Token 消耗"
                      }
                      icon={Stack}
                      value={s.total}
                      foot={`${full(s.requests)} 次用量记录`}
                      onClick={() => {
                        setPage("history");
                        setView("tasks");
                      }}
                    />
                    <Metric
                      label="API 等值估算 · USD"
                      icon={Coins}
                      value={
                        s.requests === s.unpriced && s.requests ? null : s.cost
                      }
                      format={money}
                      foot={
                        s.unpriced
                          ? `${s.unpriced} 条未定价 · 金额不完整`
                          : "按标准短上下文价格估算"
                      }
                      color="var(--amber)"
                      onClick={() => setPage("settings")}
                    />
                    <Metric
                      label="缓存命中率"
                      icon={Lightning}
                      value={s.cacheRate}
                      format={pct}
                      foot={`${compact(s.cached)} 缓存输入 tokens`}
                      color="var(--blue)"
                      onClick={() => {
                        setPage("history");
                        setView("models");
                      }}
                    />
                  </div>
                  <div className="two-col">
                    <Panel
                      title="Token 使用趋势"
                      meta={
                        filter.range === "today"
                          ? "按本地小时汇总"
                          : "按本地日期汇总"
                      }
                    >
                      <div className="legend">
                        <span>
                          <i />
                          输入（含缓存） <b>{compact(s.input)}</b>
                        </span>
                        <span>
                          <i className="blue" />
                          输出 <b>{compact(s.output)}</b>
                        </span>
                      </div>
                      <Chart points={data.timeline} label="Token 总量趋势" />
                    </Panel>
                    <Panel title="任务平均输出速率">
                      <div className="speed" title="包含工具与等待时间；日志未提供独立生成时长">
                        <Animated
                          value={p.latestTps}
                          format={(n) => (n == null ? "—" : n.toFixed(1))}
                        />
                        <span>tokens / sec</span>
                      </div>
                      <div className="speed-context">
                        {p.latestAt
                          ? "最近完成 · " + date(p.latestAt)
                          : "尚无带完整耗时的已完成任务"}
                      </div>
                      <div className="mini-stats">
                        <div>
                          <span>范围内加权平均</span>
                          <b>
                            {p.taskTps?.toFixed(1) || "—"} <small>tok/s</small>
                          </b>
                        </div>
                        <div>
                          <span>近期活跃任务</span>
                          <b title={p.activeReason}>{p.active}</b>
                        </div>
                      </div>
                    </Panel>
                  </div>
                  {page === "overview" ? (
                    <div className="two-col equal">
                      <Panel title="模型分布">
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
                        title="账户额度"
                        meta={
                          data.quotaStatus?.ok ? "在线查询正常" : "保留最近快照"
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
                          <Empty>额度尚不可用，请检查 Codex 登录状态</Empty>
                        )}
                        {data.quotaStatus?.reason && (
                          <div className="panel-note warning">
                            {data.quotaStatus.reason}
                          </div>
                        )}
                      </Panel>
                    </div>
                  ) : (
                    <Panel title="消耗明细">
                      <div className="segmented inner">
                        {[
                          ["models", "按模型"],
                          ["projects", "按项目"],
                          ["tasks", "按任务"],
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
                                  ? "模型"
                                  : view === "projects"
                                    ? "项目"
                                    : "任务 ID"}
                              </th>
                              <th>输入</th>
                              <th>缓存</th>
                              <th>输出</th>
                              <th>等值 USD</th>
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
                                    ? "未定价"
                                    : money(r.cost)}
                                  {r.unpriced > 0 &&
                                    r.unpriced < r.requests && (
                                      <small>部分未定价</small>
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
                  <Panel title="运行指标">
                    <div className="performance">
                      {[
                        [
                          "请求次数",
                          full(s.requests),
                          s.legacyRequests
                            ? `${s.legacyRequests} 次为累计差分估计；仅统计有用量记录的响应`
                            : "有用量记录的响应数，不含无用量失败请求",
                        ],
                        [
                          "任务成功率",
                          pct(p.successRate),
                          "完成 ÷（完成 + 失败），取消任务不计入",
                        ],
                        [
                          "失败任务",
                          full(p.failed),
                          `另有 ${p.aborted} 个取消任务`,
                        ],
                        [
                          "平均首 Token 延迟",
                          duration(p.ttft),
                          `${p.ttftSamples} 个有延迟字段的任务样本`,
                        ],
                        [
                          "平均任务耗时",
                          duration(p.avgDuration),
                          "仅统计有耗时字段的完成任务",
                        ],
                        [
                          "缓存节省估算",
                          s.requests === s.unpriced && s.requests
                            ? "—"
                            : money(s.saved),
                          s.unpriced
                            ? "部分未定价，金额不完整"
                            : "相对普通输入价格的差额",
                        ],
                        [
                          "推理输出",
                          compact(s.reasoning),
                          "已包含在输出 token 中",
                        ],
                        [
                          "缓存写入",
                          compact(s.cache_write),
                          "单独展示原始写入统计",
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
                    <Panel title="任务运行记录" meta={`共 ${data.records?.total || 0} 条`}>
                      <div className="table-scroll">
                        <table className="run-records">
                          <thead>
                            <tr>
                              <th>开始时间 / 任务</th>
                              <th>模型</th>
                              <th>状态</th>
                              <th>输入 Token</th>
                              <th>输出 Token</th>
                              <th>估算费用</th>
                              <th>耗时</th>
                              <th>首 Token</th>
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
                                  {t.models?.length>1 ? `${t.models.length} 个模型` : (t.models?.[0]?.model || t.model)}<small>{expanded===t.id?'收起明细':'查看明细'}</small>
                                </button></td>
                                <td>
                                  {
                                    {
                                      completed: "已完成",
                                      failed: "失败",
                                      aborted: "已取消",
                                      running: "未结束",
                                    }[t.status]
                                  }
                                </td>
                                <td title={`缓存输入 ${full(t.cached)} tokens`}>{t.requests ? full(t.input) : "—"}<small>{recordMoney(t.inputCost, t)}</small></td>
                                <td>{t.requests ? full(t.output) : "—"}<small>{recordMoney(t.outputCost, t)}</small></td>
                                <td>{recordMoney(t.cost, t)}</td>
                                <td>{duration(t.duration)}</td>
                                <td>{duration(t.ttft)}</td>
                              </tr>
                              {expanded===t.id && <tr className="record-expanded"><td colSpan={8}>
                                <div>完整任务 · {t.id}</div>
                                <div className="model-details">{t.models?.map(m=><div key={m.model}>
                                  <strong>{m.model}</strong><span>输入 {full(m.input)} · 缓存 {full(m.cached)} · 输出 {full(m.output)}</span>
                                  <span>输入 {recordMoney(m.inputCost,m)} · 输出 {recordMoney(m.outputCost,m)} · 合计 {recordMoney(m.cost,m)}</span>
                                </div>)}</div>
                                {!t.models?.length && <span>暂无用量记录</span>}
                              </td></tr>}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="pagination">
                        <button className="button" disabled={!data.records || data.records.page<=1} onClick={()=>{setRecordPage(data.records.page-1);setExpanded(null);}}>上一页</button>
                        <span>第 {data.records?.page || 1} / {data.records?.pages || 1} 页 · 每页 50 条</span>
                        <button className="button" disabled={!data.records || data.records.page>=data.records.pages} onClick={()=>{setRecordPage(data.records.page+1);setExpanded(null);}}>下一页</button>
                      </div>
                    </Panel>
                  )}
                </>
              )}
              {page === "quota" && (
                <>
                  {data.quotaStatus?.reason && (
                    <div className="alert">{data.quotaStatus.reason}</div>
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
                  <Panel title="剩余额度历史" meta={data.quotaHistorySamples>data.quotaHistory.length ? "已保留采样端点与峰谷" : undefined}>
                    <select
                      aria-label="额度窗口"
                      value={
                        selected ? selected.bucket + ":" + selected.slot : ""
                      }
                      onChange={(e) => setQuotaKey(e.target.value)}
                    >
                      {quotas.map((q) => (
                        <option key={q.id} value={q.bucket + ":" + q.slot}>
                          {q.bucket} · {q.minutes / 60} 小时
                        </option>
                      ))}
                    </select>
                    <Chart
                      points={quotaPoints}
                      value="remaining"
                      percent
                      label="剩余额度历史曲线"
                    />
                  </Panel>
                </>
              )}
              {page === "settings" && (
                <Settings data={data} act={act} busy={busy} />
              )}
              <footer>
                <span>
                  <Database size={13} />
                  本机数据 ·{" "}
                  {data.coverage.first
                    ? date(data.coverage.first) + " 起"
                    : "等待首条记录"}{" "}
                  · {full(data.coverage.records)} 条
                </span>
                <span>
                  {data.scan?.errors > 0
                    ? `${data.scan.errors} 条解析异常 · `
                    : ""}
                  采集更新 {date(data.scan?.lastScan)}
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
      <Panel title="外观与后台">
        <div className="setting-row">
          <div>
            <b>主题</b>
          </div>
          <div className="segmented">
            {[
              ["system", MonitorIcon, "系统"],
              ["light", Sun, "浅色"],
              ["dark", Moon, "深色"],
            ].map(([id, Icon, name]) => (
              <button
                key={id}
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
            <b>开机启动</b>
            <small>登录 Windows 后静默进入托盘</small>
          </div>
          <input
            aria-label="开机启动"
            type="checkbox"
            checked={data.settings.autoStart}
            onChange={(e) =>
              act(() => api.settings({ autoStart: e.target.checked }))
            }
          />
        </div>
        <div className="setting-row">
          <div>
            <b>静音额度提醒</b>
            <small>剩余 20% 和 10% 时提醒</small>
          </div>
          <input
            aria-label="静音额度提醒"
            type="checkbox"
            checked={data.settings.muted}
            onChange={(e) =>
              act(() => api.settings({ muted: e.target.checked }))
            }
          />
        </div>
        <div className="setting-row">
          <div>
            <b>额度查询间隔</b>
          </div>
          <select
            aria-label="额度查询间隔"
            value={data.settings.quotaInterval}
            onChange={(e) =>
              act(() => api.settings({ quotaInterval: Number(e.target.value) }))
            }
          >
            {[60, 120, 300].map((n) => (
              <option key={n} value={n}>
                {n / 60} 分钟
              </option>
            ))}
          </select>
        </div>
      </Panel>
      <Panel title="数据来源">
        <div className="path-row">
          <span>Codex 数据目录</span>
          <code>{data.paths.home}</code>
        </div>
        <div className="path-row">
          <span>监测数据库目录</span>
          <code>{data.paths.data}</code>
        </div>
        <div className="path-row">
          <span>额度查询程序</span>
          <code>
            {data.settings.codexExecutable || "自动发现本机 Codex App Server"}
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
              }, "查询程序已更新")
            }
          >
            <FolderOpen size={16} />
            选择 codex.exe
          </button>
          <button
            className="button"
            onClick={() =>
              act(() => api.settings({ codexExecutable: "" }), "已恢复自动发现")
            }
          >
            恢复自动发现
          </button>
          <button className="button" onClick={() => api.openData()}>
            打开数据目录
          </button>
        </div>
      </Panel>
      <Panel title="模型价格" meta="USD / 百万 tokens">
        <div className="notice">
          按 API 标准价估算，不代表订阅账单。
        </div>
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
              "价格版本已保存",
            );
          }}
        >
          <div className="price-form">
            <label>
              模型
              <input
                list="model-options"
                required
                placeholder="例如 gpt-5.5"
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
              ["input", "普通输入"],
              ["cached", "缓存输入"],
              ["output", "输出"],
              ["cache_write", "缓存写入"],
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
            <label>
              生效时间
              <input
                required
                type="datetime-local"
                value={price.effective}
                onChange={(e) => set("effective", e.target.value)}
              />
            </label>
          </div>
          <button className="button primary" type="submit" disabled={busy}>
            保存价格版本
          </button>
        </form>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>模型 / 版本</th>
                <th>输入</th>
                <th>缓存</th>
                <th>输出</th>
                <th>写入</th>
                <th>生效时间</th>
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
                          v{p.id} · {p.source}
                        </small>
                      </button>
                    </td>
                    <td>${p.input}</td>
                    <td>${p.cached}</td>
                    <td>${p.output}</td>
                    <td>${p.cache_write}</td>
                    <td>
                      {p.effective.startsWith("1970")
                        ? "全部历史基准"
                        : date(p.effective)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="历史管理">
        <div className="setting-row">
          <div>
            <b>清空监测历史</b>
            <small>
              只删除本应用统计；Codex
              原始记录、价格和设置保留。之后仅采集新增记录。
            </small>
          </div>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => act(() => api.clear(), "监测历史已清空")}
          >
            清空历史
          </button>
        </div>
        {data.settings.clearedAt && (
          <p className="panel-note">
            上次清空：{date(data.settings.clearedAt)}
          </p>
        )}
      </Panel>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
