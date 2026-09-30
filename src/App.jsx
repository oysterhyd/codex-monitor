import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {Pulse as Activity, ChartLine, ClockCounterClockwise, GearSix, ArrowClockwise, DownloadSimple, CheckCircle, WarningCircle, Database, BellSlash, Lightning, Coins, Stack, Target, FrameCorners, CalendarDots, MagnifyingGlass, X} from "@phosphor-icons/react";
import { tr, setLanguage, systemText } from "./i18n.mjs";
import { compact, full, money, pct, wholePercent, date, duration, prefersReducedMotion } from "./format.mjs";
import monitorIcon from "../assets/monitor-glass.png";
import {createRefresh} from "./refresh.mjs";
import {Animated, Empty, Panel, Chart, Metric, WindowQuota, Rank, Breakdown, RunRecords} from "./components.jsx";
import {Settings} from "./Settings.jsx";
import {ActivityCalendar, ActivityDetails} from "./Activity.jsx";
import {FilterBar} from "./FilterBar.jsx";
import {CommandPalette} from "./CommandPalette.jsx";
import {localDay} from "./activity-calendar.mjs";
const api = window.monitor;
export function App() {
  const [widgetMode, setWidgetMode] = useState(false), [widgetPending, setWidgetPending] = useState(false);
  useEffect(() => {
    if (!api) return;
    let alive = true, changed = false;
    const unsubscribe = api.onWidgetMode(on => { changed = true; setWidgetMode(on); });
    api.widgetMode().then(on => { if (alive && !changed) setWidgetMode(on); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; unsubscribe(); };
  }, []);
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
    [expanded,setExpanded] = useState(null),
    [commandOpen, setCommandOpen] = useState(false),
    [settingsSection, setSettingsSection] = useState("general"),
    [chartMetric, setChartMetric] = useState("total"),
    [recordSearch, setRecordSearch] = useState("");
  const requestFilter = useRef(null);
  // `view` is part of the snapshot request: the history breakdown maps are built per view
  // (only filter.view is populated), so a missing view makes 按项目 / 按任务 render empty.
  requestFilter.current = {...filter,page,recordPage,pageSize:50,view};
  const snapshotPending = !!api && (!data || data.chartTransitionKey !== JSON.stringify(requestFilter.current));
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
  }, [JSON.stringify(filter),page,recordPage,view]);
  useEffect(() => {
    const timer=setInterval(()=>{if(!document.hidden)load();},30000);
    const wake=()=>{if(!document.hidden)load();};
    document.addEventListener('visibilitychange',wake);
    const appEl=document.querySelector('.app');
    const enter=()=>{
      if(!appEl)return;
      // Clearing both classes is unconditional: `.app-to-widget` is what hides the window
      // while the widget morphs, so returning before this would strand it at opacity 0.
      appEl.classList.remove('app-to-widget','app-enter');
      // Under reduce there is nothing to replay and no animationend to settle it, so never
      // add a class whose only cleanup path is an animation event.
      if(prefersReducedMotion())return;
      void appEl.offsetWidth;
      appEl.classList.add('app-enter');
    };
    const settle=e=>{if(e.animationName==='app-enter')appEl.classList.remove('app-enter');};
    const offEnter=api?.onEnterApp?.(enter);
    // The first import reports progress through the same "update" channel the widget
    // already listens on; without this the window shows only "connecting" while the
    // initial full scan runs.
    const offUpdate=api?.onUpdate?.(message=>{
      if(message?.type==='progress')setProgress(message.data);
      else if(!message || message?.type==='updated'||message?.type==='recovered') {setProgress(null); if (!document.hidden) load();}
      else if(message?.type==='error') setError(typeof message.data === 'string' ? message.data : tr("采集服务暂不可用"));
    });
    appEl?.addEventListener('animationend',settle);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',wake);appEl?.removeEventListener('animationend',settle);offEnter?.();offUpdate?.();};
  },[]);
  const heading=useRef(null),lastFocus=useRef(null);
  useEffect(() => {
    const track=event=>{lastFocus.current=event.target;};
    document.addEventListener('focusin',track);
    return ()=>document.removeEventListener('focusin',track);
  },[]);
  // The metric cards navigate away, which unmounts the control that had focus. Never
  // steal focus from a click, but never strand it on <body> after a view switch either.
  useEffect(() => {
    const previous=lastFocus.current;
    if(!previous||previous===document.body||previous.isConnected)return;
    heading.current?.focus({preventScroll:true});
  },[page]);
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
    if (busy || !api) return;
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
  const choose = useCallback((key, value) => setFilter((f) => ({ ...f, [key]: value })), []);
  const showQuota = useCallback(() => setPage("quota"), []);
  const showTasks = useCallback(() => { setPage("history"); setView("tasks"); }, []);
  const showPrices = useCallback(() => {setSettingsSection("prices"); setPage("settings");}, []);
  const showModels = useCallback(() => { setPage("history"); setView("models"); }, []);
  const selectModel = useCallback((name) => { choose("model", name); setPage("history"); }, [choose]);
  const activityYear = data?.activity?.year || new Date().getFullYear();
  const exportFilter = page === 'history' ? filter : page === 'activity'
    ? {...filter, range: 'custom', start: `${activityYear}-01-01`, end: activityYear === new Date().getFullYear() ? localDay() : `${activityYear}-12-31`, recordSearch: '', recordStatus: ''}
    : {...filter, recordSearch: '', recordStatus: ''};
  const enterWidgetMode = async event => {
    const on = event.target.checked;
    if (widgetPending) return;
    setWidgetPending(true);
    const appEl = document.querySelector('.app');
    try {
      if (on && appEl) {
        appEl.classList.add('app-to-widget');
        // Wait out the .app-to-widget transition before the native window hides. The
        // duration is read from the CSS token rather than repeated as a literal, so
        // retuning the motion scale cannot silently desync this wait from the animation.
        const morph = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-quick')) || 180;
        await new Promise(resolve => setTimeout(resolve, morph));
      }
      await api.widgetMode(on);
    } catch (e) { appEl?.classList.remove('app-to-widget'); setError(e.message); }
    finally { setWidgetPending(false); }
  };
  const nav = [
    ["overview", Activity, tr("总览")],
    ["activity", CalendarDots, tr("活动")],
    ["history", ClockCounterClockwise, tr("历史分析")],
    ["quota", ChartLine, tr("账户额度")],
    ["settings", GearSix, tr("设置与价格")],
  ];
  const openDay = useCallback(day => {setFilter(previous => ({...previous, range: "custom", start: day, end: day, recordSearch: "", recordStatus: ""})); setRecordSearch(""); setPage("history");}, []);
  useEffect(() => {
    const timer = setTimeout(() => setFilter(previous => previous.recordSearch === recordSearch ? previous : ({...previous, recordSearch})), 240);
    return () => clearTimeout(timer);
  }, [recordSearch]);
  useEffect(() => {
    const keydown = event => {
      if (event.ctrlKey && event.key.toLowerCase() === "k") {event.preventDefault(); setCommandOpen(value => !value); return;}
      if (commandOpen || event.target.closest("input,select,textarea,[contenteditable=true]")) return;
      if (event.altKey && /^[1-5]$/.test(event.key)) {event.preventDefault(); setPage(nav[Number(event.key) - 1][0]);}
      if (event.ctrlKey && event.key.toLowerCase() === "r") {event.preventDefault(); if (!busy && api) act(() => api.refresh(), tr("数据已刷新"));}
      if (event.ctrlKey && event.key.toLowerCase() === "e") {event.preventDefault(); if (!busy && data && api && !snapshotPending) act(() => api.export(exportFilter), tr("CSV 已导出"));}
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [page, commandOpen, busy, data, filter]);
  // Which way the user moved in the nav decides which edge the next page enters from.
  // Resolved once per page and kept in a ref: the class must not change on a later
  // re-render of the same page, because swapping animation-name would replay the enter.
  const entered = useRef({ page: "overview", side: "" });
  if (entered.current.page !== page) {
    const from = nav.findIndex(([id]) => id === entered.current.page);
    entered.current = { page, side: nav.findIndex(([id]) => id === page) > from ? " enter-left" : " enter-right" };
  }
  const s = data?.sums,
    p = data?.performance,
    quotas = data?.quotas || [],
    lang = data?.settings.language;
  const quotaId = q => `${q.account}:${q.bucket}:${q.slot}`;
  const primary =
    quotas.find((q) => q.account === data?.quotaAccount && q.bucket === "codex" && q.slot === "primary") ||
    quotas[0];
  const selected =
    quotas.find((q) => quotaId(q) === quotaKey) || primary;
  // Rebuilt only when the snapshot or the selected window changes, not on every
  // unrelated state change (language is a dependency: tr()/date() read module state).
  const quotaPoints = useMemo(
    () =>
      selected
        ? (data?.quotaHistory || [])
            .filter((q) => q.account === selected.account && q.bucket === selected.bucket && q.slot === selected.slot)
            .map((q) => ({
              name: date(q.ts),
              time: Date.parse(q.ts),
              remaining: 100 - q.used,
              resets: q.resets,
              gapBefore: q.gapBefore,
            }))
        : [],
    [data?.quotaHistory, selected, lang],
  );
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
            <button className="command-trigger" aria-label={tr("打开命令面板")} title={tr("打开命令面板")} onClick={() => setCommandOpen(true)}><MagnifyingGlass size={16}/><kbd>Ctrl K</kbd></button>
            <label className="widget-switch" title={tr("切换到桌面小组件模式")}>
              <span className="widget-switch-label"><FrameCorners size={15} aria-hidden="true" />{tr("小组件")}</span>
              <input type="checkbox" role="switch" aria-label={tr("桌面小组件模式")} checked={widgetMode} disabled={!api || busy || widgetPending} onChange={enterWidgetMode} />
            </label>
            {data?.settings.muted && (
              <BellSlash size={16} role="img" aria-label={tr("静音额度提醒")} />
            )}
            <span className={`status-pill ${data?.scan?.sourceExists ? data.scan.errors ? 'has-errors' : 'healthy' : 'waiting'}`}>
              <span className="status-dot" />
              {progress
                ? tr("正在导入")
                : data?.scan?.sourceExists
                  ? data.scan.errors ? tr("采集存在异常") : tr("采集运行中")
                  : tr("等待数据源")}
            </span>
            <button
              className="icon-button"
              aria-label={tr("刷新数据与额度")}
              title={tr("刷新数据与额度")}
              disabled={busy || !api}
              onClick={() => act(() => api.refresh(), tr("数据已刷新"))}
            >
              <ArrowClockwise size={18} className={busy ? "spin" : ""} />
            </button>
          </div>
        </header>
      <main>
        <div key={page} aria-busy={snapshotPending} className={`content${page === "settings" ? " settings-content" : ""}${entered.current.side}`}>
          <div className="page-title">
            <div className="page-heading"><h1 ref={heading} tabIndex={-1}>{page === "overview" ? tr("用量总览") : page === "activity" ? tr("活动日历") : page === "history" ? tr("历史分析") : page === "quota" ? tr("账户额度") : tr("设置与价格")}</h1><span className="page-context">{page === "activity" ? String(data?.activity?.year || new Date().getFullYear()) : page === "settings" ? (data?.version ? `v${data.version}` : "") : data?.range ? date(data.range.start) + " — " + date(Date.parse(data.range.end) - 1) : ""}</span></div>
            {page !== "settings" && <button className="button export-button" disabled={busy || snapshotPending || !data || !api} onClick={() => act(() => api.export(exportFilter), tr("CSV 已导出"))}><DownloadSimple size={16}/>{tr("导出 CSV")}</button>}
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
          {/* The copy says 首次导入历史, so this is the pre-first-snapshot window only:
              a routine rescan cannot re-insert the notice and shift the page under it. */}
          {progress && !data && (
            <div className="notice">{tr("首次导入历史 ·")}{progress.scanned} / {progress.total}{" "}{tr("个文件，完成后自动展示。")}</div>
          )}
          {!data ? (
            <Empty>{tr("正在连接本机采集服务…")}</Empty>
          ) : (
            <>
              {page !== "settings" && <FilterBar data={data} filter={filter} setFilter={setFilter} page={page} onAccount={() => setQuotaKey("")} />}
              {page === "activity" && <><ActivityCalendar activity={data.activity} onYear={year => choose("activityYear", year)} onDay={openDay}/><ActivityDetails activity={data.activity} onDay={openDay}/></>}
              {(page === "overview" || page === "history") && (
                <>
                  <div className="metrics">
                    <Metric
                      label={tr("账户剩余额度")}
                      icon={Target}
                      value={primary ? 100 - primary.used : null}
                      format={wholePercent}
                      foot={
                        primary
                          ? tr("{0} 小时窗口", primary.minutes / 60)
                          : tr("尚未获得额度快照")
                      }
                      onClick={showQuota}
                    />
                    <Metric
                      label={
                        filter.range === "today" ? tr("今日 Token") : tr("Token 消耗")
                      }
                      icon={Stack}
                      value={s.total}
                      foot={tr("{0} 次用量记录", full(s.requests))}
                      onClick={showTasks}
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
                      onClick={showPrices}
                    />
                    <Metric
                      label={tr("缓存命中率")}
                      icon={Lightning}
                      value={s.cacheRate}
                      format={pct}
                      foot={tr("{0} 缓存输入 tokens", compact(s.cached))}
                      color="var(--blue)"
                      onClick={showModels}
                    />
                  </div>
                  {/* Trend and speed are overview panels. On the history page they pushed
                      消耗明细 and 任务运行记录 below a 960px viewport, so the history page
                      now opens on its own content; the four metric cards stay on both as a
                      persistent summary strip. */}
                  {page === "overview" && <ActivityCalendar activity={data.activity} compactView onYear={year => choose("activityYear", year)} onDay={openDay} onOpen={() => setPage("activity")}/>}
                  {page === "overview" && (
                  <div className="two-col">
                    <Panel
                      title={tr("Token 使用趋势")}
                      meta={<div className="segmented chart-metric" role="group" aria-label={tr("趋势指标")}>{[["total",tr("总量")],["output",tr("输出")],["cost","USD"]].map(([key,label]) => <button key={key} className={chartMetric === key ? "active" : ""} aria-pressed={chartMetric === key} onClick={() => setChartMetric(key)}>{label}</button>)}</div>}
                    >
                      <div className="legend">
                        <span>
                          <i />{tr("输入（含缓存）")}<b>{compact(s.input)}</b>
                        </span>
                        <span>
                          <i className="blue" />{tr("输出")}<b>{compact(s.output)}</b>
                        </span>
                      </div>
                      <Chart points={data.timeline} value={chartMetric} unit={chartMetric === "cost" ? "USD" : "tokens"} range={data.chartRange === "all" ? undefined : data.range} replayKey={`${data.chartTransitionKey}:${chartMetric}`} label={chartMetric === "cost" ? tr("等值费用趋势") : chartMetric === "output" ? tr("输出 Token 趋势") : tr("Token 总量趋势")} lang={lang} />
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
                  )}
                  {page === "overview" ? (
                    <div className="two-col equal">
                      <Panel title={tr("模型分布")} className="panel-fill">
                        <Rank
                          rows={data.models}
                          type="model"
                          onSelect={selectModel}
                          lang={lang}
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
                              <WindowQuota q={q} lang={lang} />
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
                    <Panel title={tr("消耗明细")} meta={tr("共 {0} 条", (data[view] || []).length)}>
                      <Breakdown
                        rows={data[view] || []}
                        view={view}
                        setView={setView}
                        choose={choose}
                        resetKey={JSON.stringify(filter)}
                        lang={lang}
                      />
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
                      <div className="record-toolbar"><label className="search-field"><MagnifyingGlass size={16}/><input aria-label={tr("搜索任务记录")} placeholder={tr("搜索任务、项目或模型")} value={recordSearch} onChange={event => setRecordSearch(event.target.value)}/>{recordSearch && <button className="icon-button" aria-label={tr("清除搜索")} onClick={() => setRecordSearch("")}><X size={14}/></button>}</label><select aria-label={tr("任务状态筛选")} value={filter.recordStatus || ""} onChange={event => choose("recordStatus", event.target.value)}>{[["",tr("全部状态")],["completed",tr("已完成")],["failed",tr("失败")],["aborted",tr("已取消")],["running",tr("未结束")]].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label={tr("记录排序")} value={filter.recordOrder || "newest"} onChange={event => choose("recordOrder",event.target.value)}><option value="newest">{tr("最新优先")}</option><option value="oldest">{tr("最早优先")}</option></select></div>
                      <RunRecords
                        turns={data.turns}
                        records={data.records}
                        expanded={expanded}
                        setExpanded={setExpanded}
                        setRecordPage={setRecordPage}
                        lang={lang}
                      />
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
                        <WindowQuota q={q} lang={lang} />
                      </Panel>
                    ))}
                  </div>
                  <Panel title={tr("剩余额度历史")} meta={data.quotaHistorySamples>data.quotaHistory.length ? tr("实线为采样趋势，虚线为重置，留白为采样缺口") : undefined}>
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
                      lang={lang}
                    />
                    <div className="panel-note">
                      {tr("额度属于当前登录账号，可能包含其他设备的用量；Token 统计仅覆盖本机 Codex 桌面端记录。")}
                    </div>
                  </Panel>
                </>
              )}
              {page === "settings" && (
                <Settings data={data} act={act} busy={busy} initialSection={settingsSection} />
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
      {commandOpen && <CommandPalette nav={nav} data={data} onNavigate={setPage} onChoose={(key, value) => {choose(key, value); setPage("history");}} onRefresh={() => act(() => api.refresh(), tr("数据已刷新"))} onExport={() => {if (!snapshotPending) act(() => api.export(exportFilter), tr("CSV 已导出"));}} onClose={() => setCommandOpen(false)}/>}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
