// K图：批量生成与定时任务。
// 一批（KtuScheduleRun）里排好若干套「模板 × 城市」，每次只跑一套，跑完（定时任务还会自动导出）再开下一套。
// 推进靠 tick：桌面壳每 30 秒调一次，页面打开时也会调；所有状态都在数据库里，关掉应用再打开接着跑。

import { prisma } from "@/lib/db/prisma";
import { getDetailRun } from "@/lib/detail-runs/service";
import { ensureZhishuProvider } from "@/lib/zhishu/connection";
import { isTemplateKey, normalizeAspect, templateByKey, tierOrder } from "./catalog";
import { selectVenues, selectionIssue } from "./brief";
import { createKtuJob, nudgeJob, stopJob } from "./jobs";
import { exportJob } from "./export";
import { nextRunAfter, startOfLocalDay, type ScheduleTiming } from "./schedule-time";

export type JobSpec = { templateKey: string; cityId: string; cityName: string; picked?: string[]; aspect: string };
type Cursor = { city: number; template: number };

const RUN_ACTIVE = ["PENDING", "RUNNING", "WAITING_INPUT", "WAITING_PROMPTS", "INTERRUPTED"];
const QUOTA_ERROR = /app_quota_exhausted|insufficient_quota|quota|额度|余额不足|402/i;

const state = globalThis as typeof globalThis & { ktuTickBusy?: boolean };

function list<T = string>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function scheduleTiming(schedule: { frequency: string; timeOfDay: string; weekdays: unknown; intervalHours: number }): ScheduleTiming {
  const frequency = schedule.frequency === "weekly" || schedule.frequency === "interval" ? schedule.frequency : "daily";
  return { frequency, timeOfDay: schedule.timeOfDay, weekdays: list<number>(schedule.weekdays).map(Number), intervalHours: schedule.intervalHours };
}

/** 范围内的城市，按城市等级、录入顺序排。 */
async function citiesInScope(scope: string, cityIds: string[], tiers: string[]) {
  const where = scope === "cities" ? { id: { in: cityIds } } : scope === "tiers" ? { tier: { in: tiers } } : {};
  const cities = await prisma.ktuCity.findMany({ where, include: { venues: true } });
  return cities.sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
}

/**
 * 轮换排单：每一套换一个城市，城市轮完一圈再换下一个模板，这样相邻两套不会是同一城市同一模板。
 * 资料不够某个模板用的城市自动跳过。返回排好的单和推进后的游标。
 */
export function planRotation(
  cities: Array<{ id: string; name: string; venues: Array<{ id: string; name: string; district: string; sortOrder: number; lastUsedAt: Date | null }> }>,
  templateKeys: string[],
  count: number,
  cursor: Cursor,
  aspect: string,
): { specs: JobSpec[]; cursor: Cursor } {
  const templates = templateKeys.filter(isTemplateKey);
  const next = { city: cursor.city || 0, template: cursor.template || 0 };
  const specs: JobSpec[] = [];
  if (!cities.length || !templates.length) return { specs, cursor: next };
  const maxSteps = cities.length * templates.length;
  // 连续一整圈都没有可用组合时停止，避免空转
  for (let misses = 0; specs.length < count && misses < maxSteps;) {
    const city = cities[next.city % cities.length];
    const templateKey = templates[next.template % templates.length];
    next.city++;
    if (next.city % cities.length === 0) next.template++;
    if (selectionIssue(templateKey, selectVenues(templateKey, city.venues))) misses++;
    else { specs.push({ templateKey, cityId: city.id, cityName: city.name, aspect }); misses = 0; }
  }
  return { specs, cursor: { city: next.city % cities.length, template: next.template % templates.length } };
}

