"use client";

import { useEffect, useState } from "react";
import { ArrowUpCircle } from "lucide-react";

import { useZhishu } from "@/components/zhishu/zhishu-gate";
import { api } from "./api";

const BALANCE_INTERVAL_MS = 60_000;
const VERSION_INTERVAL_MS = 6 * 60 * 60_000;

/** 页头：剩余额度（网站支持时才显示）和新版本提示（点了去网站「我的应用」下载）。 */
export function KtuHeaderStatus() {
  const zhishu = useZhishu();
  const connected = Boolean(zhishu?.status.connected);
  const siteOrigin = zhishu?.status.siteOrigin ?? "";
  const [balance, setBalance] = useState("");
  const [latest, setLatest] = useState("");

  useEffect(() => {
    if (!connected) { setBalance(""); return; }
    let stopped = false;
    const load = () => api.get<{ display: string }>("/api/zhishu/balance").then(result => { if (!stopped) setBalance(result.display); }).catch(() => undefined);
    void load();
    const timer = setInterval(load, BALANCE_INTERVAL_MS);
    window.addEventListener("focus", load);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("focus", load); };
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    const check = () => api.get<{ latest: string; hasUpdate: boolean }>("/api/zhishu/version").then(result => { if (!stopped) setLatest(result.hasUpdate ? result.latest : ""); }).catch(() => undefined);
    void check();
    const timer = setInterval(check, VERSION_INTERVAL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [connected]);

  return <>
    {latest && siteOrigin && <a href={`${siteOrigin}/apps/library`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">
      <ArrowUpCircle aria-hidden="true" className="h-3.5 w-3.5" />有新版本 v{latest}，去下载
    </a>}
    {balance && <span className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">剩余额度 {balance}</span>}
  </>;
}
