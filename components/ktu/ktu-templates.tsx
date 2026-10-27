"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeTemplate, MAX_PAGES, PAGES_LABEL, PICK_LABEL, type KtuTemplateDef } from "@/lib/ktu/catalog";
import { cn } from "@/lib/utils";
import { api } from "./api";
import type { KtuTemplateView } from "./types";

type TemplateForm = Pick<KtuTemplateDef, "name" | "minVenues" | "maxVenues" | "pick" | "pages" | "pageCount" | "content">;

const chip = (active: boolean) => cn("rounded-xl border px-3 py-1.5 text-sm transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent");
const emptyForm = (): TemplateForm => ({ name: "", minVenues: 2, maxVenues: 5, pick: "random", pages: "perVenue", pageCount: 4, content: "第 1 张封面：大标题「{城市}……」。\n后面每张一家店：店名 + 一句推荐语。" });
const PICK_HINT: Record<TemplateForm["pick"], string> = { random: "每次打乱", rotate: "最久没出过的店先出，每家都能轮到" };

export function KtuTemplates() {
  const [templates, setTemplates] = useState<KtuTemplateView[] | null>(null);
  const [editing, setEditing] = useState<{ template: KtuTemplateView | null; form: TemplateForm } | null>(null);

  const load = useCallback(async () => setTemplates(await api.get<KtuTemplateView[]>("/api/ktu/templates")), []);
  useEffect(() => { load().catch(error => toast.error(error instanceof Error ? error.message : "读取失败")); }, [load]);

  const action = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); toast.success(success); setEditing(null); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败"); }
  };
  const save = (form: TemplateForm) => action(() => editing?.template ? api.send(`/api/ktu/templates/${editing.template.id}`, "PATCH", form) : api.send("/api/ktu/templates", "POST", form), "已保存");
  const remove = (template: KtuTemplateView) => { if (window.confirm(`删除模板「${template.name}」？`)) void action(() => api.send(`/api/ktu/templates/${template.id}`, "DELETE"), "已删除"); };
  const reset = (template: KtuTemplateView) => { if (window.confirm(`把「${template.name}」恢复成默认写法？你改过的内容会被覆盖。`)) void action(() => api.send(`/api/ktu/templates/${template.id}`, "POST", { action: "reset" }), "已恢复默认"); };
  const formOf = (template: KtuTemplateView): TemplateForm => ({ name: template.name, minVenues: template.minVenues, maxVenues: template.maxVenues, pick: template.pick, pages: template.pages, pageCount: template.pageCount, content: template.content });

  return <section className="mx-auto max-w-5xl space-y-6 py-2">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">模板</p><h1 className="mt-2 text-3xl font-semibold">每种图文怎么出，在这里定</h1><p className="mt-2 text-muted-foreground">内置的六个可以直接改，改坏了能恢复默认；也可以新增，或复制一个再改。</p></div>
      {!editing && <Button onClick={() => setEditing({ template: null, form: emptyForm() })}><Plus className="mr-1 h-4 w-4" />新增模板</Button>}
    </header>

    {editing && <TemplateEditor key={editing.template?.id ?? "new"} initial={editing.form} template={editing.template} onSave={save} onReset={reset} onCancel={() => setEditing(null)} />}

    {!templates ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <div className="grid gap-3 sm:grid-cols-2">
      {templates.map(template => <article key={template.id} className="space-y-3 rounded-2xl border border-border p-4">
        <div className="flex items-start justify-between gap-2">
          <div><p className="font-medium">{template.name}{template.builtin && <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 text-xs font-normal text-muted-foreground">内置</span>}</p><p className="mt-1 text-xs text-muted-foreground">{describeTemplate(template)}</p></div>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{template.content}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" className="underline" onClick={() => setEditing({ template, form: formOf(template) })}>修改</button>
          <button type="button" className="underline" onClick={() => setEditing({ template: null, form: { ...formOf(template), name: `${template.name}（复制）`.slice(0, 20) } })}>复制</button>
          {!template.builtin && <button type="button" className="text-destructive underline" onClick={() => remove(template)}>删除</button>}
        </div>
      </article>)}
    </div>}
  </section>;
}

function TemplateEditor({ initial, template, onSave, onReset, onCancel }: { initial: TemplateForm; template: KtuTemplateView | null; onSave: (form: TemplateForm) => Promise<void>; onReset: (template: KtuTemplateView) => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<TemplateForm>) => setForm(current => ({ ...current, ...patch }));
  const submit = async () => { setBusy(true); try { await onSave(form); } finally { setBusy(false); } };

  return <div className="space-y-5 rounded-2xl border border-primary/40 p-5">
    <p className="font-semibold">{template ? `修改「${template.name}」` : "新增模板"}</p>
    <label className="block space-y-2 text-sm font-medium">名称<Input value={form.name} maxLength={20} onChange={event => set({ name: event.target.value })} placeholder="例如 城市商K排名" /></label>

    <div className="space-y-2 text-sm font-medium">用几家店
      <div className="flex items-center gap-2 font-normal">最少<Input type="number" min={1} max={30} className="w-20" value={form.minVenues} onChange={event => set({ minVenues: Number(event.target.value) })} />家，最多<Input type="number" min={1} max={30} className="w-20" value={form.maxVenues} onChange={event => set({ maxVenues: Number(event.target.value) })} />家</div>
    </div>

    <div className="space-y-2">
      <p className="text-sm font-medium">店怎么挑</p>
      <div className="flex flex-wrap gap-2">{(["random", "rotate"] as const).map(value => <button key={value} type="button" className={chip(form.pick === value)} onClick={() => set({ pick: value })}>{PICK_LABEL[value]}</button>)}</div>
      <p className="text-xs text-muted-foreground">{PICK_HINT[form.pick]}</p>
    </div>

    <div className="space-y-2">
      <p className="text-sm font-medium">出几张图</p>
      <div className="flex flex-wrap items-center gap-2">
        {(["fixed", "perVenue", "perDistrict"] as const).map(value => <button key={value} type="button" className={chip(form.pages === value)} onClick={() => set({ pages: value })}>{PAGES_LABEL[value]}</button>)}
        {form.pages === "fixed" && <span className="flex items-center gap-2 text-sm"><Input type="number" min={1} max={MAX_PAGES} className="w-20" value={form.pageCount} onChange={event => set({ pageCount: Number(event.target.value) })} />张</span>}
      </div>
      <p className="text-xs text-muted-foreground">一组最多 {MAX_PAGES} 张。{form.pages === "perDistrict" ? "按区域出图需要资料里的店填了区域。" : ""}</p>
    </div>

    <label className="block space-y-2 text-sm font-medium">每张图放什么
      <Textarea rows={8} value={form.content} onChange={event => set({ content: event.target.value })} />
      <span className="block text-xs font-normal leading-5 text-muted-foreground">用大白话写每张图放什么。写 {"{城市}"} 会换成城市名；挑中的店名单会自动附在后面，不用自己写。想要什么画面风格也可以写在这里，不写就让 AI 自由发挥。</span>
    </label>

    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={() => void submit()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存</Button>
      <Button variant="outline" onClick={onCancel}>取消</Button>
      {template?.builtin && <Button variant="ghost" className="ml-auto" onClick={() => onReset(template)}>恢复默认</Button>}
    </div>
  </div>;
}
