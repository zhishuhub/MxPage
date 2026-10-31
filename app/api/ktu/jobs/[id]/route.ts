import { prisma } from "@/lib/db/prisma";
import { exportJob } from "@/lib/ktu/export";
import { deleteJobs, fixPostWording, jobNeighbors, resumeJob, setPageDiscarded, stopJob, summarizeJob, updatePost } from "@/lib/ktu/jobs";
import { releaseStaleRedraws, startRedraw, switchVersion } from "@/lib/ktu/redraw";
import { fail, handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 一套图文的进度、图片、文案和发布前检查结果，带上一套 / 下一套。 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: params.id } });
    await releaseStaleRedraws(job.projectId);
    const [summary, neighbors] = await Promise.all([summarizeJob(job), jobNeighbors(job)]);
    return ok({ ...summary, ...neighbors });
  } catch (error) { return handleRouteError(error); }
}

/** 导出、停止、继续、丢弃 / 恢复某张图、改字重画、换版本、改文案、违规词一键改。 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({})) as { action?: string; sectionId?: string; dir?: string; text?: string; description?: string; assetId?: string; title?: string; caption?: string; hashtags?: unknown };
    const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: params.id } });
    const needSection = ["discard", "restore", "redraw", "version"].includes(body.action ?? "");
    if (needSection && !body.sectionId) return fail("VALIDATION_ERROR", "缺少图片", null, 400);
    let remaining: number | undefined;
    switch (body.action) {
      case "export": return ok(await exportJob(job.id, body.dir));
      case "stop": await stopJob(job.projectId); break;
      case "resume": await resumeJob(job.projectId); break;
      case "discard":
      case "restore": await setPageDiscarded(job.id, body.sectionId!, body.action === "discard"); break;
      case "redraw": await startRedraw(job.id, body.sectionId!, { text: body.text, description: body.description }); break;
      case "version":
        if (!body.assetId) return fail("VALIDATION_ERROR", "缺少版本", null, 400);
        await switchVersion(job.id, body.sectionId!, body.assetId);
        break;
      case "post": await updatePost(job.id, body); break;
      case "fixPost": ({ remaining } = await fixPostWording(job.id)); break;
      default: return fail("VALIDATION_ERROR", "未知操作", null, 400);
    }
    const latest = await prisma.ktuJob.findUniqueOrThrow({ where: { id: job.id } });
    const [summary, neighbors] = await Promise.all([summarizeJob(latest), jobNeighbors(latest)]);
    return ok({ ...summary, ...neighbors, ...(remaining === undefined ? {} : { remaining }) });
  } catch (error) { return handleRouteError(error); }
}

/** 删除这套图文（连同作品和图片文件）。 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    await prisma.ktuJob.findUniqueOrThrow({ where: { id: params.id } });
    await deleteJobs([params.id]);
    return ok({ id: params.id });
  } catch (error) { return handleRouteError(error); }
}
