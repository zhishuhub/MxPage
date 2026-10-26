// K图：城市等级与宣传模板的固定定义（前后端共用，不依赖数据库）。资料只有城市名、店名和选填的区域。

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

export const KTU_TEMPLATES = [
  { key: "ranking", name: "城市商K排名", summary: "封面 + TOP 榜，名次随机", minVenues: 3, maxVenues: 10 },
  { key: "tierlist", name: "夯到拉排行榜", summary: "夯、顶级、人上人、NPC、拉完了五档，随机分档", minVenues: 3, maxVenues: 15 },
  { key: "guide", name: "城市KTV怎么选", summary: "选店攻略，最后列几家本城的店", minVenues: 1, maxVenues: 3 },
  { key: "recommend", name: "商K精选推荐", summary: "每次轮换挑 2–5 家，每家一页", minVenues: 2, maxVenues: 5 },
  { key: "single", name: "单个商K介绍", summary: "轮换挑一家店，做一组介绍", minVenues: 1, maxVenues: 1 },
  { key: "district", name: "分区域商K整理", summary: "封面 + 每个区域一页，需要店名带区域", minVenues: 2, maxVenues: 28 },
] as const;
export type KtuTemplateKey = (typeof KTU_TEMPLATES)[number]["key"];

export function templateByKey(key: string) {
  return KTU_TEMPLATES.find(template => template.key === key) ?? null;
}
export function isTemplateKey(value: unknown): value is KtuTemplateKey {
  return KTU_TEMPLATES.some(template => template.key === value);
}

/** 夯到拉的五档，从上到下。 */
export const TIER_LIST_LEVELS = ["夯", "顶级", "人上人", "NPC", "拉完了"] as const;

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

