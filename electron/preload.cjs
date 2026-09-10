const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("monitor", {
  snapshot: (filter) => ipcRenderer.invoke("snapshot", filter),
  account: value => ipcRenderer.invoke("account", value),
  assignAccount: value => ipcRenderer.invoke("assignAccount", value),
  settings: (value) => ipcRenderer.invoke("settings", value),
  price: (value) => ipcRenderer.invoke("price", value),
  refresh: () => ipcRenderer.invoke("refresh"),
  export: (filter) => ipcRenderer.invoke("export", filter),
  clear: () => ipcRenderer.invoke("clear"),
  pickExecutable: () => ipcRenderer.invoke("pickExecutable"),
  openData: () => ipcRenderer.invoke("openData"),
  widgetMode: (on) => ipcRenderer.invoke("widgetMode", on),
  onWidgetMode: callback => {
    const listener = (_, on) => callback(on);
    ipcRenderer.on("widget:mode", listener);
    return () => ipcRenderer.removeListener("widget:mode", listener);
  },
  onEnterApp: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:enter", listener);
    return () => ipcRenderer.removeListener("app:enter", listener);
  },
  onUpdate: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on("update", listener);
    return () => ipcRenderer.removeListener("update", listener);
  },
});
