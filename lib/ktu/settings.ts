// K图：出图检查的开关和检查要求，对手动生成和定时任务都生效；每套图开始生成时记下当时的设置。

import { prisma } from "@/lib/db/prisma";

export const DEFAULT_REVIEW_REQUIREMENTS = [
  "店名、城市不能有错字、漏字",
  "文字清楚，看得清",
  "不出现衣着暴露或暧昧的人物",
  "不出现二维码和联系方式",
].join("\n");

export type KtuSettings = { reviewEnabled: boolean; reviewRequirements: string };

export async function getKtuSettings(): Promise<KtuSettings> {
  const row = await prisma.ktuSetting.findUnique({ where: { id: "default" } });
  return row ? { reviewEnabled: row.reviewEnabled, reviewRequirements: row.reviewRequirements } : { reviewEnabled: true, reviewRequirements: DEFAULT_REVIEW_REQUIREMENTS };
}

export async function updateKtuSettings(raw: Record<string, unknown>): Promise<KtuSettings> {
  const current = await getKtuSettings();
  const next = {
    reviewEnabled: typeof raw.reviewEnabled === "boolean" ? raw.reviewEnabled : current.reviewEnabled,
    reviewRequirements: typeof raw.reviewRequirements === "string" ? raw.reviewRequirements.trim().slice(0, 2000) : current.reviewRequirements,
  };
  await prisma.ktuSetting.upsert({ where: { id: "default" }, update: next, create: { id: "default", ...next } });
  return next;
}
