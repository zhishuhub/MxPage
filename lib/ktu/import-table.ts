// K图：表格资料导入（Excel / CSV 读出来的行），前后端共用。
//
//   城市 | 场所名称
//   杭州 | 金樽商务会所
//   杭州 | 皇朝KTV
//   义乌 | 小城KTV
//
// 一行一家店，城市留空时沿用上一行（合并单元格也能读）。没有「城市」列时，用工作表名或文件名当城市名。
// 表里另有「城市等级」「区域」列时也会读，模板里不放。

import { parseTierWord, cityFromFileName, type ImportCity, type ImportIssue } from "./import-text";

const HEADERS = {
  city: /^(城市|城市名|城市名称)$/,
  tier: /^(城市等级|等级|城市级别|级别)$/,
  name: /^(场所名称|场所|场所名|店名|店铺|店铺名|店铺名称|商K|商k|商K名称|名称|门店|门店名称|KTV|ktv)$/,
  district: /^(区域|区|区县|商圈|所在区域)$/,
};

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

/** 默认工作表名（Sheet1、工作表1）不当城市名。 */
function cityFromSheetName(sheetName: string) {
  return /^(sheet|工作表)\s*\d*$/i.test(sheetName.trim()) ? "" : cityFromFileName(sheetName);
}

export function rowsToCities(rows: unknown[][], options: { sheetName?: string; fileName?: string } = {}): { cities: ImportCity[]; issues: ImportIssue[] } {
  const file = [options.fileName, options.sheetName && !/^(sheet|工作表)\s*\d*$/i.test(options.sheetName) ? `「${options.sheetName}」` : ""].filter(Boolean).join(" ");
  const table = rows.map(row => row.map(clean));
  const headerIndex = table.slice(0, 10).findIndex(row => row.some(cell => HEADERS.name.test(cell)));
  const header = headerIndex >= 0 ? table[headerIndex] : [];
  const column = (pattern: RegExp) => header.findIndex(cell => pattern.test(cell));
  const columns = headerIndex >= 0
    ? { city: column(HEADERS.city), tier: column(HEADERS.tier), name: column(HEADERS.name), district: column(HEADERS.district) }
    // 没有表头：第一列店名、第二列区域
    : { city: -1, tier: -1, name: 0, district: 1 };
  const fallbackCity = cityFromSheetName(options.sheetName ?? "") || cityFromFileName(options.fileName ?? "");

  const cities: ImportCity[] = [];
  const issues: ImportIssue[] = [];
  let lastCity = fallbackCity;
  let lastTierCity = "";
  let lastTier: ImportCity["tier"] = null;

  table.slice(headerIndex + 1).forEach((row, offset) => {
    const line = headerIndex + 2 + offset;
    const name = row[columns.name] ?? "";
    const cityCell = columns.city >= 0 ? (row[columns.city] ?? "") : "";
    if (cityCell) lastCity = cityCell.replace(/市$/, "") || cityCell;
    const tierCell = columns.tier >= 0 ? (row[columns.tier] ?? "") : "";
    if (!name) return;
    if (!lastCity) {
      issues.push({ line, file, message: "没有填城市" });
      return;
    }
    if (tierCell) {
      const tier = parseTierWord(tierCell);
      if (!tier) issues.push({ line, file, message: `城市等级「${tierCell}」看不懂，可填：一线、新一线、二线、三线、四线、县级市` });
      else { lastTier = tier; lastTierCity = lastCity; }
    }
    let city = cities.find(item => item.name === lastCity);
    if (!city) { city = { name: lastCity, tier: null, venues: [] }; cities.push(city); }
    // 等级留空时沿用同一城市上一行的等级
    if (!city.tier && lastTierCity === lastCity) city.tier = lastTier;
    const district = columns.district >= 0 ? (row[columns.district] ?? "") : "";
    const venueName = name.slice(0, 60);
    const existing = city.venues.find(venue => venue.name === venueName);
    if (existing) existing.district ||= district.slice(0, 30);
    else city.venues.push({ name: venueName, district: district.slice(0, 30) });
  });
  if (headerIndex < 0 && !fallbackCity && table.some(row => row.some(Boolean))) issues.splice(0, issues.length, { line: 1, file, message: "没找到表头，请在第一行写上「城市、场所名称」" });
  return { cities, issues };
}

/** 简单 CSV：逗号分隔，支持双引号包起来的内容。 */
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === "\"" && source[index + 1] === "\"") { cell += "\""; index++; }
      else if (char === "\"") quoted = false;
      else cell += char;
    } else if (char === "\"" && cell === "") quoted = true;
    else if (char === "," || char === "\t") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export const TEMPLATE_ROWS = [
  ["城市", "场所名称"],
  ["杭州", "金樽商务会所"],
  ["杭州", "皇朝KTV"],
  ["义乌", "小城KTV"],
];
