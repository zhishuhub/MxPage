// K图：一套宣传图文 = 一个作品（Project）+ 一次图文任务（DetailRun）。这里负责建作品、启动任务和汇总进度。

import { prisma } from "@/lib/db/prisma";
import { createDetailRun, controlDetailRun, getDetailRun } from "@/lib/detail-runs/service";
import { assetPublicUrl } from "@/lib/storage/asset-manager";
import { zhishuCredentials } from "@/lib/zhishu/connection-file";
import { aspectImageSize, builtinTemplate, normalizeAspect, type KtuAspect } from "./catalog";
import { buildJobPlan, type BriefTemplate } from "./brief";
import { checkPost, type ComplianceHit } from "./compliance";
import { createKtuPromptPack } from "./prompts";
import { getKtuSettings } from "./settings";
import { getTemplate } from "./templates";

export const KTU_PLATFORM = "douyin";
export const RUN_ACTIVE = ["PENDING", "RUNNING", "WAITING_INPUT", "WAITING_PROMPTS"];

/** 建作品并启动图文任务。资料不够该模板用时抛出带城市名的提示。template 不传时按 templateKey 从模板库取。 */
export async function createKtuJob(input: { templateKey: string; template?: BriefTemplate; cityId: string; picked?: string[]; aspect?: string; scheduleRunId?: string }) {
  const template = input.template ?? await getTemplate(input.templateKey);
  if (!template) throw new Error("模板不存在，可能已被删除");
  const city = await prisma.ktuCity.findUnique({ where: { id: input.cityId }, include: { venues: true } });
  if (!city) throw new Error("城市不存在，可能已被删除");
  const aspect: KtuAspect = normalizeAspect(input.aspect);
  const plan = buildJobPlan({ template, city, venues: city.venues, picked: input.picked, aspect });
  const promptPack = createKtuPromptPack(plan.brief, { aspect, pageCount: plan.pageCount, review: await getKtuSettings() });

  const project = await prisma.project.create({ data: { name: plan.title, platform: KTU_PLATFORM, style: "generic_clean", description: plan.brief, modelSnapshot: { ktu: { templateKey: plan.templateKey, cityName: city.name, aspect, promptPack } } } });
  try {
    const job = await prisma.ktuJob.create({ data: { projectId: project.id, templateKey: plan.templateKey, templateName: plan.templateName, cityId: city.id, cityName: city.name, venueIds: plan.venueIds, aspect, scheduleRunId: input.scheduleRunId } });
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

/** 改发布标题、正文、话题标签。 */
export async function updatePost(jobId: string, raw: { title?: unknown; caption?: unknown; hashtags?: unknown }) {
  const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: jobId } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: job.projectId }, select: { modelSnapshot: true } });
  const snapshot = (project.modelSnapshot ?? {}) as { socialPost?: Record<string, unknown> };
  const title = String(raw.title ?? "").trim().slice(0, 200);
  const caption = String(raw.caption ?? "").trim().slice(0, 6000);
  if (!title || !caption) throw new Error("标题和正文不能为空");
  const hashtags = (Array.isArray(raw.hashtags) ? raw.hashtags : String(raw.hashtags ?? "").split(/[\s,，#]+/))
    .map(tag => String(tag).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 10);
  await prisma.project.update({ where: { id: job.projectId }, data: { modelSnapshot: { ...snapshot, socialPost: { ...(snapshot.socialPost ?? {}), title, caption, hashtags } } } });
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

const STAGE_LABEL: Record<string, string> = {
  PREPARE: "准备中", PLAN: "写文案", ART_DIRECTION: "设计画面", GENERATE: "画图", IMAGE_REVIEW: "检查图片", REDRAW: "重画没通过的图", SET_REVIEW: "检查整组",
};
function stageLabel(stage: string | undefined) {
  if (!stage) return "";
  return STAGE_LABEL[stage.split(":")[0]] ?? stage;
}

type RunView = NonNullable<Awaited<ReturnType<typeof getDetailRun>>>;
type ReviewView = { passed: boolean; issues: Array<{ message: string; severity: string }> };
type CheckpointView = {
  images?: Array<{ sectionId: string; assetId?: string; state: string; check?: ReviewView }>;
  setReview?: { passed: boolean; issues: Array<{ sectionIndexes: number[]; message: string }> };
};
type ArtView = { prompt?: string; textBlocks?: Array<{ text: string }> };

export type KtuJobRow = { id: string; projectId: string; templateKey: string; templateName: string; cityName: string; aspect: string; createdAt: Date; exportedPath: string | null; scheduleRunId: string | null; excluded: unknown };

export async function summarizeJob(job: KtuJobRow) {
  const excluded = new Set(Array.isArray(job.excluded) ? job.excluded.map(String) : []);
  const [project, run, batch, assets] = await Promise.all([
    prisma.project.findUnique({ where: { id: job.projectId }, include: { sections: { orderBy: { order: "asc" }, include: { currentImageAsset: true } } } }),
    getDetailRun(job.projectId).catch(() => null) as Promise<RunView | null>,
    job.scheduleRunId ? prisma.ktuScheduleRun.findUnique({ where: { id: job.scheduleRunId }, select: { kind: true } }) : null,
    prisma.productAsset.findMany({ where: { projectId: job.projectId, type: "GENERATED" }, orderBy: { createdAt: "asc" } }),
  ]);
  const checkpoint = (run?.checkpoint ?? {}) as CheckpointView;
  const progress = checkpoint.images ?? [];
  const reviewEnabled = (run?.input as { xhsPromptPack?: { ktu?: { review?: { enabled?: boolean } } } } | null)?.xhsPromptPack?.ktu?.review?.enabled !== false;
  const post = (project?.modelSnapshot as { socialPost?: { title: string; caption: string; hashtags: string[] } } | null)?.socialPost ?? null;
  const pages = (project?.sections ?? []).map((section, index) => {
    const image = progress.find(item => item.sectionId === section.id);
    // 检查结论只对检查过的那一版图有效；用户重画或换版本后不再显示
    const check = image?.assetId === section.currentImageAssetId ? image?.check : undefined;
    const setIssues = image?.assetId === section.currentImageAssetId ? (checkpoint.setReview?.issues ?? []).filter(issue => issue.sectionIndexes.includes(index)).map(issue => issue.message) : [];
    const art = ((section.editableData ?? {}) as { artDirection?: ArtView }).artDirection;
    const issues = [...(check?.issues.map(issue => issue.message) ?? []), ...setIssues];
    return {
      sectionId: section.id,
      title: section.title,
      copy: section.copy,
      text: art?.textBlocks?.map(block => block.text).join("\n") ?? section.copy ?? "",
      description: art?.prompt ?? "",
      imageUrl: assetPublicUrl(section.currentImageAsset),
      redrawing: section.status === "GENERATING" && !RUN_ACTIVE.includes(run?.status ?? ""),
      redrawError: ((section.editableData ?? {}) as { ktuRedrawError?: string }).ktuRedrawError ?? "",
      versions: assets.filter(asset => asset.sectionId === section.id).map(asset => ({ assetId: asset.id, imageUrl: assetPublicUrl(asset), current: asset.id === section.currentImageAssetId })),
      needsCheck: Boolean(check && !check.passed) || setIssues.length > 0,
      discarded: excluded.has(section.id),
      issues,
    };
  });
  const compliance: ComplianceHit[] = post ? checkPost(post, pages.filter(page => !page.discarded)) : [];
  return {
    id: job.id,
    projectId: job.projectId,
    templateKey: job.templateKey,
    templateName: job.templateName || builtinTemplate(job.templateKey)?.name || job.templateKey,
    cityName: job.cityName,
    aspect: job.aspect,
    createdAt: job.createdAt,
    exportedPath: job.exportedPath,
    scheduled: batch?.kind === "schedule",
    reviewEnabled,
    state: jobState(run?.status),
    runStatus: run?.status ?? null,
    stage: stageLabel(run?.stage),
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

/** 页面上点「继续生成」：停止或未完成的任务从断点接着跑。 */
export async function resumeJob(projectId: string) {
  const run = await getDetailRun(projectId);
  if (!run || run.status === "COMPLETED" || (RUN_ACTIVE.includes(run.status) && run.status !== "WAITING_INPUT")) return;
  await controlDetailRun(projectId, run.id, run.status === "WAITING_INPUT" ? "answers" : "resume", run.status === "WAITING_INPUT" ? { skip: true } : {}, zhishuCredentials());
}

export async function stopJob(projectId: string) {
  const run = await getDetailRun(projectId);
  if (run && RUN_ACTIVE.includes(run.status)) await controlDetailRun(projectId, run.id, "cancel", {}, zhishuCredentials());
}
