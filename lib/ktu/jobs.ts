// K图：一套宣传图文 = 一个作品（Project）+ 一次图文任务（DetailRun）。这里负责建作品、启动任务、汇总进度，
// 以及生成记录的筛选翻页、批量删除 / 导出 / 重试和违规词一键改写。

import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { textSettings } from "@/lib/ai/text-protocol";
import { createDetailRun, controlDetailRun, getDetailRun } from "@/lib/detail-runs/service";
import { invokeStructured } from "@/lib/detail-runs/structured-model";
import { getProviderAdapter, type ProviderSnapshot } from "@/lib/services/provider-service";
import { assetPublicUrl, removeProjectFiles } from "@/lib/storage/asset-manager";
import { ZHISHU_CHAT_MODEL, zhishuCredentials } from "@/lib/zhishu/connection-file";
import { aspectImageSize, builtinTemplate, KTU_IMAGE_QUALITY, normalizeAspect, type KtuAspect } from "./catalog";
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
      quality: KTU_IMAGE_QUALITY,
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

type SocialPost = { title: string; caption: string; hashtags: string[] };

function cleanPost(raw: { title?: unknown; caption?: unknown; hashtags?: unknown }): SocialPost {
  const title = String(raw.title ?? "").trim().slice(0, 200);
  const caption = String(raw.caption ?? "").trim().slice(0, 6000);
  if (!title || !caption) throw new Error("标题和正文不能为空");
  const hashtags = (Array.isArray(raw.hashtags) ? raw.hashtags : String(raw.hashtags ?? "").split(/[\s,，#]+/))
    .map(tag => String(tag).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 10);
  return { title, caption, hashtags };
}

async function savePost(projectId: string, post: SocialPost) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { modelSnapshot: true } });
  const snapshot = (project.modelSnapshot ?? {}) as { socialPost?: Record<string, unknown> };
  await prisma.project.update({ where: { id: projectId }, data: { modelSnapshot: { ...snapshot, socialPost: { ...(snapshot.socialPost ?? {}), ...post } } } });
}

/** 改发布标题、正文、话题标签。 */
export async function updatePost(jobId: string, raw: { title?: unknown; caption?: unknown; hashtags?: unknown }) {
  const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: jobId } });
  await savePost(job.projectId, cleanPost(raw));
}

const fixedPostSchema = z.object({ title: z.string().min(1).max(200), caption: z.string().min(1).max(6000), hashtags: z.array(z.string()).max(10) });
const FIX_POST_SYSTEM = `你是抖音文案编辑。只返回 JSON：title、caption、hashtags。
只改 problems 里列出的词所在的句子：把这些词换成合规的说法或删掉，其余文字原样保留，不加新内容，不改店名。
- 陪侍暗示：换成描述环境、氛围、音响、聚会体验的说法，不留任何陪侍、有偿陪伴的暗示。
- 绝对化用语：换成「热门」「口碑不错」「值得一去」这类不绝对的说法；排名里的「第一名」写成「TOP1」。
- 站外导流：删掉联系方式和引导加好友的说法。
hashtags 不带 #。`;

/** 发布文案里的违规词让 AI 只改那几处；图上的字要用改字重画。返回改完还剩几处。 */
export async function fixPostWording(jobId: string) {
  const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: jobId } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: job.projectId }, select: { modelSnapshot: true } });
  const post = (project.modelSnapshot as { socialPost?: SocialPost } | null)?.socialPost;
  if (!post) throw new Error("这套图文还没有发布文案");
  const hits = checkPost(post, []);
  if (!hits.length) return { remaining: 0 };
  const run = await getDetailRun(job.projectId);
  const input = (run?.input ?? {}) as { providerSnapshot?: ProviderSnapshot; planningModelId?: string };
  const { provider, apiKey } = await getProviderAdapter(input.providerSnapshot?.id, input.providerSnapshot);
  const call = () => invokeStructured({
    ...textSettings(input.providerSnapshot || {}), apiKey, baseUrl: provider.baseUrl, model: input.planningModelId || ZHISHU_CHAT_MODEL, schema: fixedPostSchema,
    system: FIX_POST_SYSTEM, input: JSON.stringify({ post, problems: hits.map(hit => ({ where: hit.where, word: hit.word, category: hit.category })) }),
    timeoutMs: 90000, monitor: { projectId: job.projectId, operation: "ktu_fix_post" },
  });
  const fixed = await call().catch(() => call());
  const next = cleanPost(fixed);
  await savePost(job.projectId, next);
  return { remaining: checkPost(next, []).length };
}

