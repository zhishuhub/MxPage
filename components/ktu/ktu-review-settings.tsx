"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "./api";

type GenerationSettings = { reviewEnabled: boolean; reviewRequirements: string; concurrency: number; autoExport: boolean; defaultReviewRequirements?: string };

const CONCURRENCY_CHOICES = [1, 2, 3, 4, 5, 6];

function Switch({ checked, label, busy, onToggle }: { checked: boolean; label: string; busy: boolean; onToggle: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={busy} onClick={onToggle}
    className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted")}>
    <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-6" : "left-1")} />
  </button>;
}

/** 设置里的「生成设置」：同时生成几套、生成完自动导出、出图检查的开关和检查要求。 */
export function KtuReviewSettings() {
  const [settings, setSettings] = useState<GenerationSettings | null>(null);
  const [requirements, setRequirements] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<GenerationSettings>("/api/ktu/settings").then(next => { setSettings(next); setRequirements(next.reviewRequirements); }).catch(error => toast.error(error instanceof Error ? error.message : "读取失败"));
  }, []);

  const save = async (patch: Partial<GenerationSettings>, success: string) => {
    setBusy(true);
    try { const next = await api.send<GenerationSettings>("/api/ktu/settings", "PATCH", patch); setSettings(current => ({ ...current, ...next })); setRequirements(next.reviewRequirements); toast.success(success); }
    catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <div><p className="text-xs text-muted-foreground">设置</p><h1 className="mt-1 text-2xl font-semibold">生成设置</h1></div>
    {!settings ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <>
      <section className="space-y-4 rounded-2xl border border-border p-6">
        <div><p className="font-medium">同时生成几套</p><p className="mt-1 text-sm text-muted-foreground">批量生成和定时任务一次开几套一起画。开得越多越快；网站忙、连续超时时会自动少开几套，顺了再加回来。</p></div>
        <div className="flex flex-wrap gap-2">
          {CONCURRENCY_CHOICES.map(value => <button key={value} type="button" disabled={busy} onClick={() => void save({ concurrency: value }, `已改为同时生成 ${value} 套`)}
            className={cn("h-10 min-w-12 rounded-xl border px-3 text-sm transition-colors", settings.concurrency === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent")}>{value} 套</button>)}
        </div>
        <p className="text-xs text-muted-foreground">每套里同时画 2 张图，同时 3 套就是 6 张一起画。</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <div><p className="font-medium">生成完自动导出</p><p className="mt-1 text-sm text-muted-foreground">手动批量生成的每一套画完就存到输出文件夹，和定时任务放在一起，按「日期 / 城市 / 模板」分文件夹。定时任务总是自动导出。</p></div>
          <Switch checked={settings.autoExport} label="生成完自动导出" busy={busy} onToggle={() => void save({ autoExport: !settings.autoExport }, settings.autoExport ? "已关闭自动导出" : "已打开自动导出")} />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <div><p className="font-medium">出图后检查</p><p className="mt-1 text-sm text-muted-foreground">{settings.reviewEnabled ? "已打开" : "已关闭"}，对手动生成和定时任务都生效</p></div>
          <Switch checked={settings.reviewEnabled} label="出图后检查" busy={busy} onToggle={() => void save({ reviewEnabled: !settings.reviewEnabled }, settings.reviewEnabled ? "已关闭出图检查" : "已打开出图检查")} />
        </div>
        <div className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p><span className="font-medium text-foreground">出图检查是什么：</span>每张图画完后，让 AI 看一遍，核对图上的字和这张图应该写的是否一致，以及是否符合下面的检查要求。最后再把整组图一起看一遍。</p>
          <p><span className="font-medium text-foreground">怎么工作：</span>没通过的图会自动重画一次；重画后还不合格，就标上「需检查」，由你决定保留还是丢弃。检查没来得及做完不影响出图，那张图会标「没检查」。每检查一张会多用一次对话额度，重画会多用一次生图额度。</p>
          <p><span className="font-medium text-foreground">关掉后：</span>画完就直接算完成，更快、更省额度，图要你自己看。</p>
        </div>
      </section>

      <section className={cn("space-y-3 rounded-2xl border border-border p-6", !settings.reviewEnabled && "opacity-60")}>
        <div><p className="font-medium">检查要求</p><p className="mt-1 text-sm text-muted-foreground">一行一条，AI 检查时逐条核对。可以改，也可以加上你自己的要求。</p></div>
        <Textarea rows={6} value={requirements} onChange={event => setRequirements(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || requirements === settings.reviewRequirements} onClick={() => void save({ reviewRequirements: requirements }, "已保存检查要求")}>保存</Button>
          {settings.defaultReviewRequirements && <Button variant="ghost" disabled={busy} onClick={() => setRequirements(settings.defaultReviewRequirements!)}>恢复默认要求</Button>}
        </div>
        <p className="text-xs text-muted-foreground">改了只影响之后开始生成的图，正在生成的按开始时的设置。</p>
      </section>
    </>}
  </div>;
}
