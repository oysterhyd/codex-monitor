const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("monitor", {
  snapshot: (filter) => ipcRenderer.invoke("snapshot", filter),
  settings: (value) => ipcRenderer.invoke("settings", value),
  price: (value) => ipcRenderer.invoke("price", value),
  refresh: () => ipcRenderer.invoke("refresh"),
  export: (filter) => ipcRenderer.invoke("export", filter),
  clear: () => ipcRenderer.invoke("clear"),
  pickExecutable: () => ipcRenderer.invoke("pickExecutable"),
  openData: () => ipcRenderer.invoke("openData"),
  onUpdate: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on("update", listener);
    return () => ipcRenderer.removeListener("update", listener);
  },
});
