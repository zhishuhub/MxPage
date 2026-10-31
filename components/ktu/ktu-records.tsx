"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, desktopBridge, formatTime, useSchedulerTick } from "./api";
import { formatDuration, jobStatusLine, type KtuBatchView, type KtuJobState, type KtuJobView } from "./types";

type Filter = "all" | "running" | "done" | "attention";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "全部" }, { key: "running", label: "生成中" }, { key: "done", label: "已完成" }, { key: "attention", label: "需处理" },
];
const matches = (state: KtuJobState, filter: Filter) => filter === "all" || (filter === "running" ? state === "running" : filter === "done" ? state === "done" : state === "incomplete" || state === "failed" || state === "stopped");
const cursorOf = (job: KtuJobView) => `${job.createdAt}|${job.id}`;
const unfinished = (job: KtuJobView) => job.state === "incomplete" || job.state === "failed" || job.state === "stopped";

/**
 * 生成记录：按状态筛选、加载更多；生成中每两三秒刷新进度；在跑的批次显示还在排队的几套。
 * 「选择」后可以勾选、全选已加载的，批量删除（连图片文件）、导出、没完成的接着生成。
 */
export function KtuRecords({ pageSize = 30, title = "生成记录", refreshKey = 0, moreHref }: { pageSize?: number; title?: string; refreshKey?: number; moreHref?: string }) {
  // 看着生成记录时也推进批次，一套跑完马上补开下一套
  useSchedulerTick();
  const [jobs, setJobs] = useState<KtuJobView[] | null>(null);
  const [batches, setBatches] = useState<KtuBatchView[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [, setNow] = useState(0);
  const jobsRef = useRef<KtuJobView[] | null>(null);
  jobsRef.current = jobs;

  /** 刷新第一页和已加载里在生成的几套；更早加载的保留。 */
  const refresh = useCallback(async (current: Filter) => {
    const loaded = jobsRef.current ?? [];
    const firstPage = await api.get<KtuJobView[]>(`/api/ktu/jobs?limit=${pageSize}&lite=1&filter=${current}`);
    const firstIds = new Set(firstPage.map(job => job.id));
    const older = firstPage.length < pageSize ? [] : loaded.filter(job => !firstIds.has(job.id) && cursorOf(job) < cursorOf(firstPage[firstPage.length - 1]));
    const runningOlder = older.filter(job => job.state === "running").map(job => job.id);
    const updates = runningOlder.length ? await api.get<KtuJobView[]>(`/api/ktu/jobs?lite=1&ids=${runningOlder.join(",")}`) : [];
    const fresh = new Map(updates.map(job => [job.id, job]));
    const next = [...firstPage, ...older.map(job => fresh.get(job.id) ?? job).filter(job => matches(job.state, current))];
    setJobs(next);
    if (!loaded.length) setHasMore(firstPage.length === pageSize);
    setSelected(previous => new Set([...previous].filter(id => next.some(job => job.id === id))));
    setBatches(await api.get<KtuBatchView[]>("/api/ktu/batches"));
  }, [pageSize]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(filter); } catch { /* 下次再取 */ }
      if (stopped) return;
      setNow(Date.now());
      const busyNow = (jobsRef.current ?? []).some(job => job.state === "running");
      timer = setTimeout(poll, busyNow ? 2500 : 10000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [filter, refresh, refreshKey]);

  const changeFilter = (next: Filter) => {
    if (next === filter) return;
    jobsRef.current = null;
    setJobs(null);
    setSelected(new Set());
    setFilter(next);
  };

  const loadMore = async () => {
    const list = jobs ?? [];
    if (!list.length) return;
    setLoadingMore(true);
    try {
      const page = await api.get<KtuJobView[]>(`/api/ktu/jobs?limit=${pageSize}&lite=1&filter=${filter}&before=${encodeURIComponent(cursorOf(list[list.length - 1]))}`);
      setJobs(current => [...(current ?? []), ...page.filter(job => !(current ?? []).some(item => item.id === job.id))]);
      setHasMore(page.length === pageSize);
    } catch (error) { toast.error(error instanceof Error ? error.message : "加载失败"); }
    finally { setLoadingMore(false); }
  };

  const stopBatch = async (id: string) => {
    try { await api.send(`/api/ktu/batches/${id}/stop`, "POST"); toast.success("已停止"); await refresh(filter); }
    catch (error) { toast.error(error instanceof Error ? error.message : "停止失败"); }
  };

  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allSelected = Boolean(jobs?.length) && jobs!.every(job => selected.has(job.id));
  const chosen = (jobs ?? []).filter(job => selected.has(job.id));

  const bulk = async (action: "delete" | "export" | "retry", ids: string[]) => {
    if (!ids.length) return;
    if (action === "delete" && !window.confirm(`删除选中的 ${ids.length} 套图文？应用里存的图片也会一起删掉，不能恢复（已经导出到文件夹的不受影响）。`)) return;
    setBusy(true);
    try {
      const result = await api.send<{ deleted?: number; exported?: number; skipped?: number; dir?: string; resumed?: number }>("/api/ktu/jobs/bulk", "POST", { action, ids });
      if (action === "delete") { toast.success(`已删除 ${result.deleted ?? 0} 套`); setSelected(new Set()); }
      if (action === "export") toast.success(`已导出 ${result.exported ?? 0} 套${result.skipped ? `，${result.skipped} 套还没有图，跳过` : ""}`, { description: result.dir, action: result.dir && desktopBridge() ? { label: "打开文件夹", onClick: () => void desktopBridge()?.openPath(result.dir!) } : undefined });
      if (action === "retry") toast.success(result.resumed ? `已重新开始 ${result.resumed} 套` : "选中的都不需要重新生成");
      if (action === "delete") jobsRef.current = (jobsRef.current ?? []).filter(job => !ids.includes(job.id));
      await refresh(filter);
    } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  };

  const running = batches.filter(batch => batch.status === "running");
  const queued = filter === "all" || filter === "running" ? running.flatMap(batch => batch.queued) : [];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="font-semibold">{title}</h2>
      <div className="flex gap-1 rounded-xl border border-border p-1 text-sm">
        {FILTERS.map(item => <button key={item.key} type="button" onClick={() => changeFilter(item.key)} className={cn("rounded-lg px-3 py-1", filter === item.key ? "bg-secondary font-medium" : "text-muted-foreground")}>{item.label}</button>)}
      </div>
      <div className="ml-auto flex gap-2">
        {moreHref && <Link href={moreHref} className="inline-flex h-9 items-center px-2 text-sm text-muted-foreground underline hover:text-foreground">查看全部</Link>}
        {!!jobs?.length && <Button size="sm" variant={selecting ? "secondary" : "outline"} onClick={() => { setSelecting(value => !value); setSelected(new Set()); }}>{selecting ? "完成" : "选择"}</Button>}
      </div>
    </div>

    {selecting && <div role="toolbar" aria-label="批量操作" className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 text-sm shadow-soft">
      <label className="flex items-center gap-2"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set((jobs ?? []).map(job => job.id)))} />全选{hasMore ? "已加载的" : ""}</label>
      <span className="text-muted-foreground">已选 {selected.size} 套</span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !chosen.length} onClick={() => void bulk("export", chosen.map(job => job.id))}>导出</Button>
        <Button size="sm" variant="outline" disabled={busy || !chosen.some(unfinished)} onClick={() => void bulk("retry", chosen.filter(unfinished).map(job => job.id))}>继续生成</Button>
        <Button size="sm" variant="outline" className="text-destructive" disabled={busy || !chosen.length} onClick={() => void bulk("delete", chosen.map(job => job.id))}>{busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}删除</Button>
      </div>
    </div>}

    {running.map(batch => <div key={batch.id} role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background p-4 text-sm">
      <span>
        {batch.kind === "manual" ? "批量生成" : `定时任务「${batch.name}」`}：已开始 {Math.min(batch.nextIndex, batch.planned)} / {batch.planned} 套，成功 {batch.succeeded}{batch.failed ? `，未完成 ${batch.failed}` : ""}
        <span className="text-muted-foreground"> · 同时 {batch.concurrency.effective} 套{batch.concurrency.effective < batch.concurrency.configured ? `（网站较忙，暂时从 ${batch.concurrency.configured} 套降下来）` : ""}</span>
      </span>
      <Button size="sm" variant="outline" onClick={() => void stopBatch(batch.id)}>停止这一批</Button>
    </div>)}

    {!jobs ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : !jobs.length && !queued.length ? <p className="text-sm text-muted-foreground">{filter === "all" ? "还没有生成过图文。" : "没有符合的图文。"}</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map(job => <RecordCard key={job.id} job={job} selecting={selecting} selected={selected.has(job.id)} onToggle={() => toggle(job.id)} />)}
      {queued.slice(0, 12).map((item, index) => <div key={`queued-${index}`} className="flex gap-3 rounded-2xl border border-dashed border-border p-3 opacity-70">
        <div className="h-24 w-[72px] shrink-0 rounded-xl bg-muted" />
        <div className="min-w-0 flex-1 space-y-1"><p className="truncate font-medium">{item.cityName} · {item.templateName}</p><p className="text-xs text-muted-foreground">排队中</p></div>
      </div>)}
      {queued.length > 12 && <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground">还有 {queued.length - 12} 套排队中</div>}
    </div>}

    {hasMore && !!jobs?.length && <div className="flex justify-center"><Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}加载更多</Button></div>}
  </div>;
}

