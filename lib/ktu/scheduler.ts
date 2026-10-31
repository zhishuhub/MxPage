// K图：批量生成与定时任务。
// 一批（KtuScheduleRun）里排好若干套「模板 × 城市」，按设置同时跑几套（网站忙时自动少开），跑完一套补一套；
// 定时任务和开了「生成完自动导出」的手动批量，每套跑完自动导出。
// 推进靠 tick：桌面壳每 30 秒调一次，页面打开时也会调；所有状态都在数据库里，关掉应用再打开接着跑。
// 推进、开始、停止都在同一把锁里排队执行，不会同时给同一批开出两套一样的。

import { ensureSqliteWal, prisma } from "@/lib/db/prisma";
import { getDetailRun } from "@/lib/detail-runs/service";
import { ensureZhishuProvider } from "@/lib/zhishu/connection";
import { normalizeAspect, tierOrder } from "./catalog";
import { selectVenues, selectionIssue, type BriefTemplate } from "./brief";
import { listTemplates } from "./templates";
import { createKtuJob, nudgeJob, stopJob } from "./jobs";
import { exportJob } from "./export";
import { getKtuSettings } from "./settings";
import { effectiveConcurrency } from "./throttle";
import { nextRunAfter, startOfLocalDay, type ScheduleTiming } from "./schedule-time";

export type JobSpec = { templateKey: string; cityId: string; cityName: string; picked?: string[]; aspect: string };
type Cursor = { city: number; template: number };

const RUN_ACTIVE = ["PENDING", "RUNNING", "WAITING_INPUT", "WAITING_PROMPTS", "INTERRUPTED"];
const QUOTA_ERROR = /app_quota_exhausted|insufficient_quota|quota|额度|余额不足|402/i;

const lock = globalThis as typeof globalThis & { ktuTickChain?: Promise<unknown>; ktuTickPending?: number };

/** 排队独占执行：推进、开始一批、停止一批互不打架。 */
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  lock.ktuTickPending = (lock.ktuTickPending ?? 0) + 1;
  const next = (lock.ktuTickChain ?? Promise.resolve()).then(work).finally(() => { lock.ktuTickPending = (lock.ktuTickPending ?? 1) - 1; });
  lock.ktuTickChain = next.catch(() => undefined);
  return next;
}

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
  templates: BriefTemplate[],
  count: number,
  cursor: Cursor,
  aspect: string,
): { specs: JobSpec[]; cursor: Cursor } {
  const next = { city: cursor.city || 0, template: cursor.template || 0 };
  const specs: JobSpec[] = [];
  if (!cities.length || !templates.length) return { specs, cursor: next };
  const maxSteps = cities.length * templates.length;
  // 连续一整圈都没有可用组合时停止，避免空转
  for (let misses = 0; specs.length < count && misses < maxSteps;) {
    const city = cities[next.city % cities.length];
    const template = templates[next.template % templates.length];
    next.city++;
    if (next.city % cities.length === 0) next.template++;
    if (selectionIssue(template, selectVenues(template, city.venues))) misses++;
    else { specs.push({ templateKey: template.key, cityId: city.id, cityName: city.name, aspect }); misses = 0; }
  }
  return { specs, cursor: { city: next.city % cities.length, template: next.template % templates.length } };
}

/** 模板库里按给定顺序取出这些模板，已删除的跳过。 */
async function templatesByKeys(keys: string[]) {
  const all = await listTemplates();
  return keys.map(key => all.find(template => template.key === key)).filter((template): template is NonNullable<typeof template> => Boolean(template));
}

/** 选中的城市 × 模板排成单子；资料不够的列进 skipped。 */
export async function planManualBatch(input: { cityIds: string[]; tiers: string[]; templateKeys: string[]; picked?: string[]; aspect?: string }) {
  const templates = await templatesByKeys(input.templateKeys);
  if (!templates.length) throw new Error("请至少选择一个模板");
  const cities = await citiesInScope(input.cityIds.length ? "cities" : "tiers", input.cityIds, input.tiers);
  if (!cities.length) throw new Error("所选范围内没有城市");
  const aspect = normalizeAspect(input.aspect);
  const specs: JobSpec[] = [];
  const skipped: string[] = [];
  for (const city of cities) for (const template of templates) {
    const picked = cities.length === 1 ? input.picked : undefined;
    const issue = selectionIssue(template, selectVenues(template, city.venues, picked));
    if (issue) skipped.push(`${city.name}：${issue}`);
    else specs.push({ templateKey: template.key, cityId: city.id, cityName: city.name, picked, aspect });
  }
  return { specs, skipped, templates, cities };
}

