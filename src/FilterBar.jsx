import React, {useEffect, useState} from 'react';
import {FunnelSimple, X, CalendarBlank, Check} from '@phosphor-icons/react';
import {tr} from './i18n.mjs';
import {shortPath} from './format.mjs';
import {localDay} from './activity-calendar.mjs';

export function FilterBar({data, filter, setFilter, page, onAccount}) {
  const freshDraft = () => ({start: filter.start || localDay(), end: filter.end || localDay()});
  const [customOpen, setCustomOpen] = useState(false), [draft, setDraft] = useState(freshDraft);
  useEffect(() => {setCustomOpen(filter.range === 'custom'); setDraft(freshDraft());}, [filter.range, filter.start, filter.end]);
  const choose = (key, value) => setFilter(previous => ({...previous, [key]: value}));
  const label = id => data.accounts?.find(account => account.id === id)?.label || tr('未归属');
  const active = ['model', 'project', 'session'].filter(key => filter[key]);
  // The custom picker overlays whatever range is active, so the segmented control's
  // lens position and pressed state resolve through one value.
  const effectiveRange = customOpen ? 'custom' : filter.range;
  return <div className="filter-area">
    <div className="filters">
      {page !== 'activity' && <div className="segmented range-selector" role="group" aria-label={tr('时间范围')} style={{'--active-index': ['today','7d','30d','all','custom'].indexOf(effectiveRange)}}>
        <span className="range-lens" aria-hidden="true"/>
        {[['today',tr('今日')],['7d',tr('近 7 天')],['30d',tr('近 30 天')],['all',tr('全部')],['custom',tr('自定义')]].map(([id, text]) => <button key={id} aria-pressed={effectiveRange === id} className={effectiveRange === id ? 'active' : ''} onClick={() => {if (id === 'custom') setCustomOpen(true); else {setCustomOpen(false); choose('range', id);}}}>{text}</button>)}
      </div>}
      {page === 'activity' && <span className="filter-label"><FunnelSimple size={16}/>{tr('活动筛选')}</span>}
      <div className="account-control"><select aria-label={tr('账号筛选')} value={filter.account || ''} onChange={event => {choose('account', event.target.value); onAccount?.();}}>
        <option value="current">{tr('当前账号')} · {label(data.currentAccount)}</option>
        {page !== 'quota' && <option value="">{tr('全部账号')}</option>}
        {page === 'quota' && !filter.account && <option value="">{tr('当前账号')} · {label(data.currentAccount)}</option>}
        {(data.accounts || []).map(account => <option key={account.id} value={account.id}>{account.label}</option>)}<option value="unassigned">{tr('未归属')}</option>
      </select></div>
      {page !== 'quota' && <>
        <select aria-label={tr('模型筛选')} value={filter.model || ''} onChange={event => choose('model', event.target.value)}><option value="">{tr('全部模型')}</option>{data.options.models.map(model => <option key={model}>{model}</option>)}</select>
        <select aria-label={tr('项目筛选')} value={filter.project || ''} onChange={event => choose('project', event.target.value)}><option value="">{tr('全部项目')}</option>{data.options.projects.map(project => <option key={project} value={project}>{shortPath(project)}</option>)}</select>
      </>}
    </div>
    {customOpen && page !== 'activity' && <form className="custom-date-bar" onSubmit={event => {event.preventDefault(); setFilter(previous => ({...previous, range: 'custom', ...draft}));}}>
      <CalendarBlank size={16}/><label>{tr('开始日期')}<input required type="date" aria-label={tr('开始日期')} max={draft.end || undefined} value={draft.start} onChange={event => setDraft(previous => ({...previous, start: event.target.value}))}/></label><span>—</span>
      <label>{tr('结束日期')}<input required type="date" aria-label={tr('结束日期')} min={draft.start || undefined} value={draft.end} onChange={event => setDraft(previous => ({...previous, end: event.target.value}))}/></label>
      <button className="button" disabled={!draft.start || !draft.end || draft.start > draft.end}><Check size={14}/>{tr('应用日期')}</button>
    </form>}
    {!!active.length && page !== 'quota' && <div className="filter-chips"><FunnelSimple size={14}/>{active.map(key => <button className="chip" key={key} onClick={() => choose(key, '')}>{key === 'project' ? shortPath(filter[key]) : key === 'session' ? filter[key].slice(0, 8) : filter[key]}<X size={12}/></button>)}<button className="text-button" onClick={() => setFilter(previous => ({...previous, model: '', project: '', session: ''}))}>{tr('清除筛选')}</button></div>}
  </div>;
}
