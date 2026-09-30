import React, { useState, useEffect, useMemo, useRef } from "react";
import {ChartLine, ArrowUpRight, Coins, GearSix, Database, MagnifyingGlass, X} from "@phosphor-icons/react";
import { tr, dateFormat, systemText } from "./i18n.mjs";
import { compact, full, money, recordMoney, date, duration, shortPath, prefersReducedMotion, TICK_FORMATS } from "./format.mjs";
import {chartPaths} from "./chart-paths.mjs";
export function Animated({ value, format = compact, emphasize = false }) {
  const [shown, setShown] = useState(value),
    prev = useRef(value),
    [pulse, setPulse] = useState(0);
  useEffect(() => {
    const previous = prev.current;
    // "What changed since the last snapshot" has to be a real move in the value: not the
    // first paint (previous == null), not the 450ms tween re-rendering, and not a
    // machine that asked for less motion. Remounting the value span by key is what
    // replays the one-shot animation; nothing loops.
    if (emphasize && previous != null && value != null && value !== previous && !document.hidden && !prefersReducedMotion()) setPulse((p) => p + 1);
    if (
      value == null ||
      previous == null ||
      document.hidden ||
      prefersReducedMotion()
    ) {
      setShown(value);
      prev.current = value;
      return;
    }
    const start = performance.now(),
      from = previous;
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 450);
      setShown(from + (value - from) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    prev.current = value;
    return () => cancelAnimationFrame(frame);
  }, [value, emphasize]);
  if (!emphasize) return <>{format(shown)}</>;
  return <span key={pulse} className={pulse ? "value-changed" : undefined}>{format(shown)}</span>;
}
export function Empty({ children }) {
  return (
    <div className="empty">
      <ChartLine size={28} />
      <span>{children || tr("这个时间范围内还没有记录")}</span>
    </div>
  );
}
// Resolve the hovered sample from one overlay instead of a hit target per point:
// three elements per sample grew with every range and 30d/all plotted ~700 of them.
const nearestSample = (event, xy) => {
  const matrix = event.currentTarget.getScreenCTM?.();
  if (!matrix) return null;
  const inverse = matrix.inverse();
  const x = inverse.a * event.clientX + inverse.c * event.clientY + inverse.e;
  let best = 0,
    distance = Infinity;
  for (let i = 0; i < xy.length; i++) {
    const candidate = Math.abs(xy[i][0] - x);
    if (candidate < distance) {
      distance = candidate;
      best = i;
    }
  }
  return best;
};
// Two fills the chart must not paint. A sub-path with no width (a sample that starts its own
// segment, because a reset or a gap was reported between it and the previous one) has no area
// at all, yet painting it draws a bare vertical line down to the baseline. And when the whole
// series covers a sliver of the axis, every fill under it is a spike rather than an area --
// the 今日 账户额度 chart holding one observation. The line, the sample markers and the reset
// dashes carry those series on their own.
const AREA_MIN_SPREAD = 84; // a tenth of the 836-unit plot
const areaPath = (area, xy) => {
  const xs = xy.map((p) => p[0]);
  if (Math.max(...xs) - Math.min(...xs) < AREA_MIN_SPREAD) return "";
  return area.replace(/M[^M]*/g, (segment) => {
    const px = [...segment.matchAll(/[ML]([\d.]+)/g)].map((m) => Number(m[1]));
    return Math.max(...px) - Math.min(...px) > 0.5 ? segment : "";
  });
};
export const Chart = React.memo(function Chart({
  points: sourcePoints,
  value = "total",
  color = "var(--accent)",
  percent = false,
  step = false,
  label,
  replayKey,
  range,
  lang,
  unit = "tokens",
}) {
  const [hover, setHover] = useState(null);
  const points = useMemo(() => {
    if (unit !== 'USD') return sourcePoints;
    let gap = false;
    return sourcePoints.flatMap(point => {
      if (point.unpriced === point.requests && point.requests) {gap = true; return [];}
      const next = {...point, gapBefore: gap}; gap = false; return [next];
    });
  }, [sourcePoints, unit]);
  useEffect(() => setHover(null), [replayKey, value]);
  const geometry = useMemo(() => {
    if (!points.length) return null;
    const max = percent ? 100 : Math.max(unit === 'USD' ? 0.01 : 1, ...points.map((p) => p[value] || 0));
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
    const paths = chartPaths(points, xy, { step, smooth: step || unit === 'USD' });
    return {
      max,
      first,
      last,
      xy,
      ...paths,
      area: areaPath(paths.area, xy),
    };
  }, [points, value, percent, step, range, unit]);
  if (!geometry) return <Empty />;
  const { max, first, last, xy, line, area, connectors = [] } = geometry;
  // A newer snapshot can shorten the series while a hover index is still held.
  const hoverIndex = hover != null && hover < points.length ? hover : null;
  const chosen = hoverIndex == null ? null : points[hoverIndex];
  const tickKey = last - first > 2 * 86400000 ? "tickDay" : "tickTime";
  const tickFormat = dateFormat(tickKey, TICK_FORMATS[tickKey]);
  const fractions = last > first ? [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1] : [0];
  // 今日 quota history is often a single sample; a 2.5px dot on a 160px plot reads as a
  // stray mark, so a series too short to draw a slope gets a marker that is really visible.
  const dotRadius = points.length < 4 ? 4.5 : 2.5;
  return (
    <div className="chart-wrap">
      <div className="chart-plot">
        {/* The y axis is HTML so its type size is fixed: the svg below is stretched to
            the panel width (preserveAspectRatio="none") to hold the chart height fixed. */}
        <div className="chart-axis-y" aria-hidden="true">
          {[0, 0.5, 1].map((v) => (
            <span key={v} style={{ top: `${((150 - v * 128) / 190) * 100}%` }}>
              {percent ? max * v + "%" : unit === 'USD' ? money(max * v) : compact(max * v)}
            </span>
          ))}
        </div>
      <svg
        key={replayKey}
        className="chart-scene"
        viewBox="0 0 920 190"
        preserveAspectRatio="none"
        role="group"
        aria-label={label || tr("用量趋势")}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((v) => (
          <line
            key={v}
            x1="44"
            x2="880"
            y1={150 - v * 128}
            y2={150 - v * 128}
            stroke="var(--border)"
            strokeDasharray="4 5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {fractions.map((f,i) => <line key={f} className={i % 2 ? "chart-minor-tick" : ""} x1={44+f*836} x2={44+f*836} y1="22" y2="150" stroke="var(--border)" opacity=".35" vectorEffect="non-scaling-stroke" />)}
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
          vectorEffect="non-scaling-stroke"
        />
        {/* One dashed layer for every reset/gap segment: the same strokes as one path
            element instead of one element per connector on 30d/all ranges. */}
        {connectors.length > 0 && (
          <path
            d={connectors.join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="1.2"
            strokeDasharray="3 5"
            opacity=".45"
            vectorEffect="non-scaling-stroke"
          >
            <title>{tr("额度重置或窗口调整")}</title>
          </path>
        )}
        {/* Sample markers are round-cap zero-length strokes, not <circle>s: the svg is
            stretched to the panel width (preserveAspectRatio="none"), so a circle's rx
            and ry scale by different factors and a wide chart renders it as a flat
            ellipse. A non-scaling stroke is measured in screen pixels, so the marker is
            a true circle at every panel width and the diameter is the same everywhere. */}
        {points.length < 15
          ? xy.map(([x, y], i) => (
              <path key={i} d={`M${x},${y} l0.01,0`} stroke={color} fill="none"
                strokeWidth={hoverIndex === i ? 10 : dotRadius * 2}
                strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))
          : hoverIndex != null && (
              <path d={`M${xy[hoverIndex][0]},${xy[hoverIndex][1]} l0.01,0`} stroke={color} fill="none"
                strokeWidth="10" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            )}
        </g>
        {/* Hover surface: outside the reveal group so it stays live during the wipe. */}
        <rect
          className="chart-hit"
          x="44"
          y="12"
          width="836"
          height="144"
          fill="transparent"
          tabIndex={0}
          role="slider"
          aria-label={label || tr("用量趋势")}
          aria-valuemin={0}
          aria-valuemax={points.length - 1}
          aria-valuenow={hoverIndex ?? 0}
          aria-valuetext={`${(chosen || points[0]).name} · ${percent ? (chosen || points[0])[value].toFixed(1) + '%' : unit === 'USD' ? money((chosen || points[0])[value]) : full((chosen || points[0])[value]) + ' tokens'}`}
          onFocus={() => setHover(0)}
          onBlur={() => setHover(null)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            setHover(current => event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (current ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))));
          }}
          onMouseMove={(event) => {
            const index = nearestSample(event, xy);
            if (index != null) setHover(index);
          }}
        />
      </svg>
      </div>
      <div className="chart-axis-x" aria-hidden="true">
        {fractions.map((fraction, index) => (
          <span key={fraction} className={`chart-tick ${index % 2 ? "chart-minor-tick" : ""}`}>
            {tickFormat.format(new Date(first + fraction * (last - first)))}
          </span>
        ))}
      </div>
      <div className="chart-caption">
        {chosen
          ? `${chosen.name} · ${percent ? chosen[value].toFixed(1) + "%" : unit === 'USD' ? money(chosen[value]) + (chosen.unpriced ? ' + ' + tr('未定价') : '') : full(chosen[value]) + " tokens"}`
          : "\u00a0"}
      </div>
    </div>
  );
});
export function Panel({ title, meta, children, className = "" }) {
  return (
    <section className={"panel " + className}>
      <div className="panel-head">
        <h2><span className="panel-icon" aria-hidden="true">{title.toLowerCase().includes(tr("价格").toLowerCase()) ? <Coins size={21} /> : title.toLowerCase().includes(tr("外观").toLowerCase()) ? <GearSix size={21} /> : title.toLowerCase().includes(tr("额度").toLowerCase()) || title.toLowerCase().includes(tr("来源").toLowerCase()) ? <Database size={21} /> : <ChartLine size={21} />}</span>{title}</h2>
        {meta && <div className="panel-meta">{meta}</div>}
      </div>
      {children}
    </section>
  );
}
export const Metric = React.memo(function Metric({ label, value, format, foot, icon: Icon, color, onClick }) {
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
        <Animated value={value} format={format} emphasize />
      </div>
      <div className="metric-foot">
        {foot}
        <ArrowUpRight size={15} />
      </div>
    </button>
  );
});
export const WindowQuota = React.memo(function WindowQuota({ q, lang }) {
  const stale = q.resets != null && q.resets * 1000 < Date.now();
  const remaining = 100 - q.used;
  const shown = remaining.toFixed(0);
  const windowLabel =
    q.minutes >= 1440
      ? tr("{0} 天窗口", Math.round(q.minutes / 1440))
      : tr("{0} 小时窗口", q.minutes / 60);
  return (
    <div className="quota-window">
      <div className="row">
        <span>{windowLabel}</span>
        <b>
          {shown}
          <small>{tr("% 剩余")}</small>
        </b>
      </div>
      <div
        className="track"
        role="meter"
        aria-label={windowLabel}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Number(shown)}
      >
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
});
export const Rank = React.memo(function Rank({ rows, type, onSelect, lang }) {
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
});

