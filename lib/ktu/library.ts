// K图：资料库——城市（名称 + 等级）和每个城市的店名列表（区域选填）。

import { prisma } from "@/lib/db/prisma";
import { defaultTierFor, isTierKey, parseVenueLines, tierOrder, type KtuTierKey } from "./catalog";
import type { ImportCity } from "./import-text";

export async function listCities() {
  const cities = await prisma.ktuCity.findMany({ include: { venues: { orderBy: { sortOrder: "asc" } } } });
  return cities
    .sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"))
    .map(city => ({ id: city.id, name: city.name, tier: city.tier, venues: city.venues.map(venue => ({ id: venue.id, name: venue.name, district: venue.district })) }));
}

function cleanCityName(name: unknown) {
  const value = String(name ?? "").trim().slice(0, 30);
  if (!value) throw new Error("请填写城市名");
  return value;
}

export async function createCity(input: { name: unknown; tier?: unknown }) {
  const name = cleanCityName(input.name);
  const tier = isTierKey(input.tier) ? input.tier : defaultTierFor(name);
  if (!tier) throw new Error("请选择城市等级");
  if (await prisma.ktuCity.findUnique({ where: { name } })) throw new Error(`「${name}」已经在资料库里了`);
  const count = await prisma.ktuCity.count();
  return prisma.ktuCity.create({ data: { name, tier, sortOrder: count } });
}

export async function updateCity(id: string, input: { name?: unknown; tier?: unknown }) {
  const data: { name?: string; tier?: string } = {};
  if (input.name !== undefined) {
    data.name = cleanCityName(input.name);
    const same = await prisma.ktuCity.findUnique({ where: { name: data.name } });
    if (same && same.id !== id) throw new Error(`「${data.name}」已经在资料库里了`);
  }
  if (input.tier !== undefined) {
    if (!isTierKey(input.tier)) throw new Error("请选择城市等级");
    data.tier = input.tier;
  }
  return prisma.ktuCity.update({ where: { id }, data });
}

export async function deleteCity(id: string) {
  await prisma.ktuCity.delete({ where: { id } });
}

/**
 * 用一份店名列表整体替换某城市的店。按店名对上原来的店，保留它的轮换记录；列表里没有的店删掉。
 * 以后接客户资料导入时也走这里。
 */
export async function replaceCityVenues(cityId: string, venues: Array<{ name: string; district: string }>) {
  await prisma.$transaction(async tx => {
    const existing = await tx.ktuVenue.findMany({ where: { cityId } });
    const keep = new Set(venues.map(venue => venue.name));
    await tx.ktuVenue.deleteMany({ where: { cityId, name: { notIn: [...keep] } } });
    for (const [index, venue] of venues.entries()) {
      const found = existing.find(item => item.name === venue.name);
      if (found) await tx.ktuVenue.update({ where: { id: found.id }, data: { district: venue.district, sortOrder: index } });
      else await tx.ktuVenue.create({ data: { cityId, name: venue.name, district: venue.district, sortOrder: index } });
    }
  });
  return prisma.ktuVenue.count({ where: { cityId } });
}

export async function setCityVenuesFromText(cityId: string, text: string) {
  return replaceCityVenues(cityId, parseVenueLines(text));
}

export type ImportPlan = Array<{ name: string; tier: string | null; exists: boolean; added: number; removed: number; total: number; error: string }>;

/** 预览 / 执行 TXT 导入。默认只追加新店（已有的店保留，区域按文件更新）；removeMissing 时文件里没有的店删掉。 */
export async function importCities(cities: ImportCity[], options: { removeMissing: boolean; dryRun: boolean }) {
  const existing = await prisma.ktuCity.findMany({ include: { venues: { orderBy: { sortOrder: "asc" } } } });
  const plan: ImportPlan = [];
  for (const city of cities) {
    const found = existing.find(item => item.name === city.name);
    const tier = city.tier ?? (found?.tier as KtuTierKey | undefined) ?? defaultTierFor(city.name);
    const names = new Set(city.venues.map(venue => venue.name));
    const oldNames = new Set(found?.venues.map(venue => venue.name) ?? []);
    const added = city.venues.filter(venue => !oldNames.has(venue.name)).length;
    const removed = options.removeMissing ? [...oldNames].filter(name => !names.has(name)).length : 0;
    const error = !city.venues.length ? `「${city.name}」下面没有场所` : "";
    plan.push({ name: city.name, tier, exists: Boolean(found), added, removed, total: options.removeMissing ? names.size : oldNames.size + added, error });
    if (options.dryRun || error) continue;

    const target = found
      ? (city.tier && city.tier !== found.tier ? await prisma.ktuCity.update({ where: { id: found.id }, data: { tier: city.tier } }) : found)
      // 不在常见城市表里的新城市先存成未分级，到资料库里选等级
      : await prisma.ktuCity.create({ data: { name: city.name, tier: tier ?? "", sortOrder: existing.length + plan.length } });
    const merged = options.removeMissing
      ? city.venues
      : [
        ...(found?.venues ?? []).map(venue => ({ name: venue.name, district: city.venues.find(item => item.name === venue.name)?.district || venue.district })),
        ...city.venues.filter(venue => !oldNames.has(venue.name)),
      ];
    await replaceCityVenues(target.id, merged);
  }
  return plan;
}
