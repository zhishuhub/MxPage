// K图：发布前的文字检查。只提示不拦截——命中的词在作品里标红，导出时写进「需检查.txt」。

export type ComplianceCategory = "陪侍暗示" | "绝对化用语" | "站外导流";
export type ComplianceHit = { word: string; category: ComplianceCategory; where: string };

const RULES: Array<{ category: ComplianceCategory; pattern: RegExp }> = [
  { category: "陪侍暗示", pattern: /陪侍|陪酒|陪唱|陪玩|公主|少爷|佳丽|选妃|嫩模|模特|学生妹|外围|伴游|出台|包夜|带出|特殊服务|一条龙|荤场|莞式|大保健|上钟|美女如云|小妹|妹子|颜值/g },
  { category: "绝对化用语", pattern: /第一(?![张页步次个家站轮批期])|最好|最佳|最强|最大|最便宜|最低价|极品|首选|唯一|全网|全城最|史无前例|百分之百|100%|绝对|国家级|世界级|王牌|冠军|权威|官方/g },
  { category: "站外导流", pattern: /微信|威信|vx|加v|加V|wx|二维码|QQ|电话|手机号|(?<!\d)1[3-9]\d{9}(?!\d)/g },
];

export function checkText(text: string, where: string): ComplianceHit[] {
  const hits: ComplianceHit[] = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      if (!hits.some(hit => hit.word === match[0] && hit.category === rule.category)) hits.push({ word: match[0], category: rule.category, where });
    }
  }
  return hits;
}

export function checkPost(post: { title?: string; caption?: string; hashtags?: string[] } | null | undefined, pages: Array<{ title: string; copy?: string | null }>) {
  const hits = [
    ...checkText(post?.title || "", "标题"),
    ...checkText(post?.caption || "", "正文"),
    ...checkText((post?.hashtags || []).join(" "), "话题标签"),
    ...pages.flatMap((page, index) => checkText(`${page.title}\n${page.copy || ""}`, `第 ${index + 1} 张图`)),
  ];
  return hits.filter((hit, index) => hits.findIndex(other => other.word === hit.word && other.where === hit.where) === index);
}

/** 写进生成要求里的硬性规定，从源头少出问题。 */
export const COMPLIANCE_RULES = [
  "只描述氛围、场合和感受；不得出现任何陪侍、有偿陪伴暗示，不写「公主、少爷、佳丽、模特、选妃、颜值」等词，画面不出现衣着暴露或暧昧姿态的人物。",
  "不用「第一、最好、最佳、顶级（夯到拉的档位名除外）、唯一、全网、全城最、权威、官方」等绝对化用语。",
  "榜单是主观推荐：正文末尾写一句「个人主观排名，仅供娱乐参考」；低档位用玩梗语气，不贬损、不攻击具体店铺。",
  "不写微信号、电话、二维码等站外联系方式，图上不画二维码。",
];