/** 手动批量：选中的城市 × 模板全部排进一批。 */
export async function startManualBatch(input: { cityIds: string[]; tiers: string[]; templateKeys: string[]; picked?: string[]; aspect?: string }) {
  const templates = input.templateKeys.filter(isTemplateKey);
  if (!templates.length) throw new Error("请至少选择一个模板");
  const cities = await citiesInScope(input.cityIds.length ? "cities" : "tiers", input.cityIds, input.tiers);
  if (!cities.length) throw new Error("所选范围内没有城市");
  const aspect = normalizeAspect(input.aspect);
  const specs: JobSpec[] = [];
  const skipped: string[] = [];
  for (const city of cities) for (const templateKey of templates) {
    const picked = cities.length === 1 ? input.picked : undefined;
    const issue = selectionIssue(templateKey, selectVenues(templateKey, city.venues, picked));
    if (issue) skipped.push(`${city.name}：${issue}`);
    else specs.push({ templateKey, cityId: city.id, cityName: city.name, picked, aspect });
  }
  if (!specs.length) throw new Error(skipped[0] || "资料不够生成所选模板");
  const run = await prisma.ktuScheduleRun.create({ data: { kind: "manual", planned: specs, message: skipped.length ? `跳过：${skipped.join("；")}` : null } });
  void tick().catch(() => undefined);
  return { run, skipped };
}

export async function runScheduleNow(scheduleId: string) {
  const schedule = await prisma.ktuSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
  if (await prisma.ktuScheduleRun.findFirst({ where: { scheduleId, status: "running" } })) throw new Error("这个任务正在运行，等这一轮跑完再试");
  const run = await startScheduleRun(schedule, new Date());
  void tick().catch(() => undefined);
  return run;
}

async function startScheduleRun(schedule: Awaited<ReturnType<typeof prisma.ktuSchedule.findUniqueOrThrow>>, now: Date) {
  const doneToday = schedule.dailyLimit > 0 ? await prisma.ktuJob.count({ where: { scheduleRun: { scheduleId: schedule.id }, createdAt: { gte: startOfLocalDay(now) } } }) : 0;
  const allowance = schedule.dailyLimit > 0 ? Math.max(0, schedule.dailyLimit - doneToday) : schedule.setsPerRun;
  const cities = await citiesInScope(schedule.scope, list(schedule.cityIds), list(schedule.tiers));
  const { specs, cursor } = planRotation(cities, list(schedule.templateKeys), Math.min(schedule.setsPerRun, allowance), (schedule.cursor ?? {}) as Cursor, schedule.aspect);
  const message = !allowance ? "今天已达到每天上限，本次不生成" : !specs.length ? "范围内的城市资料不够生成所选模板" : null;
  const run = await prisma.ktuScheduleRun.create({
    data: { scheduleId: schedule.id, kind: "schedule", outputDir: schedule.outputDir, planned: specs, message, ...(specs.length ? {} : { status: "skipped", finishedAt: now }) },
  });
  await prisma.ktuSchedule.update({ where: { id: schedule.id }, data: { cursor, lastRunAt: now, nextRunAt: nextRunAfter(scheduleTiming(schedule), now) } });
  return run;
}

function appendMessage(current: string | null, line: string) {
  return [current, line].filter(Boolean).join("；").slice(-2000);
}

/** 推进一批：看当前那一套跑到哪了，跑完就结算并开下一套。 */
async function advanceRun(runId: string) {
  let run = await prisma.ktuScheduleRun.findUniqueOrThrow({ where: { id: runId } });
  const current = await prisma.ktuJob.findFirst({ where: { scheduleRunId: run.id, settledAt: null }, orderBy: { createdAt: "desc" } });
  if (current) {
    const detail = await getDetailRun(current.projectId).catch(() => null);
    // 中断的接着跑、要补问的按现有资料继续；接不上就按未完成结算
    if (detail && ["INTERRUPTED", "WAITING_INPUT"].includes(detail.status)) {
      if (await nudgeJob(current.projectId)) return;
    } else if (detail && RUN_ACTIVE.includes(detail.status)) {
      return;
    }
    const finished = detail && ["COMPLETED", "PARTIAL"].includes(detail.status);
    if (!finished && QUOTA_ERROR.test(detail?.error || "")) {
      await prisma.ktuJob.update({ where: { id: current.id }, data: { settledAt: new Date() } });
      await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { status: "quota", failed: { increment: 1 }, finishedAt: new Date(), message: appendMessage(run.message, "额度不足，已停止，请到网站充值") } });
      return;
    }
    let note = "";
    if (finished && run.kind === "schedule") {
      try { await exportJob(current.id, run.outputDir || undefined); } catch (error) { note = `${current.cityName}导出失败：${error instanceof Error ? error.message : "未知错误"}`; }
    }
    run = await prisma.ktuScheduleRun.update({
      where: { id: run.id },
      data: { ...(finished ? { succeeded: { increment: 1 } } : { failed: { increment: 1 } }), message: note || !finished ? appendMessage(run.message, note || `${current.cityName}·${templateByKey(current.templateKey)?.name ?? ""}未完成：${detail?.error || detail?.stage || "任务已停止"}`) : run.message },
    });
    await prisma.ktuJob.update({ where: { id: current.id }, data: { settledAt: new Date() } });
  }

  const planned = list<JobSpec>(run.planned);
  while (run.nextIndex < planned.length) {
    const spec = planned[run.nextIndex];
    run = await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { nextIndex: { increment: 1 } } });
    try {
      await createKtuJob({ ...spec, scheduleRunId: run.id });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      run = await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { failed: { increment: 1 }, message: appendMessage(run.message, message) } });
      if (QUOTA_ERROR.test(message)) {
        await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { status: "quota", finishedAt: new Date() } });
        return;
      }
      // 没接入时不必一套一套试下去
      if (/PROVIDER_CREDENTIALS_MISSING|API Key|接入/.test(message)) {
        await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date() } });
        return;
      }
    }
  }
  await prisma.ktuScheduleRun.update({
    where: { id: run.id },
    data: { status: run.failed === 0 ? "completed" : run.succeeded > 0 ? "partial" : "failed", finishedAt: new Date() },
  });
}

