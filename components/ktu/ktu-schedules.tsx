"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KTU_TIERS, tierLabel } from "@/lib/ktu/catalog";
import { cn } from "@/lib/utils";
import { api, desktopBridge, formatTime, useSchedulerTick } from "./api";
import { KtuCityPicker } from "./ktu-city-picker";
import { RUN_STATUS_LABEL, type KtuCityView, type KtuTemplateView } from "./types";

type ScheduleView = {
  id: string; name: string; enabled: boolean; scope: string; cityIds: string[]; tiers: string[]; templateKeys: string[];
  frequency: string; timeOfDay: string; weekdays: number[]; intervalHours: number; setsPerRun: number; dailyLimit: number;
  aspect: string; outputDir: string; nextRunAt: string | null; lastRunAt: string | null; timing: string; running: boolean;
  runs: Array<{ id: string; status: string; planned: number; nextIndex: number; succeeded: number; failed: number; message: string | null; startedAt: string; finishedAt: string | null }>;
};
type ScheduleForm = Omit<ScheduleView, "id" | "nextRunAt" | "lastRunAt" | "timing" | "running" | "runs">;

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const chip = (active: boolean) => cn("rounded-xl border px-3 py-1.5 text-sm transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent");
const selectClass = "h-10 rounded-xl border border-input bg-card px-3 text-sm";
const emptyForm = (templateKeys: string[]): ScheduleForm => ({ name: "", enabled: true, scope: "all", cityIds: [], tiers: [], templateKeys, frequency: "daily", timeOfDay: "09:00", weekdays: [1, 3, 5], intervalHours: 6, setsPerRun: 5, dailyLimit: 0, aspect: "3:4", outputDir: "" });
const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter(item => item !== value) : [...list, value];

