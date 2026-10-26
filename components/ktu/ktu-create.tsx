"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { KTU_TEMPLATES, KTU_TIERS } from "@/lib/ktu/catalog";
import { cn } from "@/lib/utils";
import { api, formatTime, useSchedulerTick } from "./api";
import { JOB_STATE_LABEL, type KtuBatchView, type KtuCityView, type KtuJobView } from "./types";

const chip = (active: boolean) => cn("rounded-xl border px-3 py-2 text-sm transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent");

export function KtuCreate() {
  useSchedulerTick();
  const [cities, setCities] = useState<KtuCityView[] | null>(null);
  const [scope, setScope] = useState<"cities" | "tiers">("cities");
  const [cityIds, setCityIds] = useState<string[]>([]);
  const [tiers, setTiers] = useState<string[]>([]);
  const [templates, setTemplates] = useState<string[]>(KTU_TEMPLATES.map(template => template.key));
  const [picked, setPicked] = useState<string[]>([]);
  const [aspect, setAspect] = useState<"3:4" | "9:16">("3:4");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get<KtuCityView[]>("/api/ktu/cities").then(setCities).catch(error => toast.error(error.message)); }, []);

  const toggle = (list: string[], value: string) => list.includes(value) ? list.filter(item => item !== value) : [...list, value];
  const scopedCities = useMemo(() => (cities ?? []).filter(city => scope === "cities" ? cityIds.includes(city.id) : tiers.includes(city.tier)), [cities, scope, cityIds, tiers]);
  const singleCity = scope === "cities" && scopedCities.length === 1 ? scopedCities[0] : null;
  const canPick = singleCity && templates.some(key => key === "recommend" || key === "single");
  const total = scopedCities.length * templates.length;

  const start = async () => {
    setBusy(true);
    try {
      const result = await api.send<{ planned: number; skipped: string[] }>("/api/ktu/batches", "POST", { cityIds: scope === "cities" ? cityIds : [], tiers: scope === "tiers" ? tiers : [], templateKeys: templates, picked: canPick ? picked : [], aspect });
      toast.success(`已开始生成 ${result.planned} 套`);
      if (result.skipped.length) toast.message(`有 ${result.skipped.length} 套资料不够，已跳过`, { description: result.skipped.slice(0, 3).join("\n") });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "开始失败");
    } finally {
      setBusy(false);
    }
  };

  if (cities && !cities.length) {
    return <section className="mx-auto max-w-3xl space-y-4 py-10 text-center">
      <h1 className="text-2xl font-semibold">先添加城市和商K店名</h1>
      <p className="text-muted-foreground">资料库里还没有城市。到资料库导入城市店名 Excel，或者手动添加城市、粘贴店名，就能生成图文。</p>
      <Link href="/ktu/library" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm text-primary-foreground">去资料库</Link>
    </section>;
  }

  return <section className="mx-auto max-w-5xl space-y-8 py-2">
    <header><p className="text-sm text-muted-foreground">商K宣传</p><h1 className="mt-2 text-3xl font-semibold">选城市和模板，一键出抖音图文</h1><p className="mt-2 text-muted-foreground">每套图文包含配图、标题、正文和话题标签，按顺序一套一套生成。</p></header>

    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">城市</h2>
        <div className="ml-auto flex gap-1 rounded-xl border border-border p-1 text-sm">
          {(["cities", "tiers"] as const).map(value => <button key={value} type="button" onClick={() => setScope(value)} className={cn("rounded-lg px-3 py-1", scope === value ? "bg-secondary font-medium" : "text-muted-foreground")}>{value === "cities" ? "按城市" : "按城市等级"}</button>)}
        </div>
      </div>
      {!cities ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : scope === "cities"
        ? [...KTU_TIERS, { key: "", label: "未分级" }].map(tier => {
          const list = cities.filter(city => tier.key ? city.tier === tier.key : !KTU_TIERS.some(item => item.key === city.tier));
          if (!list.length) return null;
          return <div key={tier.key || "none"} className="space-y-2"><p className="text-xs text-muted-foreground">{tier.label}</p><div className="flex flex-wrap gap-2">{list.map(city => <button key={city.id} type="button" className={chip(cityIds.includes(city.id))} onClick={() => { setCityIds(toggle(cityIds, city.id)); setPicked([]); }}>{city.name}<span className="ml-1 opacity-70">{city.venues.length}</span></button>)}</div></div>;
        })
        : <div className="flex flex-wrap gap-2">{KTU_TIERS.map(tier => { const count = cities.filter(city => city.tier === tier.key).length; return <button key={tier.key} type="button" disabled={!count} className={cn(chip(tiers.includes(tier.key)), !count && "opacity-40")} onClick={() => setTiers(toggle(tiers, tier.key))}>{tier.label}<span className="ml-1 opacity-70">{count} 城</span></button>; })}</div>}
    </div>

    <div className="space-y-3">
      <h2 className="font-semibold">模板</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {KTU_TEMPLATES.map(template => <button key={template.key} type="button" onClick={() => setTemplates(toggle(templates, template.key))} className={cn("rounded-2xl border p-4 text-left transition-colors", templates.includes(template.key) ? "border-primary ring-1 ring-primary" : "border-border hover:bg-accent")}>
          <p className="font-medium">{template.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{template.summary}</p>
        </button>)}
      </div>
    </div>

    {canPick && singleCity && <div className="space-y-3">
      <h2 className="font-semibold">指定店铺<span className="ml-2 text-sm font-normal text-muted-foreground">选填，用于精选推荐和单个商K介绍；不选就自动轮换</span></h2>
      <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">{singleCity.venues.map(venue => <button key={venue.id} type="button" className={chip(picked.includes(venue.id))} onClick={() => setPicked(toggle(picked, venue.id))}>{venue.name}</button>)}</div>
    </div>}

    <div className="flex flex-wrap items-center gap-4">
      <div className="flex gap-1 rounded-xl border border-border p-1 text-sm">{(["3:4", "9:16"] as const).map(value => <button key={value} type="button" onClick={() => setAspect(value)} className={cn("rounded-lg px-3 py-1", aspect === value ? "bg-secondary font-medium" : "text-muted-foreground")}>{value} 竖版</button>)}</div>
      <Button className="h-12 flex-1" disabled={busy || !total} onClick={() => void start()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{total ? `开始生成 ${total} 套` : "请选择城市和模板"}</Button>
    </div>

    <KtuRecords />
  </section>;
}

export function KtuRecords({ runId, limit = 30, title = "生成记录" }: { runId?: string; limit?: number; title?: string }) {
  const [jobs, setJobs] = useState<KtuJobView[] | null>(null);
  const [batches, setBatches] = useState<KtuBatchView[]>([]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [nextJobs, nextBatches] = await Promise.all([api.get<KtuJobView[]>(`/api/ktu/jobs?limit=${limit}${runId ? `&runId=${runId}` : ""}`), api.get<KtuBatchView[]>("/api/ktu/batches")]);
        if (!stopped) { setJobs(nextJobs); setBatches(nextBatches); }
      } catch { /* 下次再取 */ }
      if (!stopped) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [runId, limit]);
  const running = batches.filter(batch => batch.status === "running");
  const stop = async (id: string) => { try { await api.send(`/api/ktu/batches/${id}/stop`, "POST"); toast.success("已停止"); } catch (error) { toast.error(error instanceof Error ? error.message : "停止失败"); } };

  return <div className="space-y-4">
    <h2 className="font-semibold">{title}</h2>
    {running.map(batch => <div key={batch.id} role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background p-4 text-sm">
      <span>{batch.kind === "manual" ? "批量生成" : `定时任务「${batch.name}」`}：第 {Math.min(batch.nextIndex, batch.planned)} / {batch.planned} 套，成功 {batch.succeeded}{batch.failed ? `，未完成 ${batch.failed}` : ""}</span>
      <Button size="sm" variant="outline" onClick={() => void stop(batch.id)}>停止这一批</Button>
    </div>)}
    {!jobs ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : !jobs.length ? <p className="text-sm text-muted-foreground">还没有生成过图文。</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map(job => {
        const cover = job.pages.find(page => page.imageUrl && !page.discarded)?.imageUrl;
        const checks = job.pages.filter(page => page.needsCheck && !page.discarded).length;
        return <Link key={job.id} href={`/ktu/jobs/${job.id}`} className="flex gap-3 rounded-2xl border border-border p-3 transition-colors hover:bg-accent">
          <div className="h-24 w-[72px] shrink-0 overflow-hidden rounded-xl bg-muted">{cover && <img src={cover} alt="" className="h-full w-full object-cover" />}</div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate font-medium">{job.cityName} · {job.templateName}</p>
            <p className="text-xs text-muted-foreground">{formatTime(job.createdAt)}{job.scheduled ? " · 定时" : ""}</p>
            <p className="text-xs">{JOB_STATE_LABEL[job.state]} · {job.generated}/{job.total || "—"} 张</p>
            {(checks > 0 || job.compliance.length > 0) && <p className="text-xs text-destructive">{[checks ? `${checks} 张需检查` : "", job.compliance.length ? `${job.compliance.length} 处文字待修改` : ""].filter(Boolean).join(" · ")}</p>}
          </div>
        </Link>;
      })}
    </div>}
  </div>;
}

