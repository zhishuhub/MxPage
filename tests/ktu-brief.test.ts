import test from "node:test";
import assert from "node:assert/strict";
import { aspectImageSize, BUILTIN_TEMPLATES, defaultTierFor, describeTemplate, parseTemplateInput, parseVenueLines } from "../lib/ktu/catalog";
import { buildJobPlan, groupByDistrict, pageCountFor, selectVenues, type BriefVenue } from "../lib/ktu/brief";
import { checkPost, checkText } from "../lib/ktu/compliance";
import { createKtuPromptPack } from "../lib/ktu/prompts";
import { rebuildPrompt } from "../lib/ktu/redraw";

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

const T = (key: string) => BUILTIN_TEMPLATES.find(template => template.key === key)!;

test("random templates shuffle, rotating templates pick the least recently used venues first", () => {
  const venues = Array.from({ length: 8 }, (_, i) => venue(i, "", i < 4 ? new Date(2026, 9, 1 + i) : null));
  const ranking = selectVenues(T("ranking"), venues, [], seeded(7)).map(item => item.id);
  assert.equal(ranking.length, 7);
  assert.notDeepEqual(ranking, venues.slice(0, 7).map(item => item.id));
  assert.deepEqual(selectVenues(T("recommend"), venues).map(item => item.id), ["v4", "v5", "v6", "v7"]);
  assert.deepEqual(selectVenues(T("single"), venues).map(item => item.id), ["v4"]);
  assert.deepEqual(selectVenues(T("single"), venues, ["v2"]).map(item => item.id), ["v2"]);
});

test("page count follows the template: fixed, cover plus one per venue, cover plus one per district", () => {
  const venues = Array.from({ length: 15 }, (_, i) => venue(i));
  assert.equal(pageCountFor(T("tierlist"), venues), 7);
  assert.equal(pageCountFor(T("ranking"), venues.slice(0, 5)), 6);
  const mixed = [venue(1, "滨江区"), venue(2, "滨江区"), venue(3, "西湖区"), venue(4, "西湖区"), venue(5)];
  assert.deepEqual(groupByDistrict(mixed).map(group => group.district), ["滨江区", "西湖区"]);
  const plan = buildJobPlan({ template: T("district"), city, venues: mixed, aspect: "3:4", random: seeded(3) });
  assert.equal(plan.pageCount, 3);
  assert.equal(plan.venueIds.length, 4);
  assert.match(plan.brief, /之后每个区域一张，依次是：(滨江区、西湖区|西湖区、滨江区)。/);
  assert.throws(() => buildJobPlan({ template: T("district"), city, venues: venues.slice(0, 5), aspect: "3:4" }), /至少两个区域/);
});

test("job plans fill in the city, list exact names, keep the rules and drop the disclaimer", () => {
  const venues = Array.from({ length: 15 }, (_, i) => venue(i));
  for (const template of BUILTIN_TEMPLATES.filter(item => item.pages !== "perDistrict")) {
    const plan = buildJobPlan({ template, city, venues, aspect: "9:16", random: seeded(5) });
    assert.ok(plan.pageCount >= 4 && plan.pageCount <= 8, `${template.key}: ${plan.pageCount}`);
    assert.match(plan.brief, /共 \d 张，9:16 竖版/);
    assert.match(plan.brief, /不写价格、低消、地址/);
    assert.doesNotMatch(plan.brief, /\{城市\}|仅供娱乐|小红书|商品/);
    assert.ok(plan.brief.includes("杭州"));
    for (const id of plan.venueIds) assert.ok(plan.brief.includes(venues.find(item => item.id === id)!.name));
  }
  assert.throws(() => buildJobPlan({ template: T("ranking"), city, venues: venues.slice(0, 2), aspect: "3:4" }), /杭州：「城市商K排名」至少需要 3 家店/);
  const custom = { ...T("recommend"), key: "c_x", name: "夜宵后续摊", content: "封面写「{城市}续摊去哪」，黑金风。" };
  const plan = buildJobPlan({ template: custom, city, venues, aspect: "3:4" });
  assert.match(plan.brief, /封面写「杭州续摊去哪」，黑金风。/);
  assert.equal(plan.templateName, "夜宵后续摊");
});