// Both tables are memoised units: any unrelated App state change (busy, toast, an
// expanded record, a widget toggle) used to re-render every row. `lang` is part of the
// props because tr()/date() read module state, so a language switch must invalidate.
const BREAKDOWN_PAGE_SIZE = 50;
export const Breakdown = React.memo(function Breakdown({ rows, view, setView, choose, resetKey, lang }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(''), [sort, setSort] = useState('total');
  useEffect(() => {setPage(1); setQuery('');}, [view, resetKey]);
  useEffect(() => setPage(1), [query, sort]);
  const matching = useMemo(() => rows.filter(row => `${row.name} ${row.project || ''}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'cost') return (b.unpriced === b.requests ? -1 : b.cost) - (a.unpriced === a.requests ? -1 : a.cost) || a.name.localeCompare(b.name);
    return b[sort] - a[sort];
  }), [rows, query, sort]);
  const pages = Math.max(1, Math.ceil(matching.length / BREAKDOWN_PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = matching.slice((current - 1) * BREAKDOWN_PAGE_SIZE, current * BREAKDOWN_PAGE_SIZE);
  return (
    <>
      <div className="breakdown-toolbar"><div className="segmented inner" role="group" aria-label={tr("消耗明细")}>
        {[
          ["models", tr("按模型")],
          ["projects", tr("按项目")],
          ["tasks", tr("按任务")],
        ].map(([id, name]) => (
          <button
            key={id}
            aria-pressed={view === id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            {name}
          </button>
        ))}
      </div><label className="search-field"><MagnifyingGlass size={16}/><input aria-label={tr('搜索消耗明细')} placeholder={tr('搜索名称')} value={query} onChange={event => setQuery(event.target.value)}/>{query && <button className="icon-button" aria-label={tr('清除搜索')} onClick={() => setQuery('')}><X size={14}/></button>}</label><select aria-label={tr('明细排序')} value={sort} onChange={event => setSort(event.target.value)}>{[['total',tr('Token 最多')],['cost',tr('费用最高')],['output',tr('输出最多')],['name',tr('名称顺序')]].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>
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
            {visible.map((r) => (
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
                    {view === "projects" ? shortPath(r.name) : r.name}
                    {r.project && <small>{shortPath(r.project)}</small>}
                  </button>
                </td>
                <td>{full(r.input)}</td>
                <td>{full(r.cached)}</td>
                <td>{full(r.output)}</td>
                <td>
                  {r.unpriced === r.requests ? tr("未定价") : money(r.cost)}
                  {r.unpriced > 0 && r.unpriced < r.requests && (
                    <small>{tr("部分未定价")}</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!matching.length && <Empty>{query ? tr('没有匹配的结果') : tr('这个时间范围内还没有记录')}</Empty>}
      </div>
      {pages > 1 && (
        <div className="pagination">
          <button className="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>{tr("上一页")}</button>
          <span aria-live="polite">{tr("第 {0} / {1} 页 · 每页 50 条", current, pages)}</span>
          <button className="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>{tr("下一页")}</button>
        </div>
      )}
    </>
  );
});
export const RunRecords = React.memo(function RunRecords({ turns, records, expanded, setExpanded, setRecordPage, lang }) {
  return (
    <>
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
            {turns.map((t) => (
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
                <td><span className={`record-status ${t.status}`}>
                  {
                    {
                      completed: tr("已完成"),
                      failed: tr("失败"),
                      aborted: tr("已取消"),
                      running: tr("未结束"),
                    }[t.status]
                  }
                </span></td>
                <td title={tr("缓存输入 {0} tokens", full(t.cached))}>{t.requests ? full(t.input) : "—"}<small>{recordMoney(t.inputCost, t)}</small></td>
                <td>{t.requests ? full(t.output) : "—"}<small>{recordMoney(t.outputCost, t)}</small></td>
                <td>{recordMoney(t.cost, t)}</td>
                <td>{duration(t.duration)}</td>
                <td>{duration(t.ttft)}</td>
              </tr>
              {expanded===t.id && <tr className="record-expanded"><td colSpan={8}>
                <div>{tr("完整任务 ·")}{t.id}</div>
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
        {!turns.length && <Empty>{tr('没有符合筛选条件的任务')}</Empty>}
      </div>
      <div className="pagination">
        <button className="button" disabled={!records || records.page<=1} onClick={()=>{setRecordPage(records.page-1);setExpanded(null);}}>{tr("上一页")}</button>
        <span aria-live="polite">{tr("第 {0} / {1} 页 · 每页 50 条", records?.page || 1, records?.pages || 1)}</span>
        <button className="button" disabled={!records || records.page>=records.pages} onClick={()=>{setRecordPage(records.page+1);setExpanded(null);}}>{tr("下一页")}</button>
      </div>
    </>
  );
});
