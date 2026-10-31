"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { KTU_TIERS } from "@/lib/ktu/catalog";
import { cn } from "@/lib/utils";
import type { KtuCityView } from "./types";

const chip = (active: boolean) => cn("rounded-xl border px-3 py-2 text-sm transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent");

/** 按城市等级分组选城市：可以搜索城市名，也可以一键全选 / 取消某一级。 */
export function KtuCityPicker({ cities, value, onChange, showCounts = true }: { cities: KtuCityView[]; value: string[]; onChange: (ids: string[]) => void; showCounts?: boolean }) {
  const [query, setQuery] = useState("");
  const keyword = query.trim();
  const visible = keyword ? cities.filter(city => city.name.includes(keyword)) : cities;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(item => item !== id) : [...value, id]);

  return <div className="space-y-3">
    {cities.length > 12 && <div className="relative max-w-xs">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="搜索城市" className="pl-9" placeholder="搜索城市" value={query} onChange={event => setQuery(event.target.value)} />
    </div>}
    {!visible.length && <p className="text-sm text-muted-foreground">没有找到「{keyword}」</p>}
    {[...KTU_TIERS, { key: "", label: "未分级" }].map(tier => {
      const list = visible.filter(city => tier.key ? city.tier === tier.key : !KTU_TIERS.some(item => item.key === city.tier));
      if (!list.length) return null;
      const allOn = list.every(city => value.includes(city.id));
      const ids = list.map(city => city.id);
      return <div key={tier.key || "none"} className="space-y-2">
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">{tier.label}</p>
          <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => onChange(allOn ? value.filter(id => !ids.includes(id)) : [...new Set([...value, ...ids])])}>{allOn ? "取消这一级" : "全选这一级"}</button>
        </div>
        <div className="flex flex-wrap gap-2">{list.map(city => <button key={city.id} type="button" className={chip(value.includes(city.id))} onClick={() => toggle(city.id)}>{city.name}{showCounts && <span className="ml-1 opacity-70">{city.venues.length}</span>}</button>)}</div>
      </div>;
    })}
  </div>;
}
