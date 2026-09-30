import React from 'react';
import {WarningCircle, ArrowClockwise} from '@phosphor-icons/react';
import {tr} from './i18n.mjs';

export class ErrorBoundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="app recovery-view" role="alert"><div className="panel"><WarningCircle size={26}/><h2>{tr('界面暂不可用')}</h2><p>{tr('重新载入界面以恢复，本机采集仍在后台运行。')}</p><button className="button" onClick={() => location.reload()}><ArrowClockwise size={16}/>{tr('重新载入')}</button></div></div>;
  }
}