export function KtuSchedules() {
  useSchedulerTick();
  const [data, setData] = useState<{ defaultOutputDir: string; schedules: ScheduleView[] } | null>(null);
  const [cities, setCities] = useState<KtuCityView[]>([]);
  const [templates, setTemplates] = useState<KtuTemplateView[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; form: ScheduleForm } | null>(null);

  const load = useCallback(async () => setData(await api.get("/api/ktu/schedules")), []);
  useEffect(() => {
    api.get<KtuCityView[]>("/api/ktu/cities").then(setCities).catch(() => undefined);
    api.get<KtuTemplateView[]>("/api/ktu/templates").then(setTemplates).catch(() => undefined);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { await load(); } catch { /* 下次再取 */ } if (!stopped) timer = setTimeout(poll, 5000); };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [load]);

  const action = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); toast.success(success); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败"); }
  };

  const scopeText = (schedule: ScheduleView) => schedule.scope === "cities"
    ? cities.filter(city => schedule.cityIds.includes(city.id)).map(city => city.name).join("、") || "所选城市已删除"
    : schedule.scope === "tiers" ? schedule.tiers.map(tierLabel).join("、") : "全部城市";

  return <section className="mx-auto max-w-5xl space-y-6 py-2">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">定时任务</p><h1 className="mt-2 text-3xl font-semibold">按时自动出图文</h1><p className="mt-2 text-muted-foreground">到点自动轮换城市和模板生成，成品存到输出文件夹，直接拿去上传。</p></div>
      {!editing && <Button onClick={() => setEditing({ id: null, form: emptyForm(templates.map(template => template.key)) })}><Plus className="mr-1 h-4 w-4" />新建任务</Button>}
    </header>

    <BackgroundCard />

    {editing && <ScheduleEditor
      initial={editing.form}
      cities={cities}
      templates={templates}
      defaultOutputDir={data?.defaultOutputDir ?? ""}
      onCancel={() => setEditing(null)}
      onSave={async form => {
        await (editing.id ? api.send(`/api/ktu/schedules/${editing.id}`, "PATCH", form) : api.send("/api/ktu/schedules", "POST", form));
        toast.success("已保存");
        setEditing(null);
        await load();
      }}
    />}

    {!data ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : !data.schedules.length && !editing ? <p className="text-sm text-muted-foreground">还没有定时任务。</p> : data.schedules.map(schedule => <article key={schedule.id} className={cn("space-y-4 rounded-2xl border border-border p-5", !schedule.enabled && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-semibold">{schedule.name}{!schedule.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">已暂停</span>}{schedule.running && <span className="ml-2 text-xs font-normal">运行中</span>}</h2>
          <p className="text-sm text-muted-foreground">{schedule.timing} · 每次 {schedule.setsPerRun} 套{schedule.dailyLimit ? ` · 每天最多 ${schedule.dailyLimit} 套` : ""} · {schedule.aspect} 竖版</p>
          <p className="text-sm text-muted-foreground">{scopeText(schedule)} · {schedule.templateKeys.map(key => templates.find(template => template.key === key)?.name ?? "已删除的模板").join("、")}</p>
          <p className="text-sm text-muted-foreground">下次运行：{schedule.enabled ? formatTime(schedule.nextRunAt) : "—"} · 输出到：{schedule.outputDir || data.defaultOutputDir}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={schedule.running} onClick={() => void action(() => api.send(`/api/ktu/schedules/${schedule.id}`, "POST"), "已开始运行")}>立即运行</Button>
          <Button size="sm" variant="outline" onClick={() => void action(() => api.send(`/api/ktu/schedules/${schedule.id}`, "PATCH", { enabled: !schedule.enabled }), schedule.enabled ? "已暂停" : "已启用")}>{schedule.enabled ? "暂停" : "启用"}</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing({ id: schedule.id, form: { name: schedule.name, enabled: schedule.enabled, scope: schedule.scope, cityIds: schedule.cityIds, tiers: schedule.tiers, templateKeys: schedule.templateKeys, frequency: schedule.frequency, timeOfDay: schedule.timeOfDay, weekdays: schedule.weekdays, intervalHours: schedule.intervalHours, setsPerRun: schedule.setsPerRun, dailyLimit: schedule.dailyLimit, aspect: schedule.aspect, outputDir: schedule.outputDir } })}>编辑</Button>
          <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`删除定时任务「${schedule.name}」？已生成的图文不受影响。`)) void action(() => api.send(`/api/ktu/schedules/${schedule.id}`, "DELETE"), "已删除"); }}>删除</Button>
        </div>
      </div>
      {!!schedule.runs.length && <div className="space-y-1 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">最近运行</p>
        {schedule.runs.map(run => <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{formatTime(run.startedAt)} · {RUN_STATUS_LABEL[run.status] ?? run.status} · 成功 {run.succeeded}/{run.planned}{run.failed ? `，未完成 ${run.failed}` : ""}</span>
          {run.message && <span className="max-w-full truncate text-xs text-muted-foreground" title={run.message}>{run.message}</span>}
        </div>)}
        {desktopBridge() && <button type="button" className="text-xs underline" onClick={() => void desktopBridge()?.openPath(schedule.outputDir || data.defaultOutputDir)}>打开输出文件夹</button>}
      </div>}
    </article>)}
  </section>;
}