/** 停止一批：当前那一套也停掉，没开始的不再开始。 */
export async function stopRun(runId: string) {
  const run = await prisma.ktuScheduleRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "running") return run;
  const current = await prisma.ktuJob.findFirst({ where: { scheduleRunId: run.id, settledAt: null } });
  if (current) {
    await stopJob(current.projectId).catch(() => undefined);
    await prisma.ktuJob.update({ where: { id: current.id }, data: { settledAt: new Date() } });
  }
  return prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { status: "stopped", finishedAt: new Date(), notified: true } });
}

export type KtuNotification = { title: string; body: string };

function finishedText(run: { status: string; succeeded: number; failed: number; message: string | null; kind: string }, name: string) {
  const head = run.kind === "manual" ? "批量生成" : `定时任务「${name}」`;
  if (run.status === "quota") return { title: `${head}已停止`, body: "额度不足，请到网站充值后再运行" };
  if (run.status === "skipped") return { title: `${head}本次没有生成`, body: run.message || "" };
  return { title: `${head}完成`, body: `成功 ${run.succeeded} 套${run.failed ? `，${run.failed} 套未完成` : ""}${run.kind === "schedule" ? "，已保存到输出文件夹" : ""}` };
}

/** 推进所有任务；返回需要弹系统通知的完成消息。同一进程里同时只跑一个 tick。 */
export async function tick(now = new Date()): Promise<KtuNotification[]> {
  if (state.ktuTickBusy) return [];
  state.ktuTickBusy = true;
  try {
    if (!(await ensureZhishuProvider())) return [];
    const schedules = await prisma.ktuSchedule.findMany({ where: { enabled: true } });
    for (const schedule of schedules) {
      if (!schedule.nextRunAt) {
        await prisma.ktuSchedule.update({ where: { id: schedule.id }, data: { nextRunAt: nextRunAfter(scheduleTiming(schedule), now) } });
        continue;
      }
      if (schedule.nextRunAt > now) continue;
      // 上一轮还没跑完就跳过这次，下次照常（关机期间错过的时间点只补跑一次）
      if (await prisma.ktuScheduleRun.findFirst({ where: { scheduleId: schedule.id, status: "running" } })) {
        await prisma.ktuSchedule.update({ where: { id: schedule.id }, data: { nextRunAt: nextRunAfter(scheduleTiming(schedule), now) } });
        continue;
      }
      await startScheduleRun(schedule, now);
    }
    for (const run of await prisma.ktuScheduleRun.findMany({ where: { status: "running" }, orderBy: { startedAt: "asc" } })) {
      await advanceRun(run.id).catch(error => console.error("K图批次推进失败:", error instanceof Error ? error.message : error));
    }
    const finished = await prisma.ktuScheduleRun.findMany({ where: { status: { not: "running" }, notified: false }, include: { schedule: true } });
    if (finished.length) await prisma.ktuScheduleRun.updateMany({ where: { id: { in: finished.map(run => run.id) } }, data: { notified: true } });
    return finished.map(run => finishedText(run, run.schedule?.name ?? ""));
  } finally {
    state.ktuTickBusy = false;
  }
}