export type KtuJobState = "running" | "done" | "incomplete" | "failed" | "stopped";

/** 图都画出来就算完成；没画全的分「没画完」（有几张）和「没完成」（一张都没有）。 */
function jobState(status: string | undefined, drawn: number, total: number): KtuJobState {
  if (!status) return "failed";
  if (RUN_ACTIVE.includes(status)) return "running";
  if (total > 0 && drawn >= total) return "done";
  if (status === "CANCELED" || status === "INTERRUPTED") return "stopped";
  return drawn > 0 ? "incomplete" : "failed";
}

const STAGE_LABEL: Record<string, string> = {
  PREPARE: "准备中", COMPOSE: "写文案、设计画面", PLAN: "写文案", ART_DIRECTION: "设计画面", GENERATE: "画图", IMAGE_REVIEW: "检查图片", REDRAW: "重画没通过的图", SET_REVIEW: "检查整组",
};
function stageLabel(stage: string | undefined, generated: number, total: number) {
  if (!stage) return "";
  const key = stage.split(":")[0];
  if (key === "GENERATE") return `画图 ${generated}/${total}`;
  return STAGE_LABEL[key] ?? (/[一-鿿]/.test(stage) ? stage : "处理中");
}

const QUOTA_ERROR = /app_quota_exhausted|insufficient_quota|quota|额度|余额不足|402/i;

/** 没完成的原因换成大白话，告诉用户下一步点什么。 */
function plainError(raw: string, state: KtuJobState) {
  if (state === "running" || state === "done") return null;
  if (QUOTA_ERROR.test(raw)) return "额度不足，请到网站充值后点「继续生成」";
  if (/鉴权|unauthorized|API Key|接入已失效/i.test(raw)) return "接入已失效，请到设置里重新接入后点「继续生成」";
  if (/content_policy|moderation|safety|违规|敏感|拒绝生成/i.test(raw)) return "有图被网站判为内容不合规没画出来，可以对那张图点「改字重画」换个说法";
  if (/超时|timeout|timed out|\b504\b/i.test(raw)) return "网站响应超时，已自动重试仍没成功，可以点「继续生成」再试";
  if (/繁忙|\b429\b|rate limit|\b50[023]\b|暂时不可用/i.test(raw)) return "网站正忙，可以稍后点「继续生成」再试";
  if (/连接|网络|network|fetch failed/i.test(raw)) return "网络连接中断，可以点「继续生成」再试";
  if (state === "stopped") return null;
  return "这套图没做完，可以点「继续生成」再试";
}

type RunView = NonNullable<Awaited<ReturnType<typeof getDetailRun>>>;
type ReviewView = { passed: boolean; issues: Array<{ message: string; severity: string }> };
type CheckpointView = {
  images?: Array<{ sectionId: string; assetId?: string; state: string; check?: ReviewView }>;
  setReview?: { passed: boolean; issues: Array<{ sectionIndexes: number[]; message: string }> };
  lastError?: { message?: string };
};
type ArtView = { prompt?: string; textBlocks?: Array<{ text: string }> };

export type KtuJobRow = { id: string; projectId: string; templateKey: string; templateName: string; cityName: string; aspect: string; createdAt: Date; exportedPath: string | null; scheduleRunId: string | null; excluded: unknown };

