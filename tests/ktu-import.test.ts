import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/db/prisma";
import { cityFromFileName, mergeImports, parseImportText, parseTierWord } from "../lib/ktu/import-text";
import { importCities } from "../lib/ktu/library";

test("txt import reads city headers, tiers, districts and merges repeated cities", () => {
  const { cities, issues } = parseImportText("﻿# 杭州\r\n1. 金樽商务会所\r\n皇朝KTV 滨江区\r\n\r\n【义乌】县级市\r\n小城KTV\r\n# 杭州市\r\n星光汇 西湖区\r\n金樽商务会所\r\n# 乌鲁木齐（四线城市）\r\n天山会所");
  assert.deepEqual(issues, []);
  assert.deepEqual(cities, [
    { name: "杭州", tier: null, venues: [{ name: "金樽商务会所", district: "" }, { name: "皇朝KTV", district: "滨江区" }, { name: "星光汇", district: "西湖区" }] },
    { name: "义乌", tier: "county", venues: [{ name: "小城KTV", district: "" }] },
    { name: "乌鲁木齐", tier: "tier4", venues: [{ name: "天山会所", district: "" }] },
  ]);
});

test("a single-city file can use its file name as the city", () => {
  assert.equal(cityFromFileName("杭州.txt"), "杭州");
  assert.equal(cityFromFileName("杭州市商K名单.txt"), "杭州");
  assert.equal(cityFromFileName("乌鲁木齐-1026.txt"), "乌鲁木齐");
  assert.equal(cityFromFileName("list.txt"), "");
  assert.deepEqual(parseImportText("金樽商务会所\n皇朝KTV", "杭州店名.txt").cities.map(city => [city.name, city.venues.length]), [["杭州", 2]]);
  const orphan = parseImportText("金樽商务会所\n# 杭州\n皇朝KTV", "list.txt");
  assert.deepEqual(orphan.issues, [{ line: 1, file: "list.txt", message: "这一行前面没有城市，请先写一行「# 城市名」" }]);
  assert.deepEqual(orphan.cities.map(city => city.name), ["杭州"]);
  assert.equal(parseTierWord("新一线城市"), "newTier1");
  assert.equal(parseTierWord("县城"), "county");
  const merged = mergeImports([parseImportText("店A\n店B", "杭州.txt"), parseImportText("# 杭州\n店B\n店C")]);
  assert.deepEqual(merged.cities[0].venues.map(venue => venue.name), ["店A", "店B", "店C"]);
});

test("import appends new venues by default, removes missing ones only when asked, and keeps unknown cities unclassified", { concurrency: false }, async () => {
  await prisma.ktuCity.deleteMany({});
  const first = parseImportText("# 杭州\n店A\n店B 滨江区\n# 义乌\n小城KTV\n# 温州\n店X");
  const preview = await importCities(first.cities, { removeMissing: false, dryRun: true });
  assert.deepEqual(preview.map(city => [city.name, city.tier, city.added, city.error ? "error" : "ok"]), [["杭州", "newTier1", 2, "ok"], ["义乌", null, 1, "ok"], ["温州", "tier2", 1, "ok"]]);
  assert.equal(await prisma.ktuCity.count(), 0);

  await importCities(first.cities, { removeMissing: false, dryRun: false });
  assert.deepEqual((await prisma.ktuCity.findMany()).map(city => `${city.name}:${city.tier}`).sort(), ["义乌:", "杭州:newTier1", "温州:tier2"].sort());

  const second = parseImportText("# 杭州\n店B 西湖区\n店C");
  const appended = await importCities(second.cities, { removeMissing: false, dryRun: false });
  assert.deepEqual(appended.map(city => [city.added, city.removed, city.total]), [[1, 0, 3]]);
  const hangzhou = await prisma.ktuCity.findUniqueOrThrow({ where: { name: "杭州" }, include: { venues: { orderBy: { sortOrder: "asc" } } } });
  assert.deepEqual(hangzhou.venues.map(venue => `${venue.name}/${venue.district}`), ["店A/", "店B/西湖区", "店C/"]);

  const replaced = await importCities(second.cities, { removeMissing: true, dryRun: false });
  assert.deepEqual(replaced.map(city => [city.added, city.removed, city.total]), [[0, 1, 2]]);
  assert.equal(await prisma.ktuVenue.count({ where: { cityId: hangzhou.id } }), 2);

  await importCities(parseImportText("# 义乌 县级市\n小城KTV").cities, { removeMissing: false, dryRun: false });
  assert.equal((await prisma.ktuCity.findUniqueOrThrow({ where: { name: "义乌" } })).tier, "county");
  // 已在资料库的城市不必再写等级
  assert.equal((await importCities(parseImportText("# 义乌\n第二家").cities, { removeMissing: false, dryRun: true }))[0].tier, "county");
  await prisma.ktuCity.deleteMany({});
});
