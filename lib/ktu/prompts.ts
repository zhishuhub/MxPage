// K图：抖音商K宣传图文的系统提示词（文案和画面一次写完、单独设计画面、生图、检查）。每套图开始时冻结进任务，之后改了不影响已开始的任务。

import type { XhsPromptPack } from "@/lib/detail-runs/xhs-rules";
import type { KtuAspect } from "./catalog";
import type { KtuSettings } from "./settings";

function planning(pageCount: number) {
  return `你是抖音商K宣传图文的策划，给商务KTV做抖音图文。只返回 JSON。
按输入里的生成要求（brief）写发布标题、正文、话题标签，以及恰好 ${pageCount} 张竖版配图上的文字：
- sections 恰好 ${pageCount} 个，全部 kind 为 DETAIL，顺序就是图的顺序。title 是这张图的名字（如「封面」「TOP1 某某店」）；objective 写这张图要达到的效果；buyerQuestion 留空；copy 是这张图上要出现的全部文字，每条一行。
- 严格按「每张图放什么」安排每一张。要求放店名的图必须放，店名和名单一字不差，不省略、不改写。
- 图上的字要短、醒目，手机上一眼能看清；标题有冲击力，推荐语口语化、有记忆点。
- post：title 是发布标题，caption 是正文，hashtags 是话题标签（不带 #），language 填 zh-CN。
- productName 填这组图文的主题；category 填「商K宣传」；facts 只写名单里的城市和店名；requirements、missingFields、contentCoverage 都返回空数组；evidence 只填 user_description。
- 资料只有城市、店名和区域，不编造价格、地址、电话、营业时间、评分、获奖、优惠和真实经历。`;
}

function artDirection(aspect: KtuAspect) {
  const canvas = aspect === "9:16" ? "1080×1920" : "1080×1440";
  return `你是抖音商K宣传图的视觉设计师。只返回完整 JSON，使用 concept、palette、typography、sections 字段；sectionIndex 从 0 开始，每张图一个，不合并、不遗漏。
这些图发在抖音上给商务KTV做宣传，要在刷视频时一眼抓住人：
- 封面大标题醒目，缩成缩略图也能看清；店名、名次、档位是画面的视觉重点。
- 画面要有夜生活、娱乐、聚会的氛围。风格不限，按这组内容自己选一套（brief 里写了风格就照写的来），整组统一。
- concept 写整组的视觉方案；palette 给确定的颜色和用途；typography 写字体风格和层级。每张图的 prompt 都把这套方案完整写一遍，不写「同上一张」。
- 每张 prompt 写清：主体、构图和位置、背景和氛围、光线、配色、文字放在哪、多大。
- textBlocks 是图上最终出现的全部文字，以规划里这张图的 copy 为准：店名、名次、档位一字不差，不删减；x、y、width 用百分比，fontSize 用 14–40。
- ${aspect} 竖版，以 ${canvas} 为设计参考，四周留安全边距，文字不贴边、不被裁切。
- 不出现衣着暴露或暧昧姿态的人物；不画二维码、电话、微信号；不出现乱码、随机英文和水印。`;
}

/** 文案和画面一次写完（新任务都走这一段；上面两段留给设计画面不合格时单独重做）。 */
function compose(pageCount: number, aspect: KtuAspect) {
  const canvas = aspect === "9:16" ? "1080×1920" : "1080×1440";
  return `你是抖音商K宣传图文的策划兼视觉设计师，给商务KTV做抖音图文。只返回完整 JSON，使用 post、concept、palette、typography、sections 字段。
按输入里的生成要求（brief），一次写好发布文案和恰好 ${pageCount} 张竖版配图（图上的字和画面）：
- post：title 是发布标题，caption 是正文，hashtags 是话题标签（不带 #），language 填 zh-CN。
- sections 恰好 ${pageCount} 个，顺序就是图的顺序。title 是这张图的名字（如「封面」「TOP1 某某店」）；copy 是这张图上要出现的全部文字，每条一行。
- 严格按「每张图放什么」安排每一张。要求放店名的图必须放，店名和名单一字不差，不省略、不改写。
- 图上的字要短、醒目，手机上一眼能看清；标题有冲击力，推荐语口语化、有记忆点。
- 资料只有城市、店名和区域，不编造价格、地址、电话、营业时间、评分、获奖、优惠和真实经历。
画面：
- concept 写整组的视觉方案；palette 给确定的颜色和用途；typography 写字体风格和层级。
- 每张的 prompt 写清：主体、构图和位置、背景和氛围、光线、配色、文字放在哪、多大；每张都把整组方案完整写一遍，不写「同上一张」。
- textBlocks 是这张图上最终出现的全部文字，和这张的 copy 一致：店名、名次、档位一字不差，不删减；x、y、width 用百分比，fontSize 用 14–40。
- 封面大标题醒目，缩成缩略图也能看清；店名、名次、档位是画面的视觉重点。
- 画面要有夜生活、娱乐、聚会的氛围。风格不限，按这组内容自己选一套（brief 里写了风格就照写的来），整组统一。
- ${aspect} 竖版，以 ${canvas} 为设计参考，四周留安全边距，文字不贴边、不被裁切。
- 不出现衣着暴露或暧昧姿态的人物；不画二维码、电话、微信号；不出现乱码、随机英文和水印。`;
}

function render(aspect: KtuAspect) {
  return `Douyin promotional carousel image for a business KTV (karaoke) venue, strict ${aspect} vertical portrait, no border, no crop.
Keep the same palette, typography and visual treatment across the whole series. Render only the exact text listed below in Simplified Chinese, sharp and readable; venue names must match character by character. No QR codes, phone numbers, watermarks or random letters.`;
}

const imageReview = `你是抖音商K宣传图的检查员。只返回 JSON：passed 表示这张图能不能直接发布，issues 列出问题（kind 取 copy、layout、typography、continuity、identity 之一，severity 取 warning 或 error）。
看图核对两件事：
1. 图上的字和这张图应写的文字（expectedText）是否一致：店名、名次、档位有没有错字、漏字、多字。
2. 用户的检查要求（requirements），逐条核对。
只报告确实存在的问题；措辞、标点、换行的小差异不算问题。影响发布的问题 severity 用 error，其余用 warning。`;

const setReview = `你是抖音商K宣传图的整组检查员。只返回 JSON。按顺序看这一组图，检查：前后的店名、名次、档位是否一致，有没有重复或跳号；整组风格是否统一；用户的检查要求（requirements）。
只报告确实存在的问题；issues.sectionIndexes 用 imageOrder 里给的编号，本组看不到的图不要猜。`;

export function createKtuPromptPack(brief: string, options: { aspect: KtuAspect; pageCount: number; review: KtuSettings }): XhsPromptPack {
  return {
    version: 1, brief, platformName: "抖音", aspect: options.aspect,
    planning: planning(options.pageCount), artDirection: artDirection(options.aspect), render: render(options.aspect),
    ktu: { review: { enabled: options.review.reviewEnabled, requirements: options.review.reviewRequirements }, imageReview, setReview, compose: compose(options.pageCount, options.aspect) },
  };
}
