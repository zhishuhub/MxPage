// K图：TXT 资料导入格式（前后端共用）。
//
//   # 杭州
//   金樽商务会所
//   皇朝KTV 滨江区
//
//   # 义乌 县级市
//   小城KTV
//
// 「#」开头是城市行，城市名后面可写等级（常见城市可省略）；其余每行一家店，后面空一格可写区域。
// 一个文件只有一个城市时，文件名就是城市名（如「杭州.txt」），文件里可以只写店名。

import { parseVenueLines, type KtuTierKey } from "./catalog";

export type ImportCity = { name: string; tier: KtuTierKey | null; venues: Array<{ name: string; district: string }> };
export type ImportIssue = { line: number; file: string; message: string };

const TIER_WORDS: Array<[RegExp, KtuTierKey]> = [
  [/^新一线(城市)?$/, "newTier1"],
  [/^一线(城市)?$/, "tier1"],
  [/^二线(城市)?$/, "tier2"],
  [/^三线(城市)?$/, "tier3"],
  [/^四线(城市)?$/, "tier4"],
  [/^(县级市|县城|县级)$/, "county"],
];

export function parseTierWord(word: string): KtuTierKey | null {
  return TIER_WORDS.find(([pattern]) => pattern.test(word.trim()))?.[1] ?? null;
}

/** 城市行：「# 杭州」「# 义乌 县级市」「# 义乌（县级市）」「【杭州】」都认。 */
function parseCityLine(line: string) {
  const match = /^\s*(?:#+\s*(.+)|【([^】]+)】\s*(.*))$/.exec(line);
  if (!match) return null;
  const words = (match[1] ?? `${match[2]} ${match[3] ?? ""}`).split(/[\s,，、()（）]+/).filter(Boolean);
  if (!words.length) return null;
  const tierWord = words.slice(1).find(word => parseTierWord(word));
  return { name: words[0].replace(/市$/, "") || words[0], tier: tierWord ? parseTierWord(tierWord) : null };
}

/** 文件名当城市名：去掉扩展名，「杭州商K.txt」「杭州-0926.txt」只取开头的中文城市名。 */
export function cityFromFileName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  const match = /^[一-龥]{2,8}?(?=市|商K|KTV|ktv|店名|名单|资料|[-_\s（(\d]|$)/.exec(base);
  return match ? match[0] : "";
}

export function parseImportText(text: string, fileName = ""): { cities: ImportCity[]; issues: ImportIssue[] } {
  const cities: ImportCity[] = [];
  const issues: ImportIssue[] = [];
  const fallbackCity = cityFromFileName(fileName);
  let current: { city: ImportCity; lines: string[] } | null = null;
  const blocks: Array<{ city: ImportCity; lines: string[] }> = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);

  lines.forEach((line, index) => {
    const header = parseCityLine(line);
    if (header) {
      current = { city: { name: header.name, tier: header.tier, venues: [] }, lines: [] };
      blocks.push(current);
      return;
    }
    if (!line.trim()) return;
    if (!current) {
      if (!fallbackCity) {
        issues.push({ line: index + 1, file: fileName, message: "这一行前面没有城市，请先写一行「# 城市名」" });
        return;
      }
      current = { city: { name: fallbackCity, tier: null, venues: [] }, lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  });

  // 同一城市写了多段时合并
  for (const block of blocks) {
    const venues = parseVenueLines(block.lines.join("\n"));
    const existing = cities.find(city => city.name === block.city.name);
    if (existing) {
      existing.tier ??= block.city.tier;
      for (const venue of venues) if (!existing.venues.some(item => item.name === venue.name)) existing.venues.push(venue);
    } else {
      cities.push({ ...block.city, venues });
    }
  }
  return { cities, issues };
}

/** 合并多个文件的解析结果（多选了几个城市的 TXT）。 */
export function mergeImports(results: Array<{ cities: ImportCity[]; issues: ImportIssue[] }>) {
  const merged = parseImportText("");
  for (const result of results) {
    merged.issues.push(...result.issues);
    for (const city of result.cities) {
      const existing = merged.cities.find(item => item.name === city.name);
      if (!existing) merged.cities.push({ ...city, venues: [...city.venues] });
      else {
        existing.tier ??= city.tier;
        for (const venue of city.venues) if (!existing.venues.some(item => item.name === venue.name)) existing.venues.push(venue);
      }
    }
  }
  return merged;
}

export const IMPORT_TEMPLATE = `# 杭州
金樽商务会所
皇朝KTV 滨江区
星光汇 西湖区

# 义乌 县级市
小城KTV
`;
