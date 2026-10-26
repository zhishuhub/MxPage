// K图：按模板挑店、排页，写成一段生成要求，交给图文流程（规划 → 分镜 → 生图 → 检查）。
// 资料只有店名（区域选填），画面风格交给模型发挥；文案不写价格、地址这类具体信息，避免给真实店铺编造事实。

import { COMPLIANCE_RULES } from "./compliance";
import { TIER_LIST_LEVELS, templateByKey, tierLabel, type KtuAspect, type KtuTemplateKey } from "./catalog";

export type BriefVenue = { id: string; name: string; district: string; sortOrder: number; lastUsedAt: Date | null };
export type BriefCity = { id: string; name: string; tier: string };
export type JobPlan = {
  templateKey: KtuTemplateKey;
  title: string;
  brief: string;
  pageCount: number;
  venueIds: string[];
};

const MAX_PAGES = 8;

/** 最久没出过的店排前面（没出过的最先），推荐、介绍、攻略靠它轮换到每一家。 */
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

/** 平均分进五档；店少于五家时只用前几档。 */
export function splitTierList(venues: BriefVenue[]) {
  const levels = TIER_LIST_LEVELS.map(level => ({ level, venues: [] as BriefVenue[] }));
  venues.forEach((venue, index) => levels[Math.floor(index * Math.min(5, venues.length) / venues.length)].venues.push(venue));
  return levels.filter(level => level.venues.length);
}

export function groupByDistrict(venues: BriefVenue[]) {
  const groups = new Map<string, BriefVenue[]>();
  for (const venue of venues) {
    if (!venue.district.trim()) continue;
    groups.set(venue.district.trim(), [...(groups.get(venue.district.trim()) || []), venue]);
  }
  return [...groups.entries()].map(([district, items]) => ({ district, venues: items })).sort((a, b) => b.venues.length - a.venues.length);
}

/** 按模板选店。picked 是用户手动指定的店（按指定顺序），不指定时自动挑；排行类名次随机。 */
export function selectVenues(templateKey: KtuTemplateKey, venues: BriefVenue[], picked: string[] = [], random: () => number = Math.random): BriefVenue[] {
  const template = templateByKey(templateKey)!;
  const chosen = picked.map(id => venues.find(venue => venue.id === id)).filter((venue): venue is BriefVenue => Boolean(venue));
  const pool = chosen.length ? chosen : venues;
  switch (templateKey) {
    case "ranking":
    case "tierlist":
      return shuffle(pool, random).slice(0, template.maxVenues);
    case "district":
      return groupByDistrict(shuffle(pool, random)).slice(0, MAX_PAGES - 1).flatMap(group => group.venues.slice(0, 4));
    default:
      return (chosen.length ? chosen : [...venues].sort(byLeastRecentlyUsed)).slice(0, templateKey === "recommend" && !chosen.length ? Math.min(4, venues.length) : template.maxVenues);
  }
}

export function selectionIssue(templateKey: KtuTemplateKey, selected: BriefVenue[]) {
  const template = templateByKey(templateKey)!;
  if (templateKey === "district" && groupByDistrict(selected).length < 2) return "「分区域商K整理」需要至少两个区域的店，请在店名后面填上区域";
  return selected.length < template.minVenues ? `「${template.name}」至少需要 ${template.minVenues} 家店` : "";
}

