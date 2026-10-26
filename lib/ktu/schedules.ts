// K图：定时任务的增删改查与校验。

import { prisma } from "@/lib/db/prisma";
import { isTemplateKey, isTierKey, normalizeAspect } from "./catalog";
import { defaultOutputDir } from "./export";
import { describeTiming, nextRunAfter, parseTimeOfDay } from "./schedule-time";
import { scheduleTiming } from "./scheduler";

const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const int = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function parseScheduleInput(raw: Record<string, unknown>) {
  const name = String(raw.name ?? "").trim().slice(0, 40);
  if (!name) throw new Error("请给任务起个名字");
  const scope = raw.scope === "cities" || raw.scope === "tiers" ? raw.scope : "all";
  const cityIds = scope === "cities" ? list(raw.cityIds) : [];
  const tiers = scope === "tiers" ? list(raw.tiers).filter(isTierKey) : [];
  if (scope === "cities" && !cityIds.length) throw new Error("请至少选择一个城市");
  if (scope === "tiers" && !tiers.length) throw new Error("请至少选择一个城市等级");
  const templateKeys = list(raw.templateKeys).filter(isTemplateKey);
  if (!templateKeys.length) throw new Error("请至少选择一个模板");
  const frequency = raw.frequency === "weekly" || raw.frequency === "interval" ? raw.frequency : "daily";
  const timeOfDay = String(raw.timeOfDay ?? "09:00");
  if (frequency !== "interval" && !parseTimeOfDay(timeOfDay)) throw new Error("请填写正确的时间，例如 09:30");
  const weekdays = list(raw.weekdays).map(Number).filter(day => day >= 1 && day <= 7);
  if (frequency === "weekly" && !weekdays.length) throw new Error("请至少选择一天");
  return {
    name, scope, cityIds, tiers, templateKeys, frequency, timeOfDay, weekdays,
    intervalHours: int(raw.intervalHours, 1, 168, 24),
    setsPerRun: int(raw.setsPerRun, 1, 50, 5),
    dailyLimit: int(raw.dailyLimit, 0, 500, 0),
    aspect: normalizeAspect(raw.aspect),
    outputDir: String(raw.outputDir ?? "").trim().slice(0, 500),
    enabled: raw.enabled !== false,
  };
}

export async function listSchedules() {
  const schedules = await prisma.ktuSchedule.findMany({ orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { startedAt: "desc" }, take: 5 } } });
  return {
    defaultOutputDir: defaultOutputDir(),
    schedules: schedules.map(schedule => ({
      ...schedule,
      timing: describeTiming(scheduleTiming(schedule)),
      running: schedule.runs.some(run => run.status === "running"),
      runs: schedule.runs.map(run => ({ id: run.id, status: run.status, planned: Array.isArray(run.planned) ? run.planned.length : 0, nextIndex: run.nextIndex, succeeded: run.succeeded, failed: run.failed, message: run.message, startedAt: run.startedAt, finishedAt: run.finishedAt })),
    })),
  };
}

export async function createSchedule(raw: Record<string, unknown>) {
  const data = parseScheduleInput(raw);
  return prisma.ktuSchedule.create({ data: { ...data, cursor: {}, nextRunAt: data.enabled ? nextRunAfter(scheduleTiming(data), new Date()) : null } });
}

export async function updateSchedule(id: string, raw: Record<string, unknown>) {
  const current = await prisma.ktuSchedule.findUniqueOrThrow({ where: { id } });
  // 只切换开关时不必整份重填
  const data = Object.keys(raw).length === 1 && "enabled" in raw
    ? { enabled: raw.enabled !== false }
    : parseScheduleInput(raw);
  const merged = { ...current, ...data };
  return prisma.ktuSchedule.update({ where: { id }, data: { ...data, nextRunAt: merged.enabled ? nextRunAfter(scheduleTiming(merged), new Date()) : null } });
}

export async function deleteSchedule(id: string) {
  await prisma.ktuSchedule.delete({ where: { id } });
}
