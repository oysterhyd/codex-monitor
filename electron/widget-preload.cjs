const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widget', {
  snapshot: () => ipcRenderer.invoke('widget:snapshot'),
  restore: () => ipcRenderer.invoke('widget:restore'),
  menu: () => ipcRenderer.invoke('widget:menu'),
  refresh: () => ipcRenderer.invoke('widget:refresh'),
  onUpdate: callback => {
    const listener = () => callback();
    ipcRenderer.on('update', listener);
    return () => ipcRenderer.removeListener('update', listener);
  },
});
