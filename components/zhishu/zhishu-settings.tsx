"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/components/ktu/api";
import { useZhishu } from "./zhishu-gate";

type VersionInfo = { current: string; latest: string; hasUpdate: boolean };

/** 设置里的「AI 服务」：显示接入账号，提供重新接入。地址、密钥、模型都由接入决定，不在这里改。 */
export function ZhishuSettings() {
  const zhishu = useZhishu();
  const [busy, setBusy] = useState(false);
  return <div className="space-y-6">
    <div><p className="text-xs text-muted-foreground">设置</p><h1 className="mt-1 text-2xl font-semibold">AI 服务</h1></div>
    <section className="space-y-4 rounded-2xl border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-medium">{zhishu?.status.connected ? "已接入" : "未接入"}</p>
          {zhishu?.status.userName && <p className="mt-1 text-sm text-muted-foreground">网站账号：{zhishu.status.userName}</p>}
        </div>
        <Button variant="outline" disabled={busy || !zhishu} onClick={async () => { setBusy(true); try { await zhishu?.reconnect(); } finally { setBusy(false); } }}>重新接入</Button>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">生成图文的费用从网站余额扣除。余额、用量和账单请到网站查看。</p>
      {zhishu?.status.siteOrigin && <a href={zhishu.status.siteOrigin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm underline">打开网站<ExternalLink className="h-3.5 w-3.5" /></a>}
    </section>
    <VersionCard />
  </div>;
}

export function VersionCard() {
  const zhishu = useZhishu();
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try { setInfo(await api.get<VersionInfo>("/api/zhishu/version")); } catch { setInfo(null); } finally { setChecking(false); }
  };
  useEffect(() => { void check(); }, []);
  return <section className="space-y-3 rounded-2xl border border-border p-6">
    <h2 className="font-semibold">版本</h2>
    <p className="text-sm">当前版本 v{info?.current ?? "—"}{info?.latest ? `，网站最新版本 v${info.latest}` : ""}</p>
    {info?.hasUpdate && <p className="text-sm">有新版本，请到网站「我的应用」下载安装。</p>}
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={checking} onClick={() => void check()}>检查更新</Button>
      {info?.hasUpdate && zhishu?.status.siteOrigin && <a href={zhishu.status.siteOrigin} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-accent">去网站下载<ExternalLink className="h-3.5 w-3.5" /></a>}
    </div>
  </section>;
}