/** 手动批量：选中的城市 × 模板全部排进一批，马上开出第一轮。返回已开出的作品编号。 */
export function startManualBatch(input: { cityIds: string[]; tiers: string[]; templateKeys: string[]; picked?: string[]; aspect?: string }) {
  return exclusive(async () => {
    const { specs, skipped } = await planManualBatch(input);
    if (!specs.length) throw new Error(skipped[0] || "资料不够生成所选模板");
    const run = await prisma.ktuScheduleRun.create({ data: { kind: "manual", planned: specs, message: skipped.length ? `跳过：${skipped.join("；")}` : null } });
    await ensureSqliteWal();
    await advanceAll();
    const jobs = await prisma.ktuJob.findMany({ where: { scheduleRunId: run.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    return { run, skipped, jobIds: jobs.map(job => job.id) };
  });
}

export function runScheduleNow(scheduleId: string) {
  return exclusive(async () => {
    const schedule = await prisma.ktuSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
    if (await prisma.ktuScheduleRun.findFirst({ where: { scheduleId, status: "running" } })) throw new Error("这个任务正在运行，等这一轮跑完再试");
    const run = await startScheduleRun(schedule, new Date());
    await advanceAll();
    return run;
  });
}

async function startScheduleRun(schedule: Awaited<ReturnType<typeof prisma.ktuSchedule.findUniqueOrThrow>>, now: Date) {
  const doneToday = schedule.dailyLimit > 0 ? await prisma.ktuJob.count({ where: { scheduleRun: { scheduleId: schedule.id }, createdAt: { gte: startOfLocalDay(now) } } }) : 0;
  const allowance = schedule.dailyLimit > 0 ? Math.max(0, schedule.dailyLimit - doneToday) : schedule.setsPerRun;
  const cities = await citiesInScope(schedule.scope, list(schedule.cityIds), list(schedule.tiers));
  const { specs, cursor } = planRotation(cities, await templatesByKeys(list(schedule.templateKeys)), Math.min(schedule.setsPerRun, allowance), (schedule.cursor ?? {}) as Cursor, schedule.aspect);
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

/** 一批里已经开出去的几套：跑完的结算（需要时自动导出），中断的接着跑。额度不足时整批停下。 */
async function settleRun(runId: string, autoExport: boolean) {
  let run = await prisma.ktuScheduleRun.findUniqueOrThrow({ where: { id: runId } });
  const jobs = await prisma.ktuJob.findMany({ where: { scheduleRunId: run.id, settledAt: null }, orderBy: { createdAt: "asc" } });
  for (const job of jobs) {
    const detail = await getDetailRun(job.projectId).catch(() => null);
    // 中断的接着跑、要补问的按现有资料继续；接不上就按未完成结算
    if (detail && ["INTERRUPTED", "WAITING_INPUT"].includes(detail.status)) {
      if (await nudgeJob(job.projectId)) continue;
    } else if (detail && RUN_ACTIVE.includes(detail.status)) {
      continue;
    }
    const finished = detail && ["COMPLETED", "PARTIAL"].includes(detail.status);
    if (!finished && QUOTA_ERROR.test(detail?.error || "")) {
      await prisma.ktuJob.update({ where: { id: job.id }, data: { settledAt: new Date() } });
      await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { status: "quota", failed: { increment: 1 }, finishedAt: new Date(), message: appendMessage(run.message, "额度不足，已停止，请到网站充值") } });
      await stopUnsettled(run.id);
      return;
    }
    let note = "";
    if (finished && (run.kind === "schedule" || autoExport)) {
      try { await exportJob(job.id, run.outputDir || undefined); } catch (error) { note = `${job.cityName}导出失败：${error instanceof Error ? error.message : "未知错误"}`; }
    }
    run = await prisma.ktuScheduleRun.update({
      where: { id: run.id },
      data: { ...(finished ? { succeeded: { increment: 1 } } : { failed: { increment: 1 } }), message: note || !finished ? appendMessage(run.message, note || `${job.cityName}·${job.templateName}未完成：${detail?.error || detail?.stage || "任务已停止"}`) : run.message },
    });
    await prisma.ktuJob.update({ where: { id: job.id }, data: { settledAt: new Date() } });
  }
}

/** 停掉一批里还在跑的几套，按已结算处理。 */
async function stopUnsettled(runId: string) {
  for (const job of await prisma.ktuJob.findMany({ where: { scheduleRunId: runId, settledAt: null } })) {
    await stopJob(job.projectId).catch(() => undefined);
    await prisma.ktuJob.update({ where: { id: job.id }, data: { settledAt: new Date() } });
  }
}

/** 正在生成的套数（图文任务还在跑或排队）。 */
async function activeJobCount() {
  return prisma.detailRun.count({ where: { status: { in: ["PENDING", "RUNNING"] } } });
}

/** 按同时生成的上限给各批补开新的一套；一批排完、开出去的也都结算了就收尾。 */
async function fillRuns(limit: number) {
  let active = await activeJobCount();
  for (const runRow of await prisma.ktuScheduleRun.findMany({ where: { status: "running" }, orderBy: { startedAt: "asc" } })) {
    let run = runRow;
    const planned = list<JobSpec>(run.planned);
    let stopped = false;
    while (!stopped && active < limit && run.nextIndex < planned.length) {
      const spec = planned[run.nextIndex];
      run = await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { nextIndex: { increment: 1 } } });
      try {
        await createKtuJob({ ...spec, scheduleRunId: run.id });
        active++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        run = await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { failed: { increment: 1 }, message: appendMessage(run.message, message) } });
        if (QUOTA_ERROR.test(message)) {
          await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { status: "quota", finishedAt: new Date() } });
          await stopUnsettled(run.id);
          stopped = true;
        } else if (/PROVIDER_CREDENTIALS_MISSING|API Key|接入/.test(message)) {
          // 没接入时不必一套一套试下去
          await prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date() } });
          await stopUnsettled(run.id);
          stopped = true;
        }
      }
    }
    if (stopped || run.nextIndex < planned.length) continue;
    if (await prisma.ktuJob.count({ where: { scheduleRunId: run.id, settledAt: null } })) continue;
    await prisma.ktuScheduleRun.update({
      where: { id: run.id },
      data: { status: run.failed === 0 ? "completed" : run.succeeded > 0 ? "partial" : "failed", finishedAt: new Date() },
    });
  }
}

