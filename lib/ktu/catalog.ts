// K图：城市等级、内置宣传模板和模板校验（前后端共用，不依赖数据库）。资料只有城市名、店名和选填的区域。

export const KTU_TIERS = [
  { key: "tier1", label: "一线城市" },
  { key: "newTier1", label: "新一线城市" },
  { key: "tier2", label: "二线城市" },
  { key: "tier3", label: "三线城市" },
  { key: "tier4", label: "四线城市" },
  { key: "county", label: "县级市" },
] as const;
export type KtuTierKey = (typeof KTU_TIERS)[number]["key"];

export function tierLabel(key: string) {
  return KTU_TIERS.find(tier => tier.key === key)?.label ?? "未分级";
}
export function isTierKey(value: unknown): value is KtuTierKey {
  return KTU_TIERS.some(tier => tier.key === value);
}
export function tierOrder(key: string) {
  const index = KTU_TIERS.findIndex(tier => tier.key === key);
  return index < 0 ? KTU_TIERS.length : index;
}

// 新建城市时预填的等级，用户可以改。三线及以下城市太多，不预填。
const DEFAULT_TIERS: Record<string, KtuTierKey> = Object.fromEntries([
  ...["北京", "上海", "广州", "深圳"].map(name => [name, "tier1"]),
  ...["成都", "杭州", "重庆", "苏州", "武汉", "西安", "南京", "长沙", "天津", "郑州", "东莞", "无锡", "宁波", "青岛", "合肥"].map(name => [name, "newTier1"]),
  ...["佛山", "沈阳", "昆明", "济南", "厦门", "福州", "温州", "哈尔滨", "石家庄", "大连", "南宁", "泉州", "金华", "贵阳", "常州", "长春", "南昌", "南通", "嘉兴", "徐州", "太原", "惠州", "珠海", "中山", "台州", "烟台", "兰州", "绍兴", "海口", "扬州"].map(name => [name, "tier2"]),
]);
export function defaultTierFor(cityName: string): KtuTierKey | null {
  return DEFAULT_TIERS[cityName.trim().replace(/市$/, "")] ?? null;
}

/** 一组图最多几张。 */
export const MAX_PAGES = 8;

/**
 * 宣传模板：挑几家店、怎么挑、出几张、每张放什么。
 * pick：random 每次打乱；rotate 最久没出过的店先出。
 * pages：fixed 固定 pageCount 张；perVenue 封面 + 每家店一张；perDistrict 封面 + 每个区域一张。
 * content 用大白话写每张图放什么，{城市} 换成城市名，店名单由程序附在后面。
 */
export type KtuTemplateDef = {
  key: string;
  name: string;
  builtin: boolean;
  minVenues: number;
  maxVenues: number;
  pick: "random" | "rotate";
  pages: "fixed" | "perVenue" | "perDistrict";
  pageCount: number;
  content: string;
};

export const BUILTIN_TEMPLATES: KtuTemplateDef[] = [
  {
    key: "ranking", name: "城市商K排名", builtin: true, minVenues: 3, maxVenues: 7, pick: "random", pages: "perVenue", pageCount: 8,
    content: "第 1 张封面：大标题「{城市}商K排名」，可以放上部分店名。\n后面每张一家店，按名单顺序排名次：大号名次（TOP1、TOP2……）+ 店名 + 一句推荐语。",
  },
  {
    key: "tierlist", name: "夯到拉排行榜", builtin: true, minVenues: 5, maxVenues: 15, pick: "random", pages: "fixed", pageCount: 7,
    content: "按名单顺序把店平均分进五档：夯、顶级、人上人、NPC、拉完了。\n第 1 张封面：大标题「{城市}商K从夯到拉」。\n第 2 张总榜：从上到下五档，每档一行，左边是档位名，行里放这一档的店名。\n第 3–7 张每档一张：档位名 + 这一档的店名，每家一句短评。",
  },
  {
    key: "guide", name: "城市KTV怎么选", builtin: true, minVenues: 3, maxVenues: 3, pick: "rotate", pages: "fixed", pageCount: 4,
    content: "第 1 张封面：大标题「在{城市}怎么选商务KTV」。\n第 2–4 张每张一条选店建议（比如看位置和停车、看包厢和音响、提前问清消费方式），每张配名单里的一家店，写上店名和一句推荐。",
  },
  {
    key: "recommend", name: "商K精选推荐", builtin: true, minVenues: 2, maxVenues: 4, pick: "rotate", pages: "perVenue", pageCount: 5,
    content: "第 1 张封面：大标题「{城市}商K精选推荐」，可以放上店名。\n后面每张一家店：店名 + 推荐理由。",
  },
  {
    key: "single", name: "单个商K介绍", builtin: true, minVenues: 1, maxVenues: 1, pick: "rotate", pages: "fixed", pageCount: 4,
    content: "第 1 张封面：大字店名 + {城市}。\n第 2 张：环境与氛围。\n第 3 张：适合的场合（商务宴请、朋友聚会、团建等）。\n第 4 张：总结推荐。\n每张都放上店名。",
  },
  {
    key: "district", name: "分区域商K整理", builtin: true, minVenues: 4, maxVenues: 20, pick: "random", pages: "perDistrict", pageCount: 8,
    content: "第 1 张封面：大标题「{城市}商K分区域整理」，列出覆盖的区域。\n后面每个区域一张：区域名 + 这个区域的店名。",
  },
];

