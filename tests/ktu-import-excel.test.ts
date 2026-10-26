import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseCsv, rowsToCities } from "../lib/ktu/import-table";
import { buildTemplateWorkbook, parseImportFile, parseWorkbook } from "../lib/ktu/import-excel";

test("table rows: header in any order, city and tier carry down, bad tiers are reported", () => {
  const { cities, issues } = rowsToCities([
    ["商K资料"],
    ["店名", "区域", "城市", "等级"],
    ["金樽商务会所", "", "杭州市", ""],
    ["皇朝KTV", "滨江区", "", ""],
    ["", "", "", ""],
    ["小城KTV", "", "义乌", ""],
    ["第二家", "", "", "县级市"],
    ["天山会所", "", "乌鲁木齐", "五线"],
  ]);
  assert.deepEqual(cities, [
    { name: "杭州", tier: null, venues: [{ name: "金樽商务会所", district: "" }, { name: "皇朝KTV", district: "滨江区" }] },
    { name: "义乌", tier: "county", venues: [{ name: "小城KTV", district: "" }, { name: "第二家", district: "" }] },
    { name: "乌鲁木齐", tier: null, venues: [{ name: "天山会所", district: "" }] },
  ]);
  assert.deepEqual(issues, [{ line: 8, file: "", message: "城市等级「五线」看不懂，可填：一线、新一线、二线、三线、四线、县级市" }]);
});

test("two-column sheet with 场所名称 header; without a city column the sheet or file name is the city", () => {
  assert.deepEqual(rowsToCities([["城市", "场所名称"], ["杭州", "金樽"], ["", "皇朝"], ["义乌", "小城"]]).cities.map(city => [city.name, city.venues.map(venue => venue.name).join(",")]), [["杭州", "金樽,皇朝"], ["义乌", "小城"]]);
  assert.deepEqual(rowsToCities([["店名", "区域"], ["店A", "西湖区"]], { sheetName: "杭州" }).cities, [{ name: "杭州", tier: null, venues: [{ name: "店A", district: "西湖区" }] }]);
  assert.deepEqual(rowsToCities([["店A"], ["店B"]], { sheetName: "Sheet1", fileName: "成都商K.xlsx" }).cities.map(city => [city.name, city.venues.length]), [["成都", 2]]);
  assert.match(rowsToCities([["店A"]], { sheetName: "Sheet1", fileName: "list.xlsx" }).issues[0].message, /没找到表头/);
});

test("csv handles quotes, commas, tabs pasted from Excel and BOM", () => {
  assert.deepEqual(parseCsv("﻿城市,店名\r\n杭州,\"金樽,会所\"\r\n杭州\t\"皇朝\"\"KTV\"\"\"\n义乌\t5\"号店\n"), [["城市", "店名"], ["杭州", "金樽,会所"], ["杭州", "皇朝\"KTV\""], ["义乌", "5\"号店"]]);
});

test("xlsx: merged city cells, one sheet per city, and the template itself import correctly", async () => {
  const book = new ExcelJS.Workbook();
  const main = book.addWorksheet("Sheet1");
  [["城市", "城市等级", "店名", "区域"], ["杭州", "", "金樽商务会所", ""], ["", "", "皇朝KTV", "滨江区"], ["义乌", "县级市", "小城KTV", ""]].forEach(row => main.addRow(row));
  main.mergeCells("A2:A3");
  const perCity = book.addWorksheet("成都");
  [["店名", "区域"], ["锦江会所", "锦江区"]].forEach(row => perCity.addRow(row));
  const parsed = await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()), "资料.xlsx");
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.cities.map(city => [city.name, city.tier, city.venues.map(venue => venue.name + (venue.district ? `/${venue.district}` : "")).join(",")]), [
    ["杭州", null, "金樽商务会所,皇朝KTV/滨江区"],
    ["义乌", "county", "小城KTV"],
    ["成都", null, "锦江会所/锦江区"],
  ]);

  const template = await parseImportFile({ name: "K图店名模板.xlsx", base64: (await buildTemplateWorkbook()).toString("base64") });
  assert.deepEqual(template.issues, []);
  assert.deepEqual(template.cities.map(city => [city.name, city.venues.length]), [["杭州", 2], ["义乌", 1]]);
  assert.match((await parseImportFile({ name: "旧表.xls", base64: "" })).issues[0].message, /另存为/);
  await assert.rejects(parseImportFile({ name: "坏文件.xlsx", base64: Buffer.from("not a zip").toString("base64") }), /不是有效的 Excel/);
});
