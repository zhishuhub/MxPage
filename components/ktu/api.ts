"use client";

import { useEffect } from "react";

async function data<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { success?: boolean; data?: T; error?: { message?: string } } | null;
  if (!body?.success) throw new Error(body?.error?.message || "请求失败，请稍后重试");
  return body.data as T;
}

export const api = {
  get: <T,>(url: string) => fetch(url, { cache: "no-store" }).then(response => data<T>(response)),
  send: <T,>(url: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown) => fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).then(response => data<T>(response)),
};

/** 页面打开时推进批量 / 定时任务（桌面壳在后台也会定时推进）。 */
export function useSchedulerTick(intervalMs = 5000) {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try { await fetch("/api/ktu/scheduler/tick", { method: "POST" }); } catch { /* 下次再推 */ }
      if (!stopped) timer = setTimeout(run, intervalMs);
    };
    void run();
    return () => { stopped = true; clearTimeout(timer); };
  }, [intervalMs]);
}

export type KtuDesktopBridge = {
  readClipboard(): Promise<string>;
  clearClipboard(expected: string): Promise<void>;
  openPath(target: string): Promise<void>;
  chooseFolder(): Promise<string>;
  getBackground(): Promise<{ autoLaunch: boolean; closeToTray: boolean }>;
  setBackground(value: { autoLaunch?: boolean; closeToTray?: boolean }): Promise<{ autoLaunch: boolean; closeToTray: boolean }>;
};

/** 桌面版才有；网页版返回 null，相关按钮不显示。 */
export function desktopBridge(): KtuDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { mxPageDesktop?: { ktu?: KtuDesktopBridge } }).mxPageDesktop?.ktu ?? null;
}

export async function readClipboardText() {
  try {
    const bridge = desktopBridge();
    return bridge ? await bridge.readClipboard() : await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

export function formatTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
