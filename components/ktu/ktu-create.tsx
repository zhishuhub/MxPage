"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { describeTemplate, KTU_TIERS } from "@/lib/ktu/catalog";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { KtuCityPicker } from "./ktu-city-picker";
import { KtuRecords } from "./ktu-records";
import type { KtuCityView, KtuTemplateView } from "./types";

const chip = (active: boolean) => cn("rounded-xl border px-3 py-2 text-sm transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent");

/** 上次选的范围、城市、模板和比例记在本机，下次打开照旧。 */
const REMEMBER_KEY = "ktu:create-choices:v1";
type Choices = { scope: "cities" | "tiers"; cityIds: string[]; tiers: string[]; templates: string[]; aspect: "3:4" | "9:16" };
function readChoices(): Partial<Choices> {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || "{}") as Partial<Choices>; } catch { return {}; }
}
function writeChoices(choices: Choices) {
  try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(choices)); } catch { /* 记不住就算了 */ }
}

type Preview = { sets: number; images: number; skipped: string[] };

export function KtuCreate() {
  const router = useRouter();
  const [cities, setCities] = useState<KtuCityView[] | null>(null);
  const [scope, setScope] = useState<"cities" | "tiers">("cities");
  const [cityIds, setCityIds] = useState<string[]>([]);
  const [tiers, setTiers] = useState<string[]>([]);
  const [library, setLibrary] = useState<KtuTemplateView[] | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [aspect, setAspect] = useState<"3:4" | "9:16">("3:4");
  const [autoExport, setAutoExport] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const restored = useRef(false);
  const recordsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = readChoices();
    Promise.all([api.get<KtuCityView[]>("/api/ktu/cities"), api.get<KtuTemplateView[]>("/api/ktu/templates")]).then(([cityList, templateList]) => {
      setCities(cityList);
      setLibrary(templateList);
      const templateKeys = (saved.templates ?? []).filter(key => templateList.some(template => template.key === key));
      setTemplates(saved.templates ? templateKeys : templateList.map(template => template.key));
      setCityIds((saved.cityIds ?? []).filter(id => cityList.some(city => city.id === id)));
      setTiers((saved.tiers ?? []).filter(key => KTU_TIERS.some(tier => tier.key === key)));
      if (saved.scope === "tiers" || saved.scope === "cities") setScope(saved.scope);
      if (saved.aspect === "9:16" || saved.aspect === "3:4") setAspect(saved.aspect);
      restored.current = true;
    }).catch(error => toast.error(error instanceof Error ? error.message : "读取失败"));
    api.get<{ autoExport: boolean }>("/api/ktu/settings").then(settings => setAutoExport(settings.autoExport)).catch(() => undefined);
  }, []);

  useEffect(() => { if (restored.current) writeChoices({ scope, cityIds, tiers, templates, aspect }); }, [scope, cityIds, tiers, templates, aspect]);

  const toggle = (list: string[], value: string) => list.includes(value) ? list.filter(item => item !== value) : [...list, value];
  const scopedCities = useMemo(() => (cities ?? []).filter(city => scope === "cities" ? cityIds.includes(city.id) : tiers.includes(city.tier)), [cities, scope, cityIds, tiers]);
  const singleCity = scope === "cities" && scopedCities.length === 1 ? scopedCities[0] : null;
  const canPick = Boolean(singleCity);
  const selection = useMemo(() => ({ cityIds: scope === "cities" ? cityIds : [], tiers: scope === "tiers" ? tiers : [], templateKeys: templates, picked: canPick ? picked : [], aspect }), [scope, cityIds, tiers, templates, canPick, picked, aspect]);

  // 选好后预估这次出几套、大约画几张图
  useEffect(() => {
    if (!scopedCities.length || !templates.length) { setPreview(null); return; }
    let stale = false;
    const timer = setTimeout(() => {
      api.send<Preview>("/api/ktu/batches/preview", "POST", selection).then(result => { if (!stale) setPreview(result); }).catch(() => { if (!stale) setPreview(null); });
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
  }, [selection, scopedCities.length, templates.length]);

  const total = preview?.sets ?? 0;

  const start = async () => {
    setBusy(true);
    try {
      const result = await api.send<{ planned: number; skipped: string[]; jobIds: string[] }>("/api/ktu/batches", "POST", selection);
      if (result.skipped.length) toast.message(`有 ${result.skipped.length} 套资料不够，已跳过`, { description: result.skipped.slice(0, 3).join("\n") });
      if (result.planned === 1 && result.jobIds[0]) { router.push(`/ktu/jobs/${result.jobIds[0]}`); return; }
      toast.success(`已开始生成 ${result.planned} 套`);
      setRefreshKey(key => key + 1);
      recordsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "开始失败");
    } finally {
      setBusy(false);
    }
  };

  const changeAutoExport = async (value: boolean) => {
    setAutoExport(value);
    try { await api.send("/api/ktu/settings", "PATCH", { autoExport: value }); }
    catch (error) { setAutoExport(!value); toast.error(error instanceof Error ? error.message : "保存失败"); }
  };

  if (cities && !cities.length) {
    return <section className="mx-auto max-w-3xl space-y-4 py-10 text-center">
      <h1 className="text-2xl font-semibold">先添加城市和商K店名</h1>
      <p className="text-muted-foreground">资料库里还没有城市。到资料库导入城市店名 Excel，或者手动添加城市、粘贴店名，就能生成图文。</p>
      <Link href="/ktu/library" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm text-primary-foreground">去资料库</Link>
    </section>;
  }

  return <section className="mx-auto max-w-5xl space-y-8 py-2">
    <header><p className="text-sm text-muted-foreground">商K宣传</p><h1 className="mt-2 text-3xl font-semibold">选城市和模板，一键出抖音图文</h1><p className="mt-2 text-muted-foreground">每套图文包含配图、标题、正文和话题标签，几套一起生成。</p></header>

    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">城市</h2>
        <div className="ml-auto flex gap-1 rounded-xl border border-border p-1 text-sm">
          {(["cities", "tiers"] as const).map(value => <button key={value} type="button" onClick={() => setScope(value)} className={cn("rounded-lg px-3 py-1", scope === value ? "bg-secondary font-medium" : "text-muted-foreground")}>{value === "cities" ? "按城市" : "按城市等级"}</button>)}
        </div>
      </div>
      {!cities ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : scope === "cities"
        ? <KtuCityPicker cities={cities} value={cityIds} onChange={ids => { setCityIds(ids); setPicked([]); }} />
        : <div className="flex flex-wrap gap-2">{KTU_TIERS.map(tier => { const count = cities.filter(city => city.tier === tier.key).length; return <button key={tier.key} type="button" disabled={!count} className={cn(chip(tiers.includes(tier.key)), !count && "opacity-40")} onClick={() => setTiers(toggle(tiers, tier.key))}>{tier.label}<span className="ml-1 opacity-70">{count} 城</span></button>; })}</div>}
    </div>

    <div className="space-y-3">
      <div className="flex items-center gap-2"><h2 className="font-semibold">模板</h2><Link href="/ktu/templates" className="ml-auto text-sm text-muted-foreground underline hover:text-foreground">改模板、加模板</Link></div>
      {!library ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {library.map(template => <button key={template.key} type="button" onClick={() => setTemplates(toggle(templates, template.key))} className={cn("rounded-2xl border p-4 text-left transition-colors", templates.includes(template.key) ? "border-primary ring-1 ring-primary" : "border-border hover:bg-accent")}>
          <p className="font-medium">{template.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{describeTemplate(template)}</p>
        </button>)}
      </div>}
    </div>

    {canPick && singleCity && <div className="space-y-3">
      <h2 className="font-semibold">指定店铺<span className="ml-2 text-sm font-normal text-muted-foreground">选填，指定后所选模板只用这些店；不选就按模板自动挑</span></h2>
      <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">{singleCity.venues.map(venue => <button key={venue.id} type="button" className={chip(picked.includes(venue.id))} onClick={() => setPicked(toggle(picked, venue.id))}>{venue.name}</button>)}</div>
    </div>}

    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-1 rounded-xl border border-border p-1 text-sm">{(["3:4", "9:16"] as const).map(value => <button key={value} type="button" onClick={() => setAspect(value)} className={cn("rounded-lg px-3 py-1", aspect === value ? "bg-secondary font-medium" : "text-muted-foreground")}>{value} 竖版</button>)}</div>
        <Button className="h-12 flex-1" disabled={busy || !total} onClick={() => void start()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{total ? `开始生成 ${total} 套` : "请选择城市和模板"}</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>{preview?.sets ? `这次大约画 ${preview.images} 张图${preview.skipped.length ? `；有 ${preview.skipped.length} 套资料不够，会跳过` : ""}` : ""}</p>
        {autoExport !== null && <label className="flex items-center gap-2"><input type="checkbox" checked={autoExport} onChange={event => void changeAutoExport(event.target.checked)} />生成完自动导出到文件夹</label>}
      </div>
    </div>

    <div ref={recordsRef} className="scroll-mt-4"><KtuRecords pageSize={12} refreshKey={refreshKey} moreHref="/ktu/works" /></div>
  </section>;
}
