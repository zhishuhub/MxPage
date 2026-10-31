// K图桌面能力：托盘、关窗缩到托盘、开机自启、后台推进定时任务并弹系统通知、读剪贴板接入码、打开 / 选择输出文件夹。
const fs = require("fs");
const path = require("path");
const { app, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } = require("electron");

const TICK_INTERVAL_MS = 30_000;
const BUSY_TICK_INTERVAL_MS = 5_000;
const HIDDEN_ARG = "--hidden";

function settingsPath() {
  return path.join(app.getPath("userData"), "config", "ktu-desktop.json");
}

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { closeToTray: value.closeToTray !== false, autoLaunch: value.autoLaunch === true, trayTipShown: value.trayTipShown === true };
  } catch {
    return { closeToTray: true, autoLaunch: false, trayTipShown: false };
  }
}

function writeSettings(value) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** 开机自启时带 --hidden，只在托盘里运行。 */
function launchedHidden() {
  return process.argv.includes(HIDDEN_ARG) || app.getLoginItemSettings().wasOpenedAsHidden;
}

function createKtuDesktop({ getWindow, getServerUrl, showWindow, iconPath, trayIconPath, quit }) {
  let tray = null;
  let timer = null;
  let settings = readSettings();

  function trusted(event) {
    const serverUrl = getServerUrl();
    const url = event.senderFrame?.url || "";
    if (!serverUrl || !url.startsWith(serverUrl)) throw new Error("不允许的调用来源");
  }

  function background() {
    return { autoLaunch: settings.autoLaunch, closeToTray: settings.closeToTray };
  }

  function applyAutoLaunch() {
    if (!app.isPackaged) return;
    app.setLoginItemSettings({ openAtLogin: settings.autoLaunch, openAsHidden: true, args: [HIDDEN_ARG] });
  }

  ipcMain.handle("ktu:read-clipboard", event => { trusted(event); return clipboard.readText(); });
  // 接入成功后清掉剪贴板里的接入码；剪贴板已被换成别的内容就不动
  ipcMain.handle("ktu:clear-clipboard", (event, expected) => { trusted(event); if (clipboard.readText() === expected) clipboard.clear(); });
  ipcMain.handle("ktu:open-path", async (event, target) => {
    trusted(event);
    if (typeof target !== "string" || !path.isAbsolute(target)) throw new Error("文件夹路径无效");
    fs.mkdirSync(target, { recursive: true });
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  ipcMain.handle("ktu:choose-folder", async event => {
    trusted(event);
    const result = await dialog.showOpenDialog(getWindow() ?? undefined, { title: "选择输出文件夹", properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? "" : result.filePaths[0] || "";
  });
  ipcMain.handle("ktu:get-background", event => { trusted(event); return background(); });
  ipcMain.handle("ktu:set-background", (event, patch) => {
    trusted(event);
    settings = { ...settings, ...(typeof patch?.closeToTray === "boolean" ? { closeToTray: patch.closeToTray } : {}), ...(typeof patch?.autoLaunch === "boolean" ? { autoLaunch: patch.autoLaunch } : {}) };
    writeSettings(settings);
    applyAutoLaunch();
    return background();
  });

  function setupTray() {
    if (tray) return;
    const image = nativeImage.createFromPath(trayIconPath);
    tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(iconPath) : image.resize({ width: 16, height: 16 }));
    tray.setToolTip("K图");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开 K图", click: () => showWindow() },
      { label: "定时任务", click: () => showWindow("/ktu/schedules") },
      { type: "separator" },
      { label: "退出", click: () => quit() },
    ]));
    tray.on("click", () => showWindow());
  }

  /** 关窗时缩到托盘（设置里可关），第一次提示一下后台还在运行。 */
  function attachWindow(window) {
    window.on("close", event => {
      if (app.isQuitting || !settings.closeToTray) return;
      event.preventDefault();
      window.hide();
      if (!settings.trayTipShown && Notification.isSupported()) {
        new Notification({ title: "K图 在后台运行", body: "定时任务照常执行。右键托盘图标可以退出。", icon: iconPath }).show();
        settings = { ...settings, trayTipShown: true };
        writeSettings(settings);
      }
    });
  }

  /** 推进一次，返回还有没有批次在跑。 */
  async function tick() {
    const serverUrl = getServerUrl();
    if (!serverUrl) return false;
    try {
      const response = await fetch(`${serverUrl}/api/ktu/scheduler/tick`, { method: "POST", signal: AbortSignal.timeout(120_000) });
      const payload = await response.json();
      for (const item of payload?.data?.notifications ?? []) {
        if (!Notification.isSupported()) break;
        const notice = new Notification({ title: item.title, body: item.body, icon: iconPath });
        notice.on("click", () => showWindow(typeof item.href === "string" && item.href.startsWith("/ktu") ? item.href : "/ktu/schedules"));
        notice.show();
      }
      return payload?.data?.busy === true;
    } catch {
      // 本地服务忙或刚启动，下一轮再推
      return false;
    }
  }

  // 有批次在跑时 5 秒推进一次（一套跑完马上补开下一套），空闲时 30 秒
  let stopped = false;
  async function loop() {
    const busy = await tick();
    if (!stopped) timer = setTimeout(() => void loop(), busy ? BUSY_TICK_INTERVAL_MS : TICK_INTERVAL_MS);
  }

  function start() {
    setupTray();
    applyAutoLaunch();
    stopped = false;
    void loop();
  }

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    tray?.destroy();
    tray = null;
  }

  return { start, stop, attachWindow, keepRunningWhenClosed: () => settings.closeToTray };
}

module.exports = { createKtuDesktop, launchedHidden };
