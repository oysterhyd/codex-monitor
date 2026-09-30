import React, {useEffect, useMemo, useRef, useState} from 'react';
import {MagnifyingGlass, ArrowRight, Folder, Cpu, X, ArrowClockwise, DownloadSimple} from '@phosphor-icons/react';
import {tr} from './i18n.mjs';
import {shortPath} from './format.mjs';

export function CommandPalette({nav, data, onNavigate, onChoose, onRefresh, onExport, onClose}) {
  const dialog = useRef(null), input = useRef(null), [search, setSearch] = useState(''), [selected, setSelected] = useState(0);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal(); input.current.focus();
    return () => {dialog.current?.close(); if (previous?.isConnected) previous.focus({preventScroll: true});};
  }, []);
  const items = useMemo(() => {
    const commands = nav.map(([id, Icon, label], index) => ({id, Icon, label, hint: `Alt ${index + 1}`, run: () => onNavigate(id)}));
    commands.push({id: 'refresh', Icon: ArrowClockwise, label: tr('刷新数据与额度'), hint: 'Ctrl R', run: onRefresh}, {id: 'export', Icon: DownloadSimple, label: tr('导出 CSV'), hint: 'Ctrl E', run: onExport});
    if (search.trim()) {
      for (const model of data?.options?.models || []) commands.push({id: 'model:' + model, Icon: Cpu, label: model, hint: tr('模型'), run: () => onChoose('model', model)});
      for (const project of data?.options?.projects || []) commands.push({id: 'project:' + project, Icon: Folder, label: shortPath(project), detail: project, hint: tr('项目'), run: () => onChoose('project', project)});
    }
    const query = search.trim().toLowerCase();
    return commands.filter(item => !query || `${item.label} ${item.detail || ''} ${item.hint}`.toLowerCase().includes(query)).slice(0, 30);
  }, [search, data, nav, onNavigate, onChoose, onRefresh, onExport]);
  useEffect(() => setSelected(0), [search]);
  useEffect(() => {dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest'});}, [selected]);
  const execute = item => {if (item) {onClose(); item.run();}};
  return <dialog className="command-dialog" ref={dialog} aria-label={tr('命令面板')} onCancel={onClose} onClick={event => {if (event.target === event.currentTarget) {const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();}}} onKeyDown={event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {event.preventDefault(); setSelected(value => Math.max(0, Math.min(items.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1))));}
    if (event.key === 'Enter') {event.preventDefault(); execute(items[selected]);}
  }}>
    <div className="command-search"><MagnifyingGlass size={21}/><input ref={input} aria-label={tr('搜索页面、模型或项目')} placeholder={tr('搜索页面、模型或项目')} value={search} onChange={event => setSearch(event.target.value)} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={items[selected] ? `command-${selected}` : undefined}/><button className="icon-button" onClick={onClose} aria-label={tr('关闭命令面板')}><X size={18}/></button></div>
    <div className="command-results" id="command-results" role="listbox" aria-label={tr('搜索结果')}>
      {items.map((item, index) => <button id={`command-${index}`} key={item.id} role="option" aria-selected={selected === index} tabIndex={-1} className={selected === index ? 'active' : ''} onMouseEnter={() => setSelected(index)} onClick={() => execute(item)}><item.Icon size={19}/><span>{item.label}</span><kbd>{item.hint}</kbd><ArrowRight size={14}/></button>)}
      {!items.length && <div className="empty">{tr('没有匹配的结果')}</div>}
    </div><div className="command-footer"><span>↑ ↓ {tr('选择')}<kbd>Enter</kbd>{tr('打开')}</span><span><kbd>Esc</kbd>{tr('关闭')}</span></div>
  </dialog>;
}