function pageOutline(templateKey: KtuTemplateKey, city: string, selected: BriefVenue[]): string[] {
  const names = (list: BriefVenue[]) => list.map(venue => `「${venue.name}」`).join("、");
  switch (templateKey) {
    case "ranking": {
      const top = selected.length > 6 ? selected.slice(0, 5) : selected;
      const rest = selected.slice(top.length);
      return [
        `第 1 张：封面，「${city}商K排名 TOP${selected.length}」类标题。`,
        ...top.map((venue, index) => `第 ${index + 2} 张：TOP${index + 1}「${venue.name}」，大号名次 + 店名 + 一句推荐语。`),
        ...(rest.length ? [`第 ${top.length + 2} 张：TOP${top.length + 1}–TOP${selected.length}：${rest.map((venue, index) => `${top.length + index + 1}. ${venue.name}`).join("，")}。`] : []),
      ];
    }
    case "tierlist": {
      const levels = splitTierList(selected);
      return [
        `第 1 张：封面，「${city}商K从夯到拉」类标题。`,
        `第 2 张：总榜，tier list 排行图：每档一行，左侧档位标签（${levels.map(level => level.level).join(" / ")}），行内是店名。各档：${levels.map(level => `${level.level}：${names(level.venues)}`).join("；")}。`,
        ...levels.map((level, index) => `第 ${index + 3} 张：「${level.level}」档，档位名 + ${names(level.venues)}，每家一句短评。`),
      ];
    }
    case "guide":
      return [
        `第 1 张：封面，「在${city}怎么选商务KTV」类标题。`,
        "第 2 张：看位置与交通停车。",
        "第 3 张：看包厢大小、装修与音响，按人数选包厢。",
        "第 4 张：看消费方式，提醒提前问清低消和酒水。",
        `第 5 张：${city}可以参考的店：${names(selected)}。`,
      ];
    case "recommend":
      return [
        `第 1 张：封面，「${city}商K精选推荐」类标题。`,
        ...selected.map((venue, index) => `第 ${index + 2} 张：「${venue.name}」，店名 + 推荐理由。`),
      ];
    case "single":
      return [
        `第 1 张：封面，店名「${selected[0].name}」大字 + ${city}${selected[0].district ? ` ${selected[0].district}` : ""}。`,
        "第 2 张：环境与氛围。",
        "第 3 张：适合的场合（商务宴请、朋友聚会、团建等）。",
        "第 4 张：总结推荐。",
      ];
    case "district": {
      const groups = groupByDistrict(selected);
      return [
        `第 1 张：封面，「${city}商K分区域整理」类标题，列出覆盖的区域。`,
        ...groups.map((group, index) => `第 ${index + 2} 张：${group.district}：${names(group.venues)}。`),
      ];
    }
  }
}

export function buildJobPlan(input: { templateKey: KtuTemplateKey; city: BriefCity; venues: BriefVenue[]; picked?: string[]; aspect: KtuAspect; random?: () => number }): JobPlan {
  const template = templateByKey(input.templateKey)!;
  const selected = selectVenues(input.templateKey, input.venues, input.picked, input.random);
  const issue = selectionIssue(input.templateKey, selected);
  if (issue) throw new Error(`${input.city.name}：${issue}`);
  const outline = pageOutline(input.templateKey, input.city.name, selected).slice(0, MAX_PAGES);

  const brief = [
    `为抖音图文做一组「${template.name}」：${input.city.name}（${tierLabel(input.city.tier)}）。`,
    `共 ${outline.length} 张，${input.aspect} 竖版。画面风格自由发挥，整组统一。`,
    "",
    "【页面安排】",
    ...outline,
    "",
    "【店名】",
    "图上的店名必须和下面完全一致，一个字都不能改、不能漏：",
    selected.map((venue, index) => `${index + 1}. ${venue.name}${venue.district ? `（${venue.district}）` : ""}`).join("\n"),
    "",
    "【文案】",
    "除店名、城市和区域外没有其他资料：不写价格、低消、地址、电话、营业时间、评分、获奖、优惠活动这类具体信息。",
    "post.title 控制在 20 字左右；post.caption 写成抖音风格的正文，口语化、有梗；hashtags 3–8 个，包含城市名。",
    "",
    "【必须遵守】",
    ...COMPLIANCE_RULES,
    "资料已经完整，不需要再向用户补问，missingFields 返回空数组。",
  ].join("\n");

  return { templateKey: input.templateKey, title: `${input.city.name}·${template.name}${input.templateKey === "single" ? `·${selected[0].name}` : ""}`.slice(0, 60), brief, pageCount: outline.length, venueIds: selected.map(venue => venue.id) };
}
