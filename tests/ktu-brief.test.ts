import test from "node:test";
import assert from "node:assert/strict";
import { aspectImageSize, defaultTierFor, parseVenueLines } from "../lib/ktu/catalog";
import { buildJobPlan, selectVenues, splitTierList, groupByDistrict, type BriefVenue } from "../lib/ktu/brief";
import { checkPost, checkText } from "../lib/ktu/compliance";
import { createXhsPromptPack } from "../lib/detail-runs/xhs-rules";

const city = { id: "c1", name: "杭州", tier: "newTier1" };
const venue = (index: number, district = "", lastUsedAt: Date | null = null): BriefVenue => ({ id: `v${index}`, name: `店${index}`, district, sortOrder: index, lastUsedAt });
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test("pasted venue lines keep names, strip numbering and pick up a trailing district", () => {
  const venues = parseVenueLines("1. 金樽商务会所\n2、皇朝KTV 滨江区\n\n- 星光汇\t西湖区\n星光汇\n名人 汇");
  assert.deepEqual(venues, [
    { name: "金樽商务会所", district: "" },
    { name: "皇朝KTV", district: "滨江区" },
    { name: "星光汇", district: "西湖区" },
    { name: "名人 汇", district: "" },
  ]);
});

test("common cities get a default tier and both aspects use explicit sizes", () => {
  assert.equal(defaultTierFor("杭州市"), "newTier1");
  assert.equal(defaultTierFor("北京"), "tier1");
  assert.equal(defaultTierFor("义乌"), null);
  assert.equal(aspectImageSize("3:4"), "1152x1536");
  assert.equal(aspectImageSize("9:16"), "1152x2048");
});

test("tier list spreads venues top-down and uses fewer levels for short lists", () => {
  assert.deepEqual(splitTierList([venue(1), venue(2), venue(3)]).map(level => level.level), ["夯", "顶级", "人上人"]);
  const full = splitTierList(Array.from({ length: 12 }, (_, i) => venue(i)));
  assert.deepEqual(full.map(level => level.level), ["夯", "顶级", "人上人", "NPC", "拉完了"]);
  assert.equal(full.reduce((sum, level) => sum + level.venues.length, 0), 12);
});

test("rankings shuffle, recommendations rotate to the least recently used venues", () => {
  const venues = Array.from({ length: 8 }, (_, i) => venue(i, "", i < 4 ? new Date(2026, 9, 1 + i) : null));
  const ranking = selectVenues("ranking", venues, [], seeded(7)).map(item => item.id);
  assert.equal(ranking.length, 8);
  assert.notDeepEqual(ranking, venues.map(item => item.id));
  assert.deepEqual(selectVenues("recommend", venues).map(item => item.id), ["v4", "v5", "v6", "v7"]);
  assert.deepEqual(selectVenues("single", venues).map(item => item.id), ["v4"]);
  assert.deepEqual(selectVenues("single", venues, ["v2"]).map(item => item.id), ["v2"]);
});

test("district template needs at least two districts", () => {
  const plain = Array.from({ length: 5 }, (_, i) => venue(i));
  assert.throws(() => buildJobPlan({ templateKey: "district", city, venues: plain, aspect: "3:4" }), /至少两个区域/);
  const mixed = [venue(1, "滨江区"), venue(2, "滨江区"), venue(3, "西湖区"), venue(4)];
  assert.deepEqual(groupByDistrict(mixed).map(group => group.district), ["滨江区", "西湖区"]);
  const plan = buildJobPlan({ templateKey: "district", city, venues: mixed, aspect: "3:4", random: seeded(3) });
  assert.equal(plan.pageCount, 3);
  assert.equal(plan.venueIds.length, 3);
});

test("job plans stay within 8 pages, list exact names and carry the compliance rules", () => {
  const venues = Array.from({ length: 15 }, (_, i) => venue(i));
  for (const templateKey of ["ranking", "tierlist", "guide", "recommend", "single"] as const) {
    const plan = buildJobPlan({ templateKey, city, venues, aspect: "9:16", random: seeded(5) });
    assert.ok(plan.pageCount >= 4 && plan.pageCount <= 8, `${templateKey}: ${plan.pageCount}`);
    assert.match(plan.brief, /9:16 竖版/);
    assert.match(plan.brief, /不写价格、低消、地址/);
    assert.match(plan.brief, /missingFields 返回空数组/);
    assert.doesNotMatch(plan.brief, /氛围设计|实拍/);
    for (const id of plan.venueIds) assert.ok(plan.brief.includes(venues.find(item => item.id === id)!.name));
  }
  assert.throws(() => buildJobPlan({ templateKey: "ranking", city, venues: venues.slice(0, 2), aspect: "3:4" }), /杭州：「城市商K排名」至少需要 3 家店/);
});

test("compliance check flags suggestive words, absolute claims and contact details but not ranking words", () => {
  assert.deepEqual(checkText("全网最好的商K，公主颜值高，加微信 13812345678", "正文").map(hit => hit.category), ["陪侍暗示", "陪侍暗示", "绝对化用语", "绝对化用语", "站外导流", "站外导流"]);
  assert.deepEqual(checkText("TOP1 金樽会所，夯！顶级档，第一张图看总榜", "标题"), []);
  const hits = checkPost({ title: "杭州商K", caption: "气氛拉满", hashtags: ["#杭州", "#唯一"] }, [{ title: "封面", copy: "官方推荐" }]);
  assert.deepEqual(hits.map(hit => `${hit.where}:${hit.word}`), ["话题标签:唯一", "第 1 张图:官方"]);
});

test("douyin prompt pack swaps platform and aspect while old packs stay xiaohongshu 3:4", () => {
  const old = createXhsPromptPack("x");
  assert.equal(old.platformName, "小红书");
  assert.match(old.render, /strict 3:4/);
  const douyin = createXhsPromptPack("x", { platformName: "抖音", aspect: "9:16" });
  assert.doesNotMatch(`${douyin.planning}${douyin.artDirection}${douyin.render}`, /小红书|Xiaohongshu|3:4|1080×1440/);
  assert.match(douyin.render, /Douyin carousel page, strict 9:16/);
  assert.match(douyin.artDirection, /1080×1920/);
});
