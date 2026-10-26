import { prisma } from "@/lib/db/prisma";
import { exportJob } from "@/lib/ktu/export";
import { resumeJob, setPageDiscarded, stopJob, summarizeJob } from "@/lib/ktu/jobs";
import { fail, handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 一套图文的进度、图片、文案和发布前检查结果。 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try { return ok(await summarizeJob(await prisma.ktuJob.findUniqueOrThrow({ where: { id: params.id } }))); }
  catch (error) { return handleRouteError(error); }
}

/** 导出、停止、继续、丢弃 / 恢复某张图。 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({})) as { action?: string; sectionId?: string; dir?: string };
    const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: params.id } });
    switch (body.action) {
      case "export": return ok(await exportJob(job.id, body.dir));
      case "stop": await stopJob(job.projectId); break;
      case "resume": await resumeJob(job.projectId); break;
      case "discard":
      case "restore":
        if (!body.sectionId) return fail("VALIDATION_ERROR", "缺少图片", null, 400);
        await setPageDiscarded(job.id, body.sectionId, body.action === "discard");
        break;
      default: return fail("VALIDATION_ERROR", "未知操作", null, 400);
    }
    return ok(await summarizeJob(await prisma.ktuJob.findUniqueOrThrow({ where: { id: job.id } })));
  } catch (error) { return handleRouteError(error); }
}

/** 删除这套图文（连同作品）。 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const job = await prisma.ktuJob.findUniqueOrThrow({ where: { id: params.id } });
    await stopJob(job.projectId).catch(() => undefined);
    await prisma.project.delete({ where: { id: job.projectId } });
    return ok({ id: params.id });
  } catch (error) { return handleRouteError(error); }
}
