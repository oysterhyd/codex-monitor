import React, { useEffect, useState } from 'react';
import { Target, Stack, Lightning, Coins, Cube, Clock, ArrowClockwise, DotsThree, ArrowUpRight } from '@phosphor-icons/react';
import icon from '../assets/monitor-glass.png';
import { createRefresh } from './refresh.mjs';
import './widget.css';

const compact = n => n == null ? '—' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
const percent = n => n == null ? '—' : `${Number(n.toFixed(1))}%`;

function Sparkline({ points = [], large = false, english }) {
  const max = Math.max(1, ...points.map(p => p.total));
  const width = large ? 380 : 130, height = large ? 82 : 30;
  const coords = points.map((p, i) => `${i * width / Math.max(1, points.length - 1)},${height - p.total / max * (height - 3)}`);
  const line = coords.length ? `M${coords.join(' L')}` : '';
  return <div className={large ? 'widget-chart' : 'widget-spark'}>
    <svg viewBox={`0 0 ${width} ${height + 2}`} preserveAspectRatio="none" role="img" aria-label={large ? (english ? 'Token usage in the last 24 hours' : '近 24 小时 Token 用量') : (english ? 'Output rate samples' : '输出速率采样趋势')}>
      {large && [0, .5, 1].map(v => <line key={v} x1="0" x2={width} y1={height * v} y2={height * v} stroke="currentColor" strokeDasharray="3 5" opacity=".16" />)}
      {large && [0, .25, .5, .75, 1].map(v => <line key={v} x1={width * v} x2={width * v} y1="0" y2={height} stroke="currentColor" strokeDasharray="3 5" opacity=".12" />)}
      {line && <><path d={`${line} L${width},${height} L0,${height} Z`} fill="#00a88e" opacity=".13" />
        <path d={line} fill="none" stroke="#00a58e" strokeWidth={large ? 2 : 3.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></>}
    </svg>
    {large && <><span className="widget-chart-max">{compact(max === 1 && points.every(p => !p.total) ? 0 : max)}</span>
      <div className="widget-ticks">{[0, 24, 48, 72, 95].map(i => <span key={i}>{points[i] ? new Date(points[i].time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>)}</div></>}
  </div>;
}

export function Widget() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add('widget-mode');
    let alive = true;
    const refresh = createRefresh(() => window.widget.snapshot(), result => { if (alive) { setData(result); setError(''); } }, e => { if (alive) setError(e.message); });
    const update = () => { if (!document.hidden) refresh.request(); };
    update();
    const timer = setInterval(update, 3000);
    const unsubscribe = window.widget.onUpdate(update);
    const node = () => document.querySelector('.desktop-widget');
    const enterFx = () => {
      const el = node(); if (!el) return;
      el.classList.remove('widget-out');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('widget-in')));
    };
    const exitFx = () => {
      const el = node(); if (!el) return;
      el.classList.remove('widget-in');
      el.classList.add('widget-out');
    };
    document.addEventListener('visibilitychange', update);
    const offExit = window.widget.onExit(exitFx);
    const offEnter = window.widget.onEnter(enterFx);
    return () => { alive = false; clearInterval(timer); unsubscribe(); offExit(); offEnter();
      document.removeEventListener('visibilitychange', update); };
  }, []);
  const en = data?.language === 'en', t = (zh, english) => en ? english : zh;
  const now = Date.now();
  const scanFresh = data?.scan?.lastScan && now - Date.parse(data.scan.lastScan) < 15000;
  const collecting = scanFresh && data.scan.sourceExists && !data.scan.errors && !error;
  const quota = minutes => {
    const q = data?.quotas.find(q => q.minutes === minutes);
    const expired = q?.resets && q.resets * 1000 <= now;
    const stale = q && (now - Date.parse(q.ts) > 300000 || !data.quotaStatus?.ok);
    return { value: q && !expired ? Math.max(0, 100 - q.used) : null,
      title: q ? `${expired ? t('等待重置更新 · ', 'Awaiting reset · ') : stale ? t('旧快照 · 待刷新 · ', 'Saved · retrying · ') : ''}${q.bucket} · ${t('采样', 'Sampled')} ${new Date(q.ts).toLocaleString()}${q.resets ? ` · ${t('重置', 'Resets')} ${new Date(q.resets * 1000).toLocaleString()}` : ''}` : t('当前账号暂无额度快照', 'No quota snapshot for this account') };
  };
  const five = quota(300), week = quota(10080);
  const refresh = async () => {
    setBusy(true);
    try { await window.widget.refresh(); setData(await window.widget.snapshot()); setError(''); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const cards = [
    { label: t('当前 5h 额度', '5h quota'), icon: Target, ...five },
    { label: t('本周额度', 'Weekly quota'), icon: Stack, ...week },
    { label: t('实时 TPS', 'Live TPS'), icon: Lightning, value: data && collecting ? data.tps : null, speed: true, title: t('最近 60 秒日志中的输出 token / 60；包含等待，并非精确生成速度。', 'Output tokens recorded in the last 60 seconds / 60; includes idle time, not exact generation speed.') },
    { label: t('缓存命中率', 'Cache hit rate'), icon: Coins, value: data?.cacheRate == null ? null : data.cacheRate * 100, title: t('当前账号今日缓存输入 / 输入 Token', 'Current account: cached input / input tokens today') },
  ];
  return <main className="desktop-widget" aria-label={t('Codex 桌面小组件', 'Codex desktop widget')}>
    <header className="widget-header" onDoubleClick={() => window.widget.restore()}>
      <button className="widget-brand" onClick={() => window.widget.restore()} title={t('打开主窗口', 'Open monitor')}><img src={icon} alt="" /></button>
      <div className="widget-title"><h1>Codex Monitor</h1><p>{t('实时监控 · ', 'Live monitoring · ')}{collecting ? t('稳定运行中', 'Running') : data ? t('等待采集更新', 'Waiting for updates') : t('正在连接', 'Connecting')}</p></div>
      <span className={`widget-status ${collecting ? '' : 'waiting'}`} role="status"><i />{collecting ? t('采集中', 'Live') : t('等待中', 'Waiting')}</span>
      <button className="widget-menu" aria-label={t('小组件选项', 'Widget options')} onClick={() => window.widget.menu()}><DotsThree size={26} weight="bold" /></button>
    </header>
    <div className="widget-metrics">{cards.map(({ label, icon: Icon, value, title, speed }) => <section className="widget-metric" key={label} title={title}>
      <div className="widget-metric-label"><span className={`widget-icon ${speed ? 'blue' : ''}`}><Icon size={23} /></span><span>{label}</span></div>
      <div className="widget-value">{speed ? value == null ? '—' : value.toFixed(1) : percent(value)}{speed && <small>tok/s</small>}</div>
      {speed ? <Sparkline points={data?.speed} english={en} /> : <div className="widget-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}><span style={{ width: `${value ?? 0}%` }} /></div>}
    </section>)}</div>
    <section className="widget-bottom">
      <div className="widget-today"><div className="widget-today-label"><span className="widget-icon"><Cube size={25} /></span>{t('今日 Token', 'Today’s tokens')}</div>
        <strong>{compact(data?.total)}</strong><p>{data?.change == null ? t('较昨日 —', 'vs yest. —') : <>{t('较昨日 ', 'vs yest. ')}{data.change >= 0 ? '+' : ''}{(data.change * 100).toFixed(1)}% <ArrowUpRight size={17} style={{ transform: data.change < 0 ? 'rotate(90deg)' : undefined }} /></>}</p>
      </div>
      <div className="widget-trend"><h2>{t('Token 使用趋势', 'Token usage')} <span>{t('(近 24 小时)', '(last 24h)')}</span></h2><Sparkline points={data?.timeline} large english={en} /></div>
    </section>
    <footer className="widget-footer"><span title={error || t('本机采集更新时间；额度采样时间见指标提示', 'Local collection time; hover quotas for their sample times')}><Clock size={21} />{error ? t('连接中断 · 自动重试', 'Disconnected · retrying') : `${t('最后更新：', 'Updated: ')}${data?.scan?.lastScan ? new Date(data.scan.lastScan).toLocaleString(en ? 'en-GB' : 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}`}</span>
      <button onClick={refresh} disabled={busy} title={t('立即刷新采集与额度', 'Refresh usage and quota now')}><ArrowClockwise size={21} className={busy ? 'spinning' : ''} />{busy ? t('刷新中', 'Refreshing') : t('自动刷新中', 'Auto-refreshing')}</button></footer>
  </main>;
}
