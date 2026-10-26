"use client";

import { useCallback, useEffect, useState } from "react";
import { FileUp, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { KTU_TIERS, defaultTierFor, parseVenueLines } from "@/lib/ktu/catalog";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { KtuImport } from "./ktu-import";
import type { KtuCityView } from "./types";

const selectClass = "h-10 rounded-xl border border-input bg-card px-3 text-sm";

function venuesToText(city: KtuCityView) {
  return city.venues.map(venue => venue.district ? `${venue.name} ${venue.district}` : venue.name).join("\n");
}

export function KtuLibrary() {
  const [cities, setCities] = useState<KtuCityView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const next = await api.get<KtuCityView[]>("/api/ktu/cities");
    setCities(next);
    setSelectedId(current => current && next.some(city => city.id === current) ? current : next[0]?.id ?? null);
  }, []);
  useEffect(() => { load().catch(error => toast.error(error.message)); }, [load]);

  const addCity = async () => {
    try {
      const city = await api.send<{ id: string }>("/api/ktu/cities", "POST", { name: newName, tier: newTier || undefined });
      setNewName(""); setNewTier("");
      await load();
      setSelectedId(city.id);
    } catch (error) { toast.error(error instanceof Error ? error.message : "添加失败"); }
  };

  const selected = cities?.find(city => city.id === selectedId) ?? null;

  return <section className="mx-auto max-w-5xl space-y-6 py-2">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">资料库</p><h1 className="mt-2 text-3xl font-semibold">城市和场所</h1><p className="mt-2 text-muted-foreground">导入 Excel（城市、场所名称两列），或者在城市里直接粘贴场所名称，每行一家；要做分区域整理的，在名称后面空一格写上区域。</p></div>
      {!importing && <Button onClick={() => setImporting(true)}><FileUp className="mr-1 h-4 w-4" />导入 Excel</Button>}
    </header>
    {importing && <KtuImport onDone={load} onClose={() => setImporting(false)} />}
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <div className="space-y-4">
        <div className="space-y-2 rounded-2xl border border-border p-4">
          <p className="text-sm font-medium">添加城市</p>
          <Input value={newName} placeholder="城市名，例如 杭州" onChange={event => { setNewName(event.target.value); setNewTier(defaultTierFor(event.target.value) ?? newTier); }} onKeyDown={event => { if (event.key === "Enter" && newName.trim()) void addCity(); }} />
          <select aria-label="城市等级" className={cn(selectClass, "w-full")} value={newTier} onChange={event => setNewTier(event.target.value)}>
            <option value="">选择城市等级</option>
            {KTU_TIERS.map(tier => <option key={tier.key} value={tier.key}>{tier.label}</option>)}
          </select>
          <Button className="w-full" disabled={!newName.trim() || !newTier} onClick={() => void addCity()}><Plus className="mr-1 h-4 w-4" />添加</Button>
        </div>
        {!cities ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : [...KTU_TIERS, { key: "", label: "未分级（请选等级）" }].map(tier => {
          const list = cities.filter(city => tier.key ? city.tier === tier.key : !KTU_TIERS.some(item => item.key === city.tier));
          if (!list.length) return null;
          return <div key={tier.key || "none"} className="space-y-1"><p className={cn("px-2 text-xs", tier.key ? "text-muted-foreground" : "text-amber-600")}>{tier.label}</p>
            {list.map(city => <button key={city.id} type="button" onClick={() => setSelectedId(city.id)} className={cn("flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm", city.id === selectedId ? "bg-secondary font-medium" : "hover:bg-accent")}><span>{city.name}</span><span className="text-xs text-muted-foreground">{city.venues.length} 家</span></button>)}
          </div>;
        })}
      </div>
      {selected ? <CityEditor key={selected.id} city={selected} onChanged={load} /> : cities && <p className="text-sm text-muted-foreground">先在左边添加一个城市。</p>}
    </div>
  </section>;
}

function CityEditor({ city, onChanged }: { city: KtuCityView; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(city.name);
  const [tier, setTier] = useState(city.tier);
  const [text, setText] = useState(venuesToText(city));
  const [busy, setBusy] = useState(false);
  const parsed = parseVenueLines(text);
  const districts = new Set(parsed.map(venue => venue.district).filter(Boolean));
  const dirty = name !== city.name || tier !== city.tier || text !== venuesToText(city);

  const save = async () => {
    setBusy(true);
    try {
      const result = await api.send<{ venueCount?: number }>(`/api/ktu/cities/${city.id}`, "PATCH", { name, tier, venuesText: text });
      toast.success(`已保存，共 ${result.venueCount ?? parsed.length} 家`);
      await onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`删除「${city.name}」和它的全部店名？已生成的图文不受影响。`)) return;
    try { await api.send(`/api/ktu/cities/${city.id}`, "DELETE"); await onChanged(); } catch (error) { toast.error(error instanceof Error ? error.message : "删除失败"); }
  };

  return <div className="space-y-4 rounded-2xl border border-border p-5">
    <div className="flex flex-wrap gap-3">
      <Input aria-label="城市名" className="w-40" value={name} onChange={event => setName(event.target.value)} />
      <select aria-label="城市等级" className={selectClass} value={tier} onChange={event => setTier(event.target.value)}>
        {!tier && <option value="">请选择城市等级</option>}
        {KTU_TIERS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <Button variant="ghost" className="ml-auto" onClick={() => void remove()}>删除城市</Button>
    </div>
    <label className="block space-y-2 text-sm font-medium">场所名称
      <Textarea value={text} onChange={event => setText(event.target.value)} rows={16} placeholder={"每行一家，例如：\n金樽商务会所\n皇朝KTV 滨江区\n星光汇 西湖区"} className="font-normal" />
    </label>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{!tier && <span className="mr-2 text-amber-600">请先选择城市等级</span>}共 {parsed.length} 家{districts.size ? `，${districts.size} 个区域` : ""}</p>
      <Button disabled={busy || !dirty || !tier} onClick={() => void save()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存</Button>
    </div>
  </div>;
}