/** 一套图文的进度、图片、文案和检查结果。lite 时不带每张图的历史版本（生成记录列表用）。 */
export async function summarizeJob(job: KtuJobRow, options: { lite?: boolean } = {}) {
  const excluded = new Set(Array.isArray(job.excluded) ? job.excluded.map(String) : []);
  const [project, run, batch, assets] = await Promise.all([
    prisma.project.findUnique({ where: { id: job.projectId }, include: { sections: { orderBy: { order: "asc" }, include: { currentImageAsset: true } } } }),
    getDetailRun(job.projectId).catch(() => null) as Promise<RunView | null>,
    job.scheduleRunId ? prisma.ktuScheduleRun.findUnique({ where: { id: job.scheduleRunId }, select: { kind: true } }) : null,
    options.lite ? Promise.resolve([]) : prisma.productAsset.findMany({ where: { projectId: job.projectId, type: "GENERATED" }, orderBy: { createdAt: "asc" } }),
  ]);
  const checkpoint = (run?.checkpoint ?? {}) as CheckpointView;
  const progress = checkpoint.images ?? [];
  const running = RUN_ACTIVE.includes(run?.status ?? "");
  const reviewEnabled = (run?.input as { xhsPromptPack?: { ktu?: { review?: { enabled?: boolean } } } } | null)?.xhsPromptPack?.ktu?.review?.enabled !== false;
  const post = (project?.modelSnapshot as { socialPost?: SocialPost } | null)?.socialPost ?? null;
  const pages = (project?.sections ?? []).map((section, index) => {
    const image = progress.find(item => item.sectionId === section.id);
    // 检查结论只对检查过的那一版图有效；用户重画或换版本后不再显示
    const sameVersion = Boolean(image?.assetId) && image?.assetId === section.currentImageAssetId;
    const check = sameVersion ? image?.check : undefined;
    const setIssues = sameVersion ? (checkpoint.setReview?.issues ?? []).filter(issue => issue.sectionIndexes.includes(index)).map(issue => issue.message) : [];
    const art = ((section.editableData ?? {}) as { artDirection?: ArtView }).artDirection;
    const issues = [...(check?.issues.map(issue => issue.message) ?? []), ...setIssues];
    return {
      sectionId: section.id,
      title: section.title,
      copy: section.copy,
      text: art?.textBlocks?.map(block => block.text).join("\n") ?? section.copy ?? "",
      description: art?.prompt ?? "",
      imageUrl: assetPublicUrl(section.currentImageAsset),
      redrawing: section.status === "GENERATING" && !running,
      redrawError: ((section.editableData ?? {}) as { ktuRedrawError?: string }).ktuRedrawError ?? "",
      versions: assets.filter(asset => asset.sectionId === section.id).map(asset => ({ assetId: asset.id, imageUrl: assetPublicUrl(asset), current: asset.id === section.currentImageAssetId })),
      needsCheck: Boolean(check && !check.passed) || setIssues.length > 0,
      unchecked: reviewEnabled && !running && sameVersion && !check,
      discarded: excluded.has(section.id),
      issues,
    };
  });
  const compliance: ComplianceHit[] = post ? checkPost(post, pages.filter(page => !page.discarded)) : [];
  const generated = progress.filter(image => image.assetId).length;
  const total = progress.length || pages.length;
  const drawn = pages.filter(page => page.imageUrl).length;
  const state = jobState(run?.status, drawn, pages.length);
  const updatedAt = (run as { updatedAt?: Date } | null)?.updatedAt;
  return {
    id: job.id,
    projectId: job.projectId,
    templateKey: job.templateKey,
    templateName: job.templateName || builtinTemplate(job.templateKey)?.name || job.templateKey,
    cityName: job.cityName,
    aspect: job.aspect,
    createdAt: job.createdAt,
    finishedAt: running ? null : updatedAt ?? null,
    exportedPath: job.exportedPath,
    scheduled: batch?.kind === "schedule",
    reviewEnabled,
    state,
    runStatus: run?.status ?? null,
    stage: running ? stageLabel(run?.stage, generated, total) : "",
    error: plainError(`${run?.error ?? ""} ${checkpoint.lastError?.message ?? ""}`.trim(), state),
    generated,
    total,
    missing: state === "running" ? 0 : pages.filter(page => !page.imageUrl).length,
    needsCheck: pages.filter(page => page.needsCheck && !page.discarded).length,
    pages,
    post,
    compliance,
  };
}

export type KtuJobFilter = "all" | "running" | "done" | "attention";

/** 只按任务状态和画出几张判断，不读图片明细；筛选生成记录用。 */
async function lightStates(jobs: Array<{ id: string; projectId: string }>) {
  const projectIds = jobs.map(job => job.projectId);
  const [runs, totals, drawn] = await Promise.all([
    prisma.detailRun.findMany({ where: { projectId: { in: projectIds } }, orderBy: { createdAt: "desc" }, select: { projectId: true, status: true } }),
    prisma.pageSection.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds } }, _count: { _all: true } }),
    prisma.pageSection.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, currentImageAssetId: { not: null } }, _count: { _all: true } }),
  ]);
  const status = new Map<string, string>();
  for (const run of runs) if (!status.has(run.projectId)) status.set(run.projectId, run.status);
  const count = (rows: typeof totals, projectId: string) => rows.find(row => row.projectId === projectId)?._count._all ?? 0;
  return new Map(jobs.map(job => [job.id, jobState(status.get(job.projectId), count(drawn, job.projectId), count(totals, job.projectId))]));
}

function matchesFilter(state: KtuJobState, filter: KtuJobFilter) {
  if (filter === "running") return state === "running";
  if (filter === "done") return state === "done";
  if (filter === "attention") return state === "incomplete" || state === "failed" || state === "stopped";
  return true;
}

