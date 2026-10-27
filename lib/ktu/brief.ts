// K图：按模板挑店、算张数，写成一段生成要求，交给图文流程（文案 → 画面 → 生图 → 检查）。
// 资料只有店名（区域选填），画面风格交给模型发挥；文案不写价格、地址这类具体信息，避免给真实店铺编造事实。

import { COMPLIANCE_RULES } from "./compliance";
import { MAX_PAGES, tierLabel, type KtuAspect, type KtuTemplateDef } from "./catalog";

export type BriefVenue = { id: string; name: string; district: string; sortOrder: number; lastUsedAt: Date | null };
export type BriefCity = { id: string; name: string; tier: string };
export type BriefTemplate = Pick<KtuTemplateDef, "key" | "name" | "minVenues" | "maxVenues" | "pick" | "pages" | "pageCount" | "content">;
export type JobPlan = {
  templateKey: string;
  templateName: string;
  title: string;
  brief: string;
  pageCount: number;
  venueIds: string[];
};

/** 每个区域最多放几家，区域最多几个（封面占一张）。 */
const PER_DISTRICT = 4;

/** 最久没出过的店排前面（没出过的最先），轮换模板靠它轮到每一家。 */
function byLeastRecentlyUsed(a: BriefVenue, b: BriefVenue) {
  return (a.lastUsedAt?.getTime() ?? 0) - (b.lastUsedAt?.getTime() ?? 0) || a.sortOrder - b.sortOrder;
}

export function shuffle<T>(items: T[], random: () => number = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function groupByDistrict(venues: BriefVenue[]) {
  const groups = new Map<string, BriefVenue[]>();
  for (const venue of venues) {
    if (!venue.district.trim()) continue;
    groups.set(venue.district.trim(), [...(groups.get(venue.district.trim()) || []), venue]);
  }
  return [...groups.entries()].map(([district, items]) => ({ district, venues: items })).sort((a, b) => b.venues.length - a.venues.length);
}

/** 按模板挑店。picked 是用户手动指定的店（按指定顺序），不指定时按模板自动挑。 */
export function selectVenues(template: BriefTemplate, venues: BriefVenue[], picked: string[] = [], random: () => number = Math.random): BriefVenue[] {
  const chosen = picked.map(id => venues.find(venue => venue.id === id)).filter((venue): venue is BriefVenue => Boolean(venue));
  const pool = chosen.length ? chosen : venues;
  const ordered = template.pick === "random" ? shuffle(pool, random) : chosen.length ? chosen : [...pool].sort(byLeastRecentlyUsed);
  if (template.pages === "perDistrict") {
    return groupByDistrict(ordered).slice(0, MAX_PAGES - 1).flatMap(group => group.venues.slice(0, PER_DISTRICT)).slice(0, template.maxVenues);
  }
  return ordered.slice(0, template.maxVenues);
}

export function selectionIssue(template: BriefTemplate, selected: BriefVenue[]) {
  if (template.pages === "perDistrict" && groupByDistrict(selected).length < 2) return `「${template.name}」需要至少两个区域的店，请在资料库里给店填上区域`;
  return selected.length < template.minVenues ? `「${template.name}」至少需要 ${template.minVenues} 家店` : "";
}

export function pageCountFor(template: BriefTemplate, selected: BriefVenue[]) {
  if (template.pages === "perVenue") return Math.min(MAX_PAGES, 1 + selected.length);
  if (template.pages === "perDistrict") return Math.min(MAX_PAGES, 1 + groupByDistrict(selected).length);
  return Math.min(MAX_PAGES, Math.max(1, template.pageCount));
}

function venueList(template: BriefTemplate, selected: BriefVenue[]) {
  if (template.pages === "perDistrict") return groupByDistrict(selected).map(group => `${group.district}：${group.venues.map(venue => venue.name).join("、")}`);
  return selected.map((venue, index) => `${index + 1}. ${venue.name}${venue.district ? `（${venue.district}）` : ""}`);
}

function structureLine(template: BriefTemplate, selected: BriefVenue[], pageCount: number) {
  if (template.pages === "perVenue") return `第 1 张是封面，第 2–${pageCount} 张按名单顺序每家店一张。`;
  if (template.pages === "perDistrict") return `第 1 张是封面，之后每个区域一张，依次是：${groupByDistrict(selected).map(group => group.district).join("、")}。`;
  return "";
}

export function buildJobPlan(input: { template: BriefTemplate; city: BriefCity; venues: BriefVenue[]; picked?: string[]; aspect: KtuAspect; random?: () => number }): JobPlan {
  const { template, city } = input;
  const selected = selectVenues(template, input.venues, input.picked, input.random);
  const issue = selectionIssue(template, selected);
  if (issue) throw new Error(`${city.name}：${issue}`);
  const pageCount = pageCountFor(template, selected);
  const structure = structureLine(template, selected, pageCount);

  const brief = [
    `为抖音做一组商K宣传图文「${template.name}」，城市：${city.name}（${tierLabel(city.tier)}）。`,
    `共 ${pageCount} 张，${input.aspect} 竖版。${structure}`,
    "",
    "【每张图放什么】",
    template.content.replaceAll("{城市}", city.name),
    "",
    "【店名单】",
    "图上出现的店名必须和名单完全一致，不能改字、漏字；要排名次时按名单顺序。",
    ...venueList(template, selected),
    "",
    "【文案】",
    "资料只有城市、店名和区域：不写价格、低消、地址、电话、营业时间、评分、获奖、优惠活动这类具体信息。",
    "发布标题 20 字左右；正文写成抖音风格，口语化、有梗；话题标签 3–8 个，包含城市名。",
    "",
    "【必须遵守】",
    ...COMPLIANCE_RULES,
  ].join("\n");

  return {
    templateKey: template.key,
    templateName: template.name,
    title: `${city.name}·${template.name}${selected.length === 1 ? `·${selected[0].name}` : ""}`.slice(0, 60),
    brief,
    pageCount,
    venueIds: selected.map(venue => venue.id),
  };
}