test("template input is validated and described in one line", () => {
  assert.equal(describeTemplate(T("ranking")), "3–7 家店 · 随机 · 封面 + 每家店一张");
  assert.equal(describeTemplate(T("single")), "1 家店 · 轮换 · 4 张");
  const base = { name: "新模板", minVenues: 2, maxVenues: 4, pick: "rotate", pages: "fixed", pageCount: 5, content: "写点什么" };
  assert.deepEqual(parseTemplateInput(base), { ...base });
  assert.throws(() => parseTemplateInput({ ...base, name: " " }), /名称/);
  assert.throws(() => parseTemplateInput({ ...base, maxVenues: 1 }), /最多/);
  assert.throws(() => parseTemplateInput({ ...base, pages: "perVenue", maxVenues: 8 }), /最多 7 家店/);
  assert.throws(() => parseTemplateInput({ ...base, pageCount: 9 }), /1–8/);
  assert.throws(() => parseTemplateInput({ ...base, content: "" }), /每张图放什么/);
});

test("compliance check flags suggestive words, absolute claims and contact details but not ranking words", () => {
  assert.deepEqual(checkText("全网最好的商K，公主颜值高，加微信 13812345678", "正文").map(hit => hit.category), ["陪侍暗示", "陪侍暗示", "绝对化用语", "绝对化用语", "站外导流", "站外导流"]);
  assert.deepEqual(checkText("TOP1 金樽会所，夯！顶级档，第一张图看总榜", "标题"), []);
  const hits = checkPost({ title: "杭州商K", caption: "气氛拉满", hashtags: ["#杭州", "#唯一"] }, [{ title: "封面", copy: "官方推荐" }]);
  assert.deepEqual(hits.map(hit => `${hit.where}:${hit.word}`), ["话题标签:唯一", "第 1 张图:官方"]);
});

test("k-tu prompt pack is written for douyin business KTV and carries the review switch", () => {
  const pack = createKtuPromptPack("x", { aspect: "9:16", pageCount: 5, review: { reviewEnabled: false, reviewRequirements: "店名不能错", concurrency: 3, autoExport: false } });
  const all = `${pack.planning}${pack.artDirection}${pack.render}${pack.ktu!.imageReview}${pack.ktu!.setReview}${pack.ktu!.compose}`;
  assert.doesNotMatch(all, /小红书|Xiaohongshu|淘宝|电商|商品|详情页|风格库|3:4|1080×1440/);
  assert.match(pack.planning, /恰好 5 张/);
  assert.match(pack.ktu!.compose!, /恰好 5 张/);
  assert.match(pack.ktu!.compose!, /1080×1920/);
  assert.match(pack.render, /strict 9:16/);
  assert.match(pack.artDirection, /1080×1920/);
  assert.deepEqual(pack.ktu!.review, { enabled: false, requirements: "店名不能错" });
});

test("redraw keeps the series style and swaps only composition and exact copy", () => {
  const original = "MASTER\nSeries concept: neon\nPage composition:\nold scene\nUse the following Exact copy as the sole source of visible text. It overrides any conflicting wording in the visual description; do not rephrase, omit or add claims.\nExact copy:\nOld";
  const next = rebuildPrompt(original, "new scene", "TOP1 金樽\n杭州")!;
  assert.ok(next.startsWith("MASTER\nSeries concept: neon\nPage composition:\nnew scene\n"));
  assert.ok(next.endsWith("Exact copy:\nTOP1 金樽\n杭州"));
  assert.equal(rebuildPrompt("no marker", "a", "b"), null);
});