/** before 是上一页最后一条的「创建时间|编号」。 */
function beforeCursor(before: string | null | undefined) {
  if (!before) return {};
  const [time, id] = before.split("|");
  const createdAt = new Date(time);
  if (Number.isNaN(createdAt.getTime())) return {};
  return { OR: [{ createdAt: { lt: createdAt } }, ...(id ? [{ createdAt, id: { lt: id } }] : [])] };
}

/** 生成记录：按创建时间倒序，可按状态筛选、翻页；ids 只取这几套（刷新进度用）。 */
export async function listJobs(options: { limit: number; before?: string | null; filter?: KtuJobFilter; ids?: string[]; runId?: string | null; lite?: boolean }) {
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  if (options.ids) {
    const jobs = await prisma.ktuJob.findMany({ where: { id: { in: options.ids } }, orderBy });
    return Promise.all(jobs.map(job => summarizeJob(job, { lite: options.lite })));
  }
  const base = { ...(options.runId ? { scheduleRunId: options.runId } : {}) };
  const filter = options.filter ?? "all";
  if (filter === "all") {
    const jobs = await prisma.ktuJob.findMany({ where: { ...base, ...beforeCursor(options.before) }, orderBy, take: options.limit });
    return Promise.all(jobs.map(job => summarizeJob(job, { lite: options.lite })));
  }
  const picked: Awaited<ReturnType<typeof prisma.ktuJob.findMany>> = [];
  let cursor = options.before ?? null;
  for (let rounds = 0; picked.length < options.limit && rounds < 40; rounds++) {
    const batch = await prisma.ktuJob.findMany({ where: { ...base, ...beforeCursor(cursor) }, orderBy, take: 60 });
    if (!batch.length) break;
    const states = await lightStates(batch);
    for (const job of batch) if (picked.length < options.limit && matchesFilter(states.get(job.id)!, filter)) picked.push(job);
    const last = batch[batch.length - 1];
    cursor = `${last.createdAt.toISOString()}|${last.id}`;
    if (batch.length < 60) break;
  }
  return Promise.all(picked.map(job => summarizeJob(job, { lite: options.lite })));
}

/** 详情页的「上一套 / 下一套」：按生成记录的顺序，上一套更新、下一套更早。 */
export async function jobNeighbors(job: { id: string; createdAt: Date }) {
  const [newer, older] = await Promise.all([
    prisma.ktuJob.findFirst({ where: { OR: [{ createdAt: { gt: job.createdAt } }, { createdAt: job.createdAt, id: { gt: job.id } }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } }),
    prisma.ktuJob.findFirst({ where: { OR: [{ createdAt: { lt: job.createdAt } }, { createdAt: job.createdAt, id: { lt: job.id } }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }),
  ]);
  return { newerId: newer?.id ?? null, olderId: older?.id ?? null };
}

/** 删除几套图文：还在生成的先停下，连同作品记录和应用里存的图片文件一起删。 */
export async function deleteJobs(ids: string[]) {
  let deleted = 0;
  for (const job of await prisma.ktuJob.findMany({ where: { id: { in: ids } } })) {
    await stopJob(job.projectId).catch(() => undefined);
    await prisma.project.delete({ where: { id: job.projectId } }).catch(() => undefined);
    await removeProjectFiles(job.projectId).catch(() => undefined);
    deleted++;
  }
  return { deleted };
}

/** 没完成、没画完、停下的几套接着生成。返回实际重新开始的套数。 */
export async function retryJobs(ids: string[]) {
  let resumed = 0;
  for (const job of await prisma.ktuJob.findMany({ where: { id: { in: ids } } })) {
    try { if (await resumeJob(job.projectId)) resumed++; } catch { /* 这一套接不上就跳过，其余照常 */ }
  }
  return { resumed };
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

/** 页面上点「继续生成」：停止或没做完的任务从断点接着跑，上次没拿到结果的请求直接重发。接上了返回 true。 */
export async function resumeJob(projectId: string) {
  const run = await getDetailRun(projectId);
  if (!run || run.status === "COMPLETED" || (RUN_ACTIVE.includes(run.status) && run.status !== "WAITING_INPUT")) return false;
  await controlDetailRun(projectId, run.id, run.status === "WAITING_INPUT" ? "answers" : "resume", run.status === "WAITING_INPUT" ? { skip: true } : {}, zhishuCredentials());
  return true;
}

export async function stopJob(projectId: string) {
  const run = await getDetailRun(projectId);
  if (run && RUN_ACTIVE.includes(run.status)) await controlDetailRun(projectId, run.id, "cancel", {}, zhishuCredentials());
}