function ScheduleEditor({ initial, cities, templates, defaultOutputDir, onSave, onCancel }: { initial: ScheduleForm; cities: KtuCityView[]; templates: KtuTemplateView[]; defaultOutputDir: string; onSave: (form: ScheduleForm) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ScheduleForm>) => setForm(current => ({ ...current, ...patch }));
  const save = async () => {
    setBusy(true);
    try { await onSave(form); } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); }
  };

  return <div className="space-y-5 rounded-2xl border border-primary/40 p-5">
    <label className="block space-y-2 text-sm font-medium">任务名称<Input value={form.name} onChange={event => set({ name: event.target.value })} placeholder="例如 每天早上出新一线" /></label>

    <div className="space-y-2">
      <p className="text-sm font-medium">城市范围</p>
      <div className="flex flex-wrap gap-2">{[["all", "全部城市"], ["tiers", "按城市等级"], ["cities", "指定城市"]].map(([value, label]) => <button key={value} type="button" className={chip(form.scope === value)} onClick={() => set({ scope: value })}>{label}</button>)}</div>
      {form.scope === "tiers" && <div className="flex flex-wrap gap-2">{KTU_TIERS.map(tier => <button key={tier.key} type="button" className={chip(form.tiers.includes(tier.key))} onClick={() => set({ tiers: toggle(form.tiers, tier.key) })}>{tier.label}</button>)}</div>}
      {form.scope === "cities" && <div className="max-h-80 overflow-y-auto pr-1"><KtuCityPicker cities={cities} value={form.cityIds} onChange={ids => set({ cityIds: ids })} showCounts={false} /></div>}
    </div>

    <div className="space-y-2">
      <p className="text-sm font-medium">模板</p>
      <div className="flex flex-wrap gap-2">{templates.map(template => <button key={template.key} type="button" className={chip(form.templateKeys.includes(template.key))} onClick={() => set({ templateKeys: toggle(form.templateKeys, template.key) })}>{template.name}</button>)}</div>
    </div>

    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-2 text-sm font-medium">频率
        <select className={cn(selectClass, "block")} value={form.frequency} onChange={event => set({ frequency: event.target.value })}>
          <option value="daily">每天</option><option value="weekly">每周</option><option value="interval">每隔几小时</option>
        </select>
      </label>
      {form.frequency !== "interval" && <label className="space-y-2 text-sm font-medium">时间<Input type="time" className="w-32" value={form.timeOfDay} onChange={event => set({ timeOfDay: event.target.value })} /></label>}
      {form.frequency === "interval" && <label className="space-y-2 text-sm font-medium">间隔（小时）<Input type="number" min={1} max={168} className="w-28" value={form.intervalHours} onChange={event => set({ intervalHours: Number(event.target.value) })} /></label>}
    </div>
    {form.frequency === "weekly" && <div className="flex flex-wrap gap-2">{WEEKDAYS.map((label, index) => <button key={label} type="button" className={chip(form.weekdays.includes(index + 1))} onClick={() => set({ weekdays: toggle(form.weekdays, index + 1) })}>{label}</button>)}</div>}

    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-2 text-sm font-medium">每次出几套<Input type="number" min={1} max={50} className="w-28" value={form.setsPerRun} onChange={event => set({ setsPerRun: Number(event.target.value) })} /></label>
      <label className="space-y-2 text-sm font-medium">每天最多（0 为不限）<Input type="number" min={0} max={500} className="w-28" value={form.dailyLimit} onChange={event => set({ dailyLimit: Number(event.target.value) })} /></label>
      <label className="space-y-2 text-sm font-medium">比例
        <select className={cn(selectClass, "block")} value={form.aspect} onChange={event => set({ aspect: event.target.value })}><option value="3:4">3:4 竖版</option><option value="9:16">9:16 竖版</option></select>
      </label>
    </div>

    <label className="block space-y-2 text-sm font-medium">输出文件夹
      <div className="flex gap-2">
        <Input value={form.outputDir} onChange={event => set({ outputDir: event.target.value })} placeholder={defaultOutputDir} />
        {desktopBridge() && <Button type="button" variant="outline" onClick={async () => { const dir = await desktopBridge()!.chooseFolder(); if (dir) set({ outputDir: dir }); }}>选择</Button>}
      </div>
      <span className="block text-xs font-normal text-muted-foreground">按「日期 / 城市 / 模板」分文件夹，图片和文案放在一起；不填就用默认位置。</span>
    </label>

    <div className="flex gap-2"><Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存</Button><Button variant="ghost" onClick={onCancel}>取消</Button></div>
  </div>;
}

/** 桌面版：后台运行设置。定时任务只在电脑开着、K图在运行时执行。 */
function BackgroundCard() {
  const [value, setValue] = useState<{ autoLaunch: boolean; closeToTray: boolean } | null>(null);
  useEffect(() => { desktopBridge()?.getBackground().then(setValue).catch(() => undefined); }, []);
  if (!desktopBridge()) return null;
  const update = async (patch: { autoLaunch?: boolean; closeToTray?: boolean }) => {
    try { setValue(await desktopBridge()!.setBackground(patch)); } catch { toast.error("设置失败"); }
  };
  return <div className="space-y-2 rounded-2xl border border-border bg-background p-4 text-sm">
    <p>定时任务只在电脑开着、K图在运行时执行；关机期间错过的时间点，下次打开只补跑一次。</p>
    <div className="flex flex-wrap gap-6">
      <label className="flex items-center gap-2"><input type="checkbox" checked={value?.closeToTray ?? true} onChange={event => void update({ closeToTray: event.target.checked })} />关闭窗口时缩到托盘，后台继续运行</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={value?.autoLaunch ?? false} onChange={event => void update({ autoLaunch: event.target.checked })} />开机自动启动</label>
    </div>
  </div>;
}
