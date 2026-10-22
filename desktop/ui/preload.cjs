const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("archiveTune", {
  getConfig: () => ipcRenderer.invoke("get-config"),
});