function RecordCard({ job, selecting, selected, onToggle }: { job: KtuJobView; selecting: boolean; selected: boolean; onToggle: () => void }) {
  const cover = job.pages.find(page => page.imageUrl && !page.discarded)?.imageUrl;
  const body = <>
    <div className="relative h-24 w-[72px] shrink-0 overflow-hidden rounded-xl bg-muted">
      {cover && <img src={cover} alt="" className="h-full w-full object-cover" />}
      {job.state === "running" && <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10"><div className="h-full bg-primary transition-all" style={{ width: `${job.total ? Math.round(job.generated / job.total * 100) : 5}%` }} /></div>}
      {selecting && <span className={cn("absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-md border", selected ? "border-primary bg-primary text-primary-foreground" : "border-white bg-black/30")}>{selected && <Check className="h-3.5 w-3.5" />}</span>}
    </div>
    <div className="min-w-0 flex-1 space-y-1">
      <p className="truncate font-medium">{job.cityName} · {job.templateName}</p>
      <p className="text-xs text-muted-foreground">{formatTime(job.createdAt)}{job.scheduled ? " · 定时" : ""}{job.state === "running" ? ` · 已用 ${formatDuration(Date.now() - new Date(job.createdAt).getTime())}` : ""}</p>
      <p className={cn("text-xs", (job.state === "incomplete" || job.state === "failed") && "text-destructive")}>{jobStatusLine(job)}</p>
      {job.compliance.length > 0 && <p className="text-xs text-destructive">{job.compliance.length} 处文字待修改</p>}
    </div>
  </>;
  const className = cn("flex gap-3 rounded-2xl border p-3 text-left transition-colors hover:bg-accent", selected ? "border-primary ring-1 ring-primary" : "border-border");
  return selecting
    ? <button type="button" aria-pressed={selected} className={className} onClick={onToggle}>{body}</button>
    : <Link href={`/ktu/jobs/${job.id}`} className={className}>{body}</Link>;
}
