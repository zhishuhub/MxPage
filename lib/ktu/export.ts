// K图：把一套成品导出到文件夹：图片按页序编号，文案一份，有问题再附一份「需检查.txt」。

import fs from "fs/promises";
import path from "path";

import { prisma } from "@/lib/db/prisma";
import { readStorageFile } from "@/lib/storage/asset-manager";
import { env } from "@/lib/utils/env";
import { summarizeJob } from "./jobs";

/** 桌面版启动时把「图片/K图」传进来；本地部署时落到存储目录下。 */
export function defaultOutputDir() {
  return process.env.KTU_OUTPUT_DIR?.trim() || path.resolve(process.cwd(), env.STORAGE_ROOT, "exports", "K图");
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim().slice(0, 60) || "未命名";
}

function stamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return { day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` };
}

async function uniqueDir(base: string) {
  for (let index = 0; ; index++) {
    const dir = index ? `${base}-${index + 1}` : base;
    try { await fs.access(dir); } catch { return dir; }
  }
}

export async function exportJob(jobId: string, baseDir?: string) {
  const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: jobId } });
  const summary = await summarizeJob(job);
  const sections = await prisma.pageSection.findMany({ where: { projectId: job.projectId }, orderBy: { order: "asc" }, include: { currentImageAsset: true } });
  const discarded = new Set(summary.pages.filter(page => page.discarded).map(page => page.sectionId));
  const images = sections.filter(section => section.currentImageAsset && !discarded.has(section.id));
  if (!images.length) throw new Error("这套图文没有可导出的图片");

  const when = stamp(job.createdAt);
  const root = baseDir?.trim() || defaultOutputDir();
  const dir = await uniqueDir(path.join(root, when.day, safeName(summary.cityName), `${safeName(summary.templateName)}-${when.time}`));
  await fs.mkdir(dir, { recursive: true });

  for (const [index, section] of images.entries()) {
    const asset = section.currentImageAsset!;
    const ext = path.extname(asset.filePath) || ".png";
    await fs.writeFile(path.join(dir, `${String(index + 1).padStart(2, "0")}${ext}`), await readStorageFile(asset.filePath));
  }

  const post = summary.post;
  const tags = (post?.hashtags ?? []).map(tag => `#${tag.replace(/^#+/, "")}`).join(" ");
  await fs.writeFile(path.join(dir, "文案.txt"), [post?.title ?? summary.cityName, "", post?.caption ?? "", "", tags].join("\n").trim() + "\n", "utf8");

  const notes = [
    ...summary.pages.filter(page => !page.discarded).flatMap(page => page.needsCheck ? [`「${page.title}」需检查：${page.issues.join("；") || "自动检查未通过"}`] : []),
    ...summary.pages.filter(page => !page.discarded).flatMap(page => page.imageUrl ? [] : [`「${page.title}」没有生成`]),
    ...summary.compliance.map(hit => `${hit.where}出现「${hit.word}」（${hit.category}），发布前请修改`),
  ];
  if (notes.length) await fs.writeFile(path.join(dir, "需检查.txt"), notes.join("\n") + "\n", "utf8");

  await prisma.ktuJob.update({ where: { id: jobId }, data: { exportedPath: dir } });
  return { dir, needsCheck: notes.length > 0 };
}

/** 批量导出：每套照常按「日期 / 城市 / 模板」分文件夹；还没有图的跳过。 */
export async function exportJobs(ids: string[], baseDir?: string) {
  let exported = 0;
  let skipped = 0;
  for (const id of ids) {
    try { await exportJob(id, baseDir); exported++; } catch { skipped++; }
  }
  return { exported, skipped, dir: baseDir?.trim() || defaultOutputDir() };
}
