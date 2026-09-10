const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widget', {
  snapshot: () => ipcRenderer.invoke('widget:snapshot'),
  restore: () => ipcRenderer.invoke('widget:restore'),
  menu: () => ipcRenderer.invoke('widget:menu'),
  resize: compact => ipcRenderer.invoke('widget:resize', compact),
  drag: payload => ipcRenderer.invoke('widget:drag', payload),
  refresh: () => ipcRenderer.invoke('widget:refresh'),
  onUpdate: callback => {
    const listener = () => callback();
    ipcRenderer.on('update', listener);
    return () => ipcRenderer.removeListener('update', listener);
  },
  onExit: callback => {
    const listener = () => callback();
    ipcRenderer.on('widget:exit', listener);
    return () => ipcRenderer.removeListener('widget:exit', listener);
  },
  onEnter: callback => {
    const listener = () => callback();
    ipcRenderer.on('widget:enter', listener);
    return () => ipcRenderer.removeListener('widget:enter', listener);
  },
});
