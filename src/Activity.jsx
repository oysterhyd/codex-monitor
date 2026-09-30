import React, {useEffect, useMemo, useRef, useState} from 'react';
import {CalendarDots, CaretLeft, CaretRight, ArrowUpRight, X, Flame, Clock} from '@phosphor-icons/react';
import {tr, dateFormat} from './i18n.mjs';
import {compact, full, money} from './format.mjs';
import {calendarCells, heatLevel} from './activity-calendar.mjs';

const valueText = (day, metric) => metric === 'cost' ? money(day?.cost) : full(day?.[metric] || 0);

export function ActivityCalendar({activity, onYear, onDay, compactView = false, onOpen}) {
  const [metric, setMetric] = useState('total'), [hover, setHover] = useState(null), [selected, setSelected] = useState(null), [focusDay, setFocusDay] = useState(null);
  const wrapper = useRef(null), grid = useRef(null);
  const cells = useMemo(() => calendarCells(activity?.year || new Date().getFullYear()), [activity?.year]);
  const days = useMemo(() => new Map(activity?.days.map(day => [day.date, day]) || []), [activity?.days]);
  const max = useMemo(() => Math.max(0, ...[...days.values()].map(day => day[metric] || 0)), [days, metric]);
  useEffect(() => {setSelected(null); setHover(null); setFocusDay(null);}, [activity?.year]);
  if (!activity) return null;
  const {year, stats} = activity;
  const fallbackFocus = cells.find(cell => cell.inYear && cell.date <= activity.today)?.date;
  const show = (event, cell) => {
    const rect = event.currentTarget.getBoundingClientRect(), host = wrapper.current.getBoundingClientRect();
    setHover({cell, left: Math.max(0, Math.min(host.width - 220, rect.left - host.left - 100)), top: rect.top - host.top});
  };
  const navigate = (event, index) => {
    const move = {ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1}[event.key];
    if (move == null && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const selectable = cell => cell.inYear && cell.date <= activity.today;
    const first = cells.findIndex(selectable), last = cells.findLastIndex(selectable);
    const next = event.key === 'Home' ? first : event.key === 'End' ? last : Math.max(first, Math.min(last, index + move));
    const direction = next < index ? -1 : 1;
    for (let i = Math.max(0, Math.min(next, cells.length - 1)); i >= 0 && i < cells.length; i += direction) {
      if (cells[i].inYear && cells[i].date <= activity.today) {
        setFocusDay(cells[i].date); grid.current?.querySelector(`[data-date="${cells[i].date}"]`)?.focus(); break;
      }
    }
  };
  const chosen = selected && (days.get(selected) || {date: selected, total: 0, requests: 0, sessions: 0, cost: 0});
  return <section className={`panel activity-panel${compactView ? ' compact-activity' : ''}`} aria-label={tr('活动热力图')}>
    <div className="activity-toolbar">
      <div className="activity-heading"><CalendarDots size={19} /><h2>{tr('活动')}</h2><span className="year-navigation">
        <button className="icon-button" aria-label={tr('上一年')} disabled={year <= Math.min(year, activity.firstYear)} onClick={() => onYear(year - 1)}><CaretLeft size={14}/></button>
        <b>{year}</b>
        <button className="icon-button" aria-label={tr('下一年')} disabled={year >= new Date().getFullYear()} onClick={() => onYear(year + 1)}><CaretRight size={14}/></button>
      </span></div>
      <div className="activity-controls"><div className="segmented" role="group" aria-label={tr('活动指标')}>
        {[['total', 'Token'], ['requests', tr('用量记录')], ['cost', 'USD']].map(([key, label]) => <button key={key} aria-pressed={metric === key} className={metric === key ? 'active' : ''} onClick={() => setMetric(key)}>{label}</button>)}
      </div>{compactView && <button className="text-button" onClick={onOpen}>{tr('查看活动')}<ArrowUpRight size={14}/></button>}</div>
    </div>
    <div className="activity-summary">
      <span><strong>{stats.activeDays}</strong>{tr('活跃天数')}</span>
      <span><Flame size={14}/><strong>{stats.currentStreak}</strong>{tr('当前连续')}</span>
      <span><strong>{stats.longestStreak}</strong>{tr('最长连续')}</span>
      <span className="activity-total"><strong>{compact(stats.total)}</strong> tokens · <strong>{full(stats.requests)}</strong> {tr('用量记录')}</span>
    </div>
    <div className="calendar-wrapper" ref={wrapper} onMouseLeave={() => setHover(null)}>
      <div className="calendar-scroll">
        <div className="calendar-months" style={{'--weeks': cells.length / 7}} aria-hidden="true">
          {cells.filter((cell, index) => cell.inYear && (cell.date.endsWith('-01') || (index === 0))).map(cell => <span key={cell.date} style={{gridColumn: Math.floor(cells.indexOf(cell) / 7) + 1}}>{dateFormat('calendarMonth', {month: 'short'}).format(new Date(cell.date + 'T12:00:00'))}</span>)}
        </div>
        <div className="calendar-body">
          <div className="calendar-weekdays" aria-hidden="true"><span>{tr('一')}</span><span>{tr('三')}</span><span>{tr('五')}</span><span>{tr('日')}</span></div>
          <div className="calendar-grid" ref={grid} role="group" aria-label={tr('活动日历，使用方向键选择日期')} style={{'--weeks': cells.length / 7}}>
            {cells.map((cell, index) => !cell.inYear ? <span key={cell.date} className="heat-spacer"/> : <button key={cell.date} className={`heat-cell level-${heatLevel(days.get(cell.date)?.[metric], max)}${cell.date === activity.today ? ' is-today' : ''}${selected === cell.date ? ' is-selected' : ''}`}
              data-date={cell.date} aria-label={`${cell.date} · ${valueText(days.get(cell.date) || {cost: 0}, metric)} ${metric === 'total' ? 'tokens' : metric === 'requests' ? tr('用量记录') : 'USD'}${days.get(cell.date)?.unpriced ? ' · ' + tr('部分未定价') : ''}`}
              aria-pressed={selected === cell.date} disabled={cell.date > activity.today} tabIndex={(focusDay || fallbackFocus) === cell.date ? 0 : -1}
              onMouseEnter={event => show(event, cell)} onFocus={event => {setFocusDay(cell.date); show(event, cell);}} onBlur={() => setHover(null)} onKeyDown={event => navigate(event, index)} onClick={() => {setSelected(cell.date); setHover(null);}}/>)}
          </div>
        </div>
      </div>
      {hover && <div className="heat-tooltip" role="tooltip" style={{left: hover.left, top: hover.top - 66}}><b>{hover.cell.date}</b><span>{valueText(days.get(hover.cell.date) || {cost: 0}, metric)} {metric === 'total' ? 'tokens' : metric === 'cost' ? 'USD' : tr('用量记录')}{days.get(hover.cell.date)?.unpriced ? ' · ' + tr('部分未定价') : ''}</span></div>}
    </div>
    <div className="calendar-caption"><span>{tr('按本地日期统计 · 点击日期查看记录')}</span><div className="heat-legend"><span>{tr('少')}</span>{[0,1,2,3,4].map(level => <i key={level} className={`heat-cell level-${level}`}/>)}<span>{tr('多')}</span></div></div>
    {chosen && <div className="day-inspector" key={chosen.date}>
      <b>{chosen.date}</b><span><strong>{compact(chosen.total)}</strong> tokens</span><span>{chosen.requests} {tr('用量记录')} · {chosen.sessions} {tr('个任务')}</span><span>{money(chosen.cost)}{chosen.unpriced ? ' + ' + tr('未定价') : ''}</span>
      <button className="button" onClick={() => onDay(chosen.date)}>{tr('查看当天记录')}<ArrowUpRight size={14}/></button><button className="icon-button" aria-label={tr('收起日期详情')} onClick={() => setSelected(null)}><X size={16}/></button>
    </div>}
  </section>;
}

export function ActivityDetails({activity, onDay}) {
  if (!activity) return null;
  const max = Math.max(1, ...activity.hours.map(hour => hour.total));
  const recent = [...activity.days].reverse().slice(0, 8);
  return <div className="two-col equal activity-details">
    <section className="panel"><div className="panel-head"><h2><Clock size={17}/>{tr('活跃时段')}</h2><span>{tr('本地时间 · 年度汇总')}</span></div>
      <div className="hour-chart" role="img" aria-label={tr('每小时 Token 分布')}>
        {activity.hours.map(hour => <div className="hour-column" key={hour.hour} title={`${String(hour.hour).padStart(2, '0')}:00 · ${full(hour.total)} tokens · ${hour.requests} ${tr('用量记录')}`}><div className="hour-track"><i style={{height: `${hour.total / max * 100}%`}}/></div><span>{hour.hour % 4 === 0 ? String(hour.hour).padStart(2, '0') : ''}</span></div>)}
      </div><div className="activity-detail-foot">{tr('高峰日期')} <b>{activity.stats.peak?.date || '—'}</b><span>{compact(activity.stats.peak?.total)} tokens</span></div>
    </section>
    <section className="panel"><div className="panel-head"><h2>{tr('最近活动日')}</h2><span>{tr('{0} 个任务', activity.stats.sessions)}</span></div>
      {recent.length ? <div className="activity-day-list">{recent.map(day => <button key={day.date} onClick={() => onDay(day.date)}><span>{day.date}</span><i style={{'--day-fill': `${day.total / Math.max(1, activity.stats.peak?.total || 0) * 100}%`}}/><b>{compact(day.total)}</b><ArrowUpRight size={14}/></button>)}</div> : <div className="empty">{tr('这个时间范围内还没有记录')}</div>}
    </section>
  </div>;
}
