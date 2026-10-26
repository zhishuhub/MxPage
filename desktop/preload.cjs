const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mxPageDesktop", {
  runtime: "desktop",
  agent: {
    grant: (runId, planHash) => ipcRenderer.invoke("mxpage-agent:grant", runId, planHash),
    stop: () => ipcRenderer.invoke("mxpage-agent:stop"),
    status: () => ipcRenderer.invoke("mxpage-agent:status"),
    configureMcp: servers => ipcRenderer.invoke("mxpage-agent:configure-mcp", servers),
  },
  ktu: {
    readClipboard: () => ipcRenderer.invoke("ktu:read-clipboard"),
    clearClipboard: expected => ipcRenderer.invoke("ktu:clear-clipboard", expected),
    openPath: target => ipcRenderer.invoke("ktu:open-path", target),
    chooseFolder: () => ipcRenderer.invoke("ktu:choose-folder"),
    getBackground: () => ipcRenderer.invoke("ktu:get-background"),
    setBackground: value => ipcRenderer.invoke("ktu:set-background", value),
  },
});
