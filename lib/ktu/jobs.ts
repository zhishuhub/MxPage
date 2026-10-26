// K图：一套宣传图文 = 一个作品（Project）+ 一次图文任务（DetailRun）。这里负责建作品、启动任务和汇总进度。

import { prisma } from "@/lib/db/prisma";
import { createDetailRun, controlDetailRun, getDetailRun } from "@/lib/detail-runs/service";
import { assetPublicUrl } from "@/lib/storage/asset-manager";
import { zhishuCredentials } from "@/lib/zhishu/connection-file";
import { aspectImageSize, isTemplateKey, normalizeAspect, templateByKey, type KtuAspect } from "./catalog";
import { buildJobPlan } from "./brief";
import { checkPost, type ComplianceHit } from "./compliance";

export const KTU_PLATFORM = "douyin";
const RUN_ACTIVE = ["PENDING", "RUNNING", "WAITING_INPUT", "WAITING_PROMPTS"];

/** 建作品并启动图文任务。资料不够该模板用时抛出带城市名的提示。 */
export async function createKtuJob(input: { templateKey: string; cityId: string; picked?: string[]; aspect?: string; scheduleRunId?: string }) {
  if (!isTemplateKey(input.templateKey)) throw new Error("未知的宣传模板");
  const city = await prisma.ktuCity.findUnique({ where: { id: input.cityId }, include: { venues: true } });
  if (!city) throw new Error("城市不存在，可能已被删除");
  const aspect: KtuAspect = normalizeAspect(input.aspect);
  const plan = buildJobPlan({ templateKey: input.templateKey, city, venues: city.venues, picked: input.picked, aspect });

  const project = await prisma.project.create({ data: { name: plan.title, platform: KTU_PLATFORM, style: "generic_clean", description: plan.brief, modelSnapshot: { ktu: { templateKey: plan.templateKey, cityName: city.name, aspect } } } });
  try {
    const job = await prisma.ktuJob.create({ data: { projectId: project.id, templateKey: plan.templateKey, cityId: city.id, cityName: city.name, venueIds: plan.venueIds, aspect, scheduleRunId: input.scheduleRunId } });
    await prisma.ktuVenue.updateMany({ where: { id: { in: plan.venueIds } }, data: { lastUsedAt: new Date() } });
    await createDetailRun(project.id, {
      idempotencyKey: `ktu:${job.id}`,
      mode: "xhs",
      heroCount: 0,
      detailCount: plan.pageCount,
      imageSettings: { size: aspectImageSize(aspect) },
      instruction: "",
    }, zhishuCredentials());
    return job;
  } catch (error) {
    // 任务没启动起来就不留空作品；已经启动的任务失败由任务本身记录。
    const started = await prisma.detailRun.count({ where: { projectId: project.id } });
    if (!started) await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    throw error;
  }
}

/** 丢弃 / 恢复某一张图；丢弃的图不导出。 */
export async function setPageDiscarded(jobId: string, sectionId: string, discarded: boolean) {
  const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: jobId } });
  const current = new Set(Array.isArray(job.excluded) ? job.excluded.map(String) : []);
  if (discarded) current.add(sectionId); else current.delete(sectionId);
  return prisma.ktuJob.update({ where: { id: jobId }, data: { excluded: [...current] } });
}

export type KtuJobState = "running" | "waiting" | "done" | "partial" | "failed" | "stopped";

function jobState(status: string | undefined): KtuJobState {
  if (!status) return "failed";
  if (status === "WAITING_INPUT") return "waiting";
  if (RUN_ACTIVE.includes(status)) return "running";
  if (status === "COMPLETED") return "done";
  if (status === "PARTIAL") return "partial";
  if (status === "CANCELED" || status === "INTERRUPTED") return "stopped";
  return "failed";
}

