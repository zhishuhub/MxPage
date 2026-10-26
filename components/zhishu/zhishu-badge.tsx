"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useZhishu } from "./zhishu-gate";

/** 页头的接入状态，点开是设置里的「AI 服务」。 */
export function ZhishuBadge() {
  const zhishu = useZhishu();
  const connected = Boolean(zhishu?.status.connected);
  return <Link href="/settings/providers" className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
    <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-slate-400")} />
    {connected ? `AI 已接入${zhishu?.status.userName ? ` · ${zhishu.status.userName}` : ""}` : "未接入 AI"}
  </Link>;
}