export function builtinTemplate(key: string) {
  return BUILTIN_TEMPLATES.find(template => template.key === key) ?? null;
}

export const PICK_LABEL: Record<KtuTemplateDef["pick"], string> = { random: "随机", rotate: "轮换" };
export const PAGES_LABEL: Record<KtuTemplateDef["pages"], string> = { fixed: "固定张数", perVenue: "封面 + 每家店一张", perDistrict: "封面 + 每个区域一张" };

/** 模板卡片上的一句话说明，例如「3–7 家店 · 随机 · 封面 + 每家店一张」。 */
export function describeTemplate(template: Pick<KtuTemplateDef, "minVenues" | "maxVenues" | "pick" | "pages" | "pageCount">) {
  const venues = template.minVenues === template.maxVenues ? `${template.minVenues} 家店` : `${template.minVenues}–${template.maxVenues} 家店`;
  return [venues, PICK_LABEL[template.pick], template.pages === "fixed" ? `${template.pageCount} 张` : PAGES_LABEL[template.pages]].join(" · ");
}

/** 校验用户填写的模板，返回可以直接存库的字段。 */
export function parseTemplateInput(raw: Record<string, unknown>) {
  const int = (value: unknown) => Math.round(Number(value));
  const name = String(raw.name ?? "").trim().slice(0, 20);
  if (!name) throw new Error("请填写模板名称");
  const pick = raw.pick === "rotate" ? "rotate" : "random";
  const pages = raw.pages === "perVenue" || raw.pages === "perDistrict" ? raw.pages : "fixed";
  const minVenues = int(raw.minVenues);
  const maxVenues = int(raw.maxVenues);
  if (!Number.isFinite(minVenues) || minVenues < 1 || minVenues > 30) throw new Error("最少用几家店请填 1–30");
  if (!Number.isFinite(maxVenues) || maxVenues < minVenues || maxVenues > 30) throw new Error("最多用几家店不能少于最少家数，也不能超过 30");
  if (pages === "perVenue" && maxVenues > MAX_PAGES - 1) throw new Error(`「封面 + 每家店一张」最多 ${MAX_PAGES - 1} 家店（一组最多 ${MAX_PAGES} 张图）`);
  if (pages === "perDistrict" && minVenues < 2) throw new Error("按区域出图至少要 2 家店");
  const pageCount = pages === "fixed" ? int(raw.pageCount) : MAX_PAGES;
  if (!Number.isFinite(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) throw new Error(`出几张图请填 1–${MAX_PAGES}`);
  const content = String(raw.content ?? "").trim().slice(0, 2000);
  if (!content) throw new Error("请写每张图放什么");
  return { name, pick, pages, minVenues, maxVenues, pageCount, content } as const;
}

export const KTU_ASPECTS = ["3:4", "9:16"] as const;
export type KtuAspect = (typeof KTU_ASPECTS)[number];
export function normalizeAspect(value: unknown): KtuAspect {
  return value === "9:16" ? "9:16" : "3:4";
}
/** 两种比例都给显式尺寸（16 的倍数），不交给接口按模型名猜。 */
export function aspectImageSize(aspect: KtuAspect) {
  return aspect === "9:16" ? "1152x2048" : "1152x1536";
}

const DISTRICT_SUFFIX = /(?:区|县|市|镇|新城|开发区|商圈)$/;

/** 粘贴的店名列表：每行一家，「店名」或「店名 区域」（空格、Tab、逗号分隔都行）；去掉序号、空行和重复。 */
export function parseVenueLines(text: string) {
  const venues: Array<{ name: string; district: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/^\s*(?:\d+\s*[.、．)）]\s*|[-*•·]\s*)/, "").trim();
    if (!clean) continue;
    const parts = clean.split(/[\t,，]|\s+/).map(part => part.trim()).filter(Boolean);
    const district = parts.length > 1 && DISTRICT_SUFFIX.test(parts[parts.length - 1]) ? parts.pop()! : "";
    const name = parts.join(" ").slice(0, 60);
    if (name && !venues.some(venue => venue.name === name)) venues.push({ name, district: district.slice(0, 30) });
  }
  return venues.slice(0, 500);
}