type RunView = NonNullable<Awaited<ReturnType<typeof getDetailRun>>>;
type CheckpointView = { images?: Array<{ sectionId: string; assetId?: string; state: string; check?: { passed: boolean; issues: Array<{ message: string; severity: string }> } }> };

export type KtuJobRow = { id: string; projectId: string; templateKey: string; cityName: string; aspect: string; createdAt: Date; exportedPath: string | null; scheduleRunId: string | null; excluded: unknown };

export async function summarizeJob(job: KtuJobRow) {
  const excluded = new Set(Array.isArray(job.excluded) ? job.excluded.map(String) : []);
  const [project, run, batch] = await Promise.all([
    prisma.project.findUnique({ where: { id: job.projectId }, include: { sections: { orderBy: { order: "asc" }, include: { currentImageAsset: true } } } }),
    getDetailRun(job.projectId).catch(() => null) as Promise<RunView | null>,
    job.scheduleRunId ? prisma.ktuScheduleRun.findUnique({ where: { id: job.scheduleRunId }, select: { kind: true } }) : null,
  ]);
  const checkpoint = (run?.checkpoint ?? {}) as CheckpointView;
  const progress = checkpoint.images ?? [];
  const post = (project?.modelSnapshot as { socialPost?: { title: string; caption: string; hashtags: string[] } } | null)?.socialPost ?? null;
  const pages = (project?.sections ?? []).map(section => {
    const check = progress.find(image => image.sectionId === section.id)?.check;
    return {
      sectionId: section.id,
      title: section.title,
      copy: section.copy,
      imageUrl: assetPublicUrl(section.currentImageAsset),
      needsCheck: Boolean(check && !check.passed),
      discarded: excluded.has(section.id),
      issues: check?.issues.map(issue => issue.message) ?? [],
    };
  });
  const compliance: ComplianceHit[] = post ? checkPost(post, pages.filter(page => !page.discarded)) : [];
  return {
    id: job.id,
    projectId: job.projectId,
    templateKey: job.templateKey,
    templateName: templateByKey(job.templateKey)?.name ?? job.templateKey,
    cityName: job.cityName,
    aspect: job.aspect,
    createdAt: job.createdAt,
    exportedPath: job.exportedPath,
    scheduled: batch?.kind === "schedule",
    state: jobState(run?.status),
    runStatus: run?.status ?? null,
    stage: run?.stage ?? "",
    error: run?.error ?? null,
    generated: progress.filter(image => image.assetId).length,
    total: progress.length || pages.length,
    pages,
    post,
    compliance,
  };
}

/** 运行中断（关了应用）的任务接着跑；自动化遇到补问时按现有资料继续。接上了返回 true。 */
export async function nudgeJob(projectId: string) {
  const run = await getDetailRun(projectId).catch(() => null);
  if (!run) return false;
  const action = run.status === "INTERRUPTED" ? "resume" : run.status === "WAITING_INPUT" ? "answers" : null;
  if (!action) return false;
  try {
    await controlDetailRun(projectId, run.id, action, action === "answers" ? { skip: true } : {}, zhishuCredentials());
    return true;
  } catch {
    return false;
  }
}

/** 页面上点「继续生成」：停止或未完成的任务从断点接着跑（结果不确定的图需到工作台确认后重试，避免重复扣费）。 */
export async function resumeJob(projectId: string) {
  const run = await getDetailRun(projectId);
  if (!run || run.status === "COMPLETED" || (RUN_ACTIVE.includes(run.status) && run.status !== "WAITING_INPUT")) return;
  await controlDetailRun(projectId, run.id, run.status === "WAITING_INPUT" ? "answers" : "resume", run.status === "WAITING_INPUT" ? { skip: true } : {}, zhishuCredentials());
}

export async function stopJob(projectId: string) {
  const run = await getDetailRun(projectId);
  if (run && RUN_ACTIVE.includes(run.status)) await controlDetailRun(projectId, run.id, "cancel", {}, zhishuCredentials());
}
