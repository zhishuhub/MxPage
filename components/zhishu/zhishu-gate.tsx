"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, desktopBridge, readClipboardText } from "@/components/ktu/api";

const CODE_PATTERN = /APP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/;
const VERIFY_INTERVAL_MS = 60_000;

export type ZhishuStatus = { connected: boolean; userName: string; siteOrigin: string; appKey: string; message: string };
type ZhishuContextValue = { status: ZhishuStatus; reconnect: () => Promise<void> };

const ZhishuContext = createContext<ZhishuContextValue | null>(null);
export function useZhishu() {
  return useContext(ZhishuContext);
}

/**
 * 接入前只显示接入页；接入后切回窗口时（最多一分钟一次）确认接入还有效。
 * 在网站停止授权后，接入页盖在工作台上面，页面不卸载，重新接入后接着用。
 */
export function ZhishuGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ZhishuStatus | null>(null);
  const [everConnected, setEverConnected] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [tip, setTip] = useState("");
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const lastVerifyRef = useRef(0);

  const apply = useCallback((next: ZhishuStatus) => {
    setStatus(next);
    setTip(next.message);
    if (next.connected) setEverConnected(true);
  }, []);

  useEffect(() => {
    let disposed = false;
    api.get<ZhishuStatus>("/api/zhishu/status?verify=1").then(next => {
      if (disposed) return;
      lastVerifyRef.current = Date.now();
      apply(next);
    }).catch(() => { if (!disposed) setLoadError(true); });
    return () => { disposed = true; };
  }, [apply, attempt]);

  const tryConnect = useCallback(async (raw: string, fromClipboard: boolean) => {
    const match = raw.toUpperCase().match(CODE_PATTERN);
    if (!match || connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    setTip("正在接入…");
    try {
      const next = await api.send<ZhishuStatus>("/api/zhishu/connect", "POST", { code: match[0] });
      apply(next);
      if (next.connected) {
        setCode("");
        if (fromClipboard) await desktopBridge()?.clearClipboard(raw).catch(() => undefined);
      }
    } catch {
      setTip("接入没有完成，请重启应用后再试");
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [apply]);

  // 没接入时：打开和切回窗口都读一次剪贴板；接入后：切回窗口时确认接入还有效
  useEffect(() => {
    if (!status) return;
    const onFocus = async () => {
      if (!status.connected) {
        const clip = await readClipboardText();
        if (CODE_PATTERN.test(clip.toUpperCase())) void tryConnect(clip, true);
        return;
      }
      if (Date.now() - lastVerifyRef.current < VERIFY_INTERVAL_MS) return;
      lastVerifyRef.current = Date.now();
      try {
        const next = await api.get<ZhishuStatus>("/api/zhishu/status?verify=1");
        if (!next.connected) apply(next);
      } catch {
        // 本地服务暂时没响应时不打扰用户，下次切回窗口再查
      }
    };
    if (!status.connected) void onFocus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [status, tryConnect, apply]);

  const reconnect = useCallback(async () => {
    apply(await api.send<ZhishuStatus>("/api/zhishu/disconnect", "POST"));
  }, [apply]);

  const pasteFromClipboard = async () => {
    const clip = await readClipboardText();
    setCode(clip.trim());
    if (!CODE_PATTERN.test(clip.toUpperCase())) {
      setTip("剪贴板里没有接入码，请回到网站重新点「一键接入」");
      return;
    }
    void tryConnect(clip, true);
  };

  if (loadError) {
    return <main className="flex min-h-screen items-center justify-center p-6">
      <section role="alert" className="w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-8 text-center shadow-soft">
        <p>读取接入信息失败，请重试</p>
        <Button onClick={() => { setLoadError(false); setAttempt(n => n + 1); }}>重试</Button>
      </section>
    </main>;
  }
  if (!status) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></main>;

  const connectPage = (
    <main className={everConnected ? "fixed inset-0 z-[200] flex items-center justify-center bg-background/95 p-6" : "flex min-h-screen items-center justify-center p-6"}>
      <section aria-labelledby="zs-gate-title" className="w-full max-w-lg space-y-6 rounded-3xl border border-border bg-card p-8 shadow-soft">
        <div className="flex items-center gap-3">
          <img src="/brand-icon.png" alt="" className="h-12 w-12 rounded-2xl" />
          <h1 id="zs-gate-title" className="text-2xl font-semibold">先接入 AI</h1>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">接入后用你在网站上的账号生成图文，费用从余额扣除。</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
          <li>回到网站，在「我的应用」里找到本应用，点「一键接入」，接入码会自动复制。</li>
          <li>回到这里，接入码会被自动识别；没反应就粘贴到下面的输入框。</li>
        </ol>
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={event => { setCode(event.target.value); void tryConnect(event.target.value, false); }}
            placeholder="APP-XXXX-XXXX-XXXX"
            aria-label="接入码"
            spellCheck={false}
            autoFocus
          />
          <Button variant="secondary" disabled={connecting} onClick={() => void pasteFromClipboard()}>粘贴</Button>
        </div>
        <p role="status" aria-live="polite" className={tip && !connecting ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{tip}</p>
      </section>
    </main>
  );

  if (!everConnected) return connectPage;
  return <ZhishuContext.Provider value={{ status, reconnect }}>
    {children}
    {!status.connected && connectPage}
  </ZhishuContext.Provider>;
}
