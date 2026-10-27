"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, desktopBridge, formatTime, useSchedulerTick } from "./api";
import { JOB_STATE_LABEL, type KtuJobView, type KtuPageView } from "./types";

/** 把命中的待修改词标红。 */
function Highlighted({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return <>{text.split(pattern).map((part, index) => words.includes(part) ? <mark key={index} className="rounded bg-destructive/15 px-0.5 text-destructive">{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>;
}

export function KtuJobView({ jobId }: { jobId: string }) {
  useSchedulerTick();
  const router = useRouter();
  const [job, setJob] = useState<KtuJobView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingPage, setEditingPage] = useState<KtuPageView | null>(null);
  const [editingPost, setEditingPost] = useState(false);

  const load = useCallback(async () => {
    try { setJob(await api.get<KtuJobView>(`/api/ktu/jobs/${jobId}`)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
  }, [jobId]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await load(); if (!stopped) timer = setTimeout(poll, 3000); };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [load]);

  const act = async (body: Record<string, unknown>, success?: string) => {
    setBusy(true);
    try {
      const result = await api.send<KtuJobView | { dir: string; needsCheck: boolean }>(`/api/ktu/jobs/${jobId}`, "POST", body);
      if ("dir" in result) {
        toast.success("已导出", { description: result.dir, action: desktopBridge() ? { label: "打开文件夹", onClick: () => void desktopBridge()?.openPath(result.dir) } : undefined });
        await load();
      } else {
        setJob(result);
        if (success) toast.success(success);
      }
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("删除这套图文？删除后不能恢复。")) return;
    try { await api.send(`/api/ktu/jobs/${jobId}`, "DELETE"); router.replace("/ktu"); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "删除失败"); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("已复制"); } catch { toast.error("复制失败，请选中文字手动复制"); }
  };

  if (error && !job) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!job) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;

  const running = job.state === "running" || job.state === "waiting";
  const words = [...new Set(job.compliance.map(hit => hit.word))];
  const tags = (job.post?.hashtags ?? []).map(tag => `#${tag.replace(/^#+/, "")}`).join(" ");
  const portrait = job.aspect === "9:16" ? "aspect-[9/16]" : "aspect-[3/4]";

  return <section className="mx-auto max-w-5xl space-y-6 py-2">
    <Link href="/ktu" className="text-sm text-muted-foreground hover:text-foreground">← 返回商K宣传</Link>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{job.cityName} · {job.templateName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatTime(job.createdAt)} · {job.aspect} 竖版 · {JOB_STATE_LABEL[job.state]}{running && job.stage ? `：${job.stage}` : ""} · {job.generated}/{job.total || "—"} 张{job.reviewEnabled ? "" : " · 未开出图检查"}</p>
        {job.error && !running && <p className="mt-1 text-sm text-muted-foreground">{job.error}</p>}
        {job.exportedPath && <p className="mt-1 text-sm text-muted-foreground">已导出到：{job.exportedPath}{desktopBridge() && <button type="button" className="ml-2 underline" onClick={() => void desktopBridge()?.openPath(job.exportedPath!)}>打开</button>}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {running
          ? <Button variant="outline" disabled={busy} onClick={() => void act({ action: "stop" }, "已停止")}>停止</Button>
          : job.state !== "done" && job.state !== "partial" && <Button variant="outline" disabled={busy} onClick={() => void act({ action: "resume" })}>继续生成</Button>}
        <Button disabled={busy || !job.generated} onClick={() => void act({ action: "export" })}>导出到文件夹</Button>
        <Button variant="ghost" onClick={() => void remove()}>删除</Button>
      </div>
    </header>

    {!!job.pages.length && <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {job.pages.map((page, index) => <figure key={page.sectionId} className={cn("space-y-2", page.discarded && "opacity-40")}>
        <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-muted", portrait)}>
          {page.imageUrl ? <a href={page.imageUrl} target="_blank" rel="noreferrer"><img src={page.imageUrl} alt={page.title} className="h-full w-full object-cover" /></a> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{running ? "生成中…" : "未生成"}</div>}
          {page.redrawing && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 text-xs"><Loader2 className="h-5 w-5 animate-spin" />重画中…</div>}
        </div>
        {page.versions.length > 1 && <div className="flex gap-1 overflow-x-auto" aria-label="历史版本">
          {page.versions.map((version, versionIndex) => <button key={version.assetId} type="button" title={`第 ${versionIndex + 1} 版`} disabled={busy || page.redrawing || version.current} onClick={() => void act({ action: "version", sectionId: page.sectionId, assetId: version.assetId }, "已换成这一版")}
            className={cn("h-12 w-9 shrink-0 overflow-hidden rounded-md border", version.current ? "border-primary ring-1 ring-primary" : "border-border opacity-70 hover:opacity-100")}>
            {version.imageUrl && <img src={version.imageUrl} alt="" className="h-full w-full object-cover" />}
          </button>)}
        </div>}
        <figcaption className="space-y-1 text-xs">
          <p className="truncate">{index + 1}. {page.title}</p>
          {!running && <div className="flex flex-wrap gap-x-3 gap-y-1">
            <button type="button" disabled={busy || page.redrawing} className="underline" onClick={() => setEditingPage(page)}>改字重画</button>
            <button type="button" disabled={busy || page.redrawing} className="underline" onClick={() => void act({ action: "redraw", sectionId: page.sectionId }, "已开始重画")}>重画这张</button>
            {page.imageUrl && <button type="button" disabled={busy} className="underline" onClick={() => void act({ action: page.discarded ? "restore" : "discard", sectionId: page.sectionId })}>{page.discarded ? "恢复" : "不要这张"}</button>}
          </div>}
          {page.redrawError && !page.redrawing && <p className="text-destructive">重画没有完成：{page.redrawError}</p>}
          {page.needsCheck && !page.discarded && <p className="text-destructive">需检查：{page.issues.join("；") || "自动检查未通过"}</p>}
        </figcaption>
      </figure>)}
    </div>}

    {editingPage && <RedrawDialog page={editingPage} busy={busy} onCancel={() => setEditingPage(null)} onSubmit={async (text, description) => { if (await act({ action: "redraw", sectionId: editingPage.sectionId, text, description }, "已开始重画")) setEditingPage(null); }} />}

    {job.post && <div className="space-y-4 rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">发布文案</h2>
        {!editingPost && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditingPost(true)}>修改</Button><Button size="sm" variant="outline" onClick={() => void copy(`${job.post!.title}\n\n${job.post!.caption}\n\n${tags}`)}>复制全部</Button></div>}
      </div>
      {job.compliance.length > 0 && <div role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">发布前请修改：{job.compliance.map(hit => `${hit.where}「${hit.word}」（${hit.category}）`).join("；")}</div>}
      {editingPost
        ? <PostEditor post={job.post} busy={busy} onCancel={() => setEditingPost(false)} onSave={async post => { if (await act({ action: "post", ...post }, "已保存")) setEditingPost(false); }} />
        : <>
          <p className="text-lg font-semibold"><Highlighted text={job.post.title} words={words} /></p>
          <p className="whitespace-pre-wrap leading-7"><Highlighted text={job.post.caption} words={words} /></p>
          <p className="text-sm text-muted-foreground"><Highlighted text={tags} words={words} /></p>
        </>}
    </div>}
    <p className="text-xs text-muted-foreground">图片和文案由 AI 生成，发布前请核对店名和文字。</p>
  </section>;
}

function RedrawDialog({ page, busy, onSubmit, onCancel }: { page: KtuPageView; busy: boolean; onSubmit: (text: string, description: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(page.text);
  const [description, setDescription] = useState(page.description);
  return <div role="dialog" aria-modal="true" aria-label="改字重画" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div><p className="font-semibold">改字重画：{page.title}</p><p className="mt-1 text-sm text-muted-foreground">改好图上的字，点「重画」只重画这一张，旧图会留着，可以换回去。</p></div>
      <label className="block space-y-2 text-sm font-medium">图上的字<span className="ml-2 font-normal text-muted-foreground">一行一条</span>
        <Textarea rows={6} value={text} onChange={event => setText(event.target.value)} />
      </label>
      {!!page.description && <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">画面描述（想换画面再改）</summary>
        <Textarea rows={8} className="mt-2" value={description} onChange={event => setDescription(event.target.value)} />
      </details>}
      <div className="flex gap-2">
        <Button disabled={busy || !text.trim()} onClick={() => void onSubmit(text, description)}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}重画</Button>
        <Button variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  </div>;
}

function PostEditor({ post, busy, onSave, onCancel }: { post: NonNullable<KtuJobView["post"]>; busy: boolean; onSave: (post: { title: string; caption: string; hashtags: string }) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(post.title);
  const [caption, setCaption] = useState(post.caption);
  const [hashtags, setHashtags] = useState(post.hashtags.map(tag => `#${tag.replace(/^#+/, "")}`).join(" "));
  return <div className="space-y-3">
    <label className="block space-y-2 text-sm font-medium">标题<Input value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label className="block space-y-2 text-sm font-medium">正文<Textarea rows={8} value={caption} onChange={event => setCaption(event.target.value)} /></label>
    <label className="block space-y-2 text-sm font-medium">话题标签<span className="ml-2 font-normal text-muted-foreground">用空格隔开</span><Input value={hashtags} onChange={event => setHashtags(event.target.value)} /></label>
    <div className="flex gap-2">
      <Button disabled={busy || !title.trim() || !caption.trim()} onClick={() => void onSave({ title, caption, hashtags })}>保存</Button>
      <Button variant="outline" onClick={onCancel}>取消</Button>
    </div>
  </div>;
}