/** 推进所有在跑的批次：先结算，再按上限补开。 */
async function advanceAll() {
  const settings = await getKtuSettings();
  for (const run of await prisma.ktuScheduleRun.findMany({ where: { status: "running" }, orderBy: { startedAt: "asc" } })) {
    await settleRun(run.id, settings.autoExport).catch(error => console.error("K图批次结算失败:", error instanceof Error ? error.message : error));
  }
  await fillRuns(effectiveConcurrency(settings.concurrency));
}

/** 停止一批：在跑的几套都停掉，没开始的不再开始。 */
export function stopRun(runId: string) {
  return exclusive(async () => {
    const run = await prisma.ktuScheduleRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status !== "running") return run;
    await stopUnsettled(run.id);
    return prisma.ktuScheduleRun.update({ where: { id: run.id }, data: { status: "stopped", finishedAt: new Date(), notified: true } });
  });
}

/** 一批里还没开始的几套（城市 · 模板），给生成记录显示「排队中」。 */
export async function queuedSpecs(run: { planned: unknown; nextIndex: number }) {
  const rest = list<JobSpec>(run.planned).slice(run.nextIndex);
  if (!rest.length) return [];
  const names = new Map((await listTemplates()).map(template => [template.key, template.name]));
  return rest.map(spec => ({ cityName: spec.cityName, templateName: names.get(spec.templateKey) ?? "已删除的模板" }));
}

export type KtuNotification = { title: string; body: string; href: string };

function finishedText(run: { status: string; succeeded: number; failed: number; message: string | null; kind: string }, name: string, autoExport: boolean): KtuNotification {
  const manual = run.kind === "manual";
  const head = manual ? "批量生成" : `定时任务「${name}」`;
  const href = manual ? "/ktu/works" : "/ktu/schedules";
  if (run.status === "quota") return { title: `${head}已停止`, body: "额度不足，请到网站充值后再运行", href };
  if (run.status === "skipped") return { title: `${head}本次没有生成`, body: run.message || "", href };
  return { title: `${head}完成`, body: `成功 ${run.succeeded} 套${run.failed ? `，${run.failed} 套未完成` : ""}${!manual || autoExport ? "，已保存到输出文件夹" : ""}`, href };
}

/** 有没有正在跑的批次；桌面壳据此决定多久推进一次（在跑 5 秒，空闲 30 秒）。 */
export async function hasRunningBatches() {
  return (await prisma.ktuScheduleRun.count({ where: { status: "running" } })) > 0;
}

/** 推进所有任务；返回需要弹系统通知的完成消息。已有推进在排队时直接跳过。 */
export function tick(now = new Date()): Promise<KtuNotification[]> {
  if (lock.ktuTickPending) return Promise.resolve([]);
  return exclusive(async () => {
    await ensureSqliteWal();
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
    await advanceAll();
    const finished = await prisma.ktuScheduleRun.findMany({ where: { status: { not: "running" }, notified: false }, include: { schedule: true } });
    if (finished.length) await prisma.ktuScheduleRun.updateMany({ where: { id: { in: finished.map(run => run.id) } }, data: { notified: true } });
    const { autoExport } = await getKtuSettings();
    return finished.map(run => finishedText(run, run.schedule?.name ?? "", autoExport));
  });
}
