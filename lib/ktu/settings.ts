// K图：生成设置——出图检查的开关和检查要求、同时生成几套、手动生成完是否自动导出。对手动生成和定时任务都生效；
// 检查设置在每套图开始生成时记下，之后改了不影响已开始的那套。

import { prisma } from "@/lib/db/prisma";

export const DEFAULT_REVIEW_REQUIREMENTS = [
  "店名、城市不能有错字、漏字",
  "文字清楚，看得清",
  "不出现衣着暴露或暧昧的人物",
  "不出现二维码和联系方式",
].join("\n");

export const MAX_CONCURRENCY = 6;
export const DEFAULT_CONCURRENCY = 3;

export type KtuSettings = { reviewEnabled: boolean; reviewRequirements: string; concurrency: number; autoExport: boolean };

const clampConcurrency = (value: number) => Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(value) || DEFAULT_CONCURRENCY));

export async function getKtuSettings(): Promise<KtuSettings> {
  const row = await prisma.ktuSetting.findUnique({ where: { id: "default" } });
  return row
    ? { reviewEnabled: row.reviewEnabled, reviewRequirements: row.reviewRequirements, concurrency: clampConcurrency(row.concurrency), autoExport: row.autoExport }
    : { reviewEnabled: true, reviewRequirements: DEFAULT_REVIEW_REQUIREMENTS, concurrency: DEFAULT_CONCURRENCY, autoExport: false };
}

export async function updateKtuSettings(raw: Record<string, unknown>): Promise<KtuSettings> {
  const current = await getKtuSettings();
  const next = {
    reviewEnabled: typeof raw.reviewEnabled === "boolean" ? raw.reviewEnabled : current.reviewEnabled,
    reviewRequirements: typeof raw.reviewRequirements === "string" ? raw.reviewRequirements.trim().slice(0, 2000) : current.reviewRequirements,
    concurrency: typeof raw.concurrency === "number" ? clampConcurrency(raw.concurrency) : current.concurrency,
    autoExport: typeof raw.autoExport === "boolean" ? raw.autoExport : current.autoExport,
  };
  await prisma.ktuSetting.upsert({ where: { id: "default" }, update: next, create: { id: "default", ...next } });
  return next;
}
