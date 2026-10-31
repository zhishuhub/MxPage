// K图：作品页单张「改字重画」「重画这张」和切换版本。重画在后台跑，页面轮询看结果；旧图都留着，可以切回去。

import { prisma } from "@/lib/db/prisma";
import { getDetailRun } from "@/lib/detail-runs/service";
import { getProviderAdapter, type ProviderSnapshot } from "@/lib/services/provider-service";
import { saveGeneratedImage } from "@/lib/storage/asset-manager";
import { KTU_IMAGE_QUALITY } from "./catalog";
import { RUN_ACTIVE } from "./jobs";

const EXACT_COPY = "\nUse the following Exact copy as the sole source of visible text. It overrides any conflicting wording in the visual description; do not rephrase, omit or add claims.\nExact copy:\n";
const COMPOSITION = "Page composition:\n";

type ArtDirection = { prompt?: string; textBlocks?: Array<Record<string, unknown> & { text: string }> };
type RunInput = { imageModelId?: string; providerSnapshot?: ProviderSnapshot; imageSettings?: { size?: string }; xhsPromptPack?: { aspect?: "3:4" | "9:16" } };

const state = globalThis as typeof globalThis & { ktuRedrawing?: Set<string> };
const redrawing = (state.ktuRedrawing ??= new Set());

/**
 * 按改过的文字 / 画面描述重新拼出生图提示词：整组统一的风格要求（提示词开头到 Page composition）保持不变。
 * 拼不出来（不是 K图生成的页）时返回 null。
 */
export function rebuildPrompt(visualPrompt: string, description: string, text: string) {
  const at = visualPrompt.indexOf(COMPOSITION);
  if (at < 0) return null;
  return `${visualPrompt.slice(0, at + COMPOSITION.length)}${description.trim()}${EXACT_COPY}${text.trim()}`;
}

/** 新文字按行替换原来的文字块，排版位置尽量沿用原来的。 */
function nextTextBlocks(previous: ArtDirection["textBlocks"] = [], text: string) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => ({ ...(previous[index] ?? previous[previous.length - 1] ?? {}), text: line }));
}

export async function startRedraw(jobId: string, sectionId: string, edits: { text?: string; description?: string } = {}) {
  const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: jobId } });
  const section = await prisma.pageSection.findFirst({ where: { id: sectionId, projectId: job.projectId } });
  if (!section) throw new Error("这张图不存在");
  if (redrawing.has(sectionId)) throw new Error("这张图正在重画");
  const run = await getDetailRun(job.projectId).catch(() => null);
  if (!run) throw new Error("这套图还没开始生成");
  if (RUN_ACTIVE.includes(run.status)) throw new Error("这套图还在生成，等生成完再重画");

  const editable = (section.editableData ?? {}) as { artDirection?: ArtDirection; ktuRedrawError?: string };
  const art = editable.artDirection ?? {};
  const description = edits.description?.trim() || art.prompt || "";
  const text = edits.text?.trim() || art.textBlocks?.map(block => block.text).join("\n") || section.copy || "";
  if (!text) throw new Error("图上的字不能为空");
  const prompt = rebuildPrompt(section.visualPrompt, description, text) ?? section.visualPrompt;

  const { ktuRedrawError: _previousError, ...rest } = editable;
  await prisma.pageSection.update({
    where: { id: sectionId },
    data: { status: "GENERATING", copy: text, visualPrompt: prompt, editableData: { ...rest, artDirection: { ...art, prompt: description, textBlocks: nextTextBlocks(art.textBlocks, text) } } },
  });
  redrawing.add(sectionId);
  void draw(job.projectId, sectionId, prompt, run.input as RunInput).finally(() => redrawing.delete(sectionId));
}

async function draw(projectId: string, sectionId: string, prompt: string, input: RunInput) {
  try {
    const { adapter } = await getProviderAdapter(input.providerSnapshot?.id, input.providerSnapshot);
    const size = input.imageSettings?.size;
    const source = await adapter.generateImageOnce({
      model: input.imageModelId || "image", prompt, quality: KTU_IMAGE_QUALITY,
      ...(size && size !== "auto" ? { size } : { aspectRatio: input.xhsPromptPack?.aspect || "3:4" }),
      timeoutMs: 180000, monitor: { projectId, sectionId, operation: "ktu_redraw" },
    });
    const asset = await saveGeneratedImage({ projectId, sectionId, prompt, source, metadata: { redraw: true } });
    await prisma.pageSection.update({ where: { id: sectionId }, data: { currentImageAssetId: asset.id, status: "SUCCESS" } });
  } catch (error) {
    const section = await prisma.pageSection.findUnique({ where: { id: sectionId } });
    const message = error instanceof Error ? error.message : "重画失败";
    await prisma.pageSection.update({ where: { id: sectionId }, data: { status: section?.currentImageAssetId ? "SUCCESS" : "FAILED", editableData: { ...((section?.editableData ?? {}) as object), ktuRedrawError: message.slice(0, 300) } } }).catch(() => undefined);
  }
}

/** 换回某一版图。 */
export async function switchVersion(jobId: string, sectionId: string, assetId: string) {
  const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: jobId } });
  const asset = await prisma.productAsset.findFirst({ where: { id: assetId, projectId: job.projectId, sectionId, type: "GENERATED" } });
  if (!asset) throw new Error("这一版图不存在");
  if (redrawing.has(sectionId)) throw new Error("这张图正在重画，等画完再换");
  await prisma.pageSection.update({ where: { id: sectionId }, data: { currentImageAssetId: asset.id, status: "SUCCESS" } });
}

/** 应用重启时把卡在「重画中」的图放回来（后台任务已经不在了）。 */
export async function releaseStaleRedraws(projectId: string) {
  const stuck = await prisma.pageSection.findMany({ where: { projectId, status: "GENERATING" } });
  for (const section of stuck.filter(item => !redrawing.has(item.id))) {
    const run = await getDetailRun(projectId).catch(() => null);
    if (run && RUN_ACTIVE.includes(run.status)) return;
    await prisma.pageSection.update({ where: { id: section.id }, data: { status: section.currentImageAssetId ? "SUCCESS" : "FAILED" } });
  }
}
