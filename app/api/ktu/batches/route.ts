import { prisma } from "@/lib/db/prisma";
import { startManualBatch } from "@/lib/ktu/scheduler";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

/** 最近的批量生成和定时任务批次。 */
export async function GET() {
  try {
    const runs = await prisma.ktuScheduleRun.findMany({ orderBy: { startedAt: "desc" }, take: 20, include: { schedule: { select: { name: true } } } });
    return ok(runs.map(run => ({ id: run.id, kind: run.kind, name: run.schedule?.name ?? "", status: run.status, planned: Array.isArray(run.planned) ? run.planned.length : 0, nextIndex: run.nextIndex, succeeded: run.succeeded, failed: run.failed, message: run.message, startedAt: run.startedAt, finishedAt: run.finishedAt })));
  } catch (error) { return handleRouteError(error); }
}

/** 手动批量：选城市（或城市等级）× 模板，排成一批依次生成。 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { run, skipped } = await startManualBatch({ cityIds: list(body.cityIds), tiers: list(body.tiers), templateKeys: list(body.templateKeys), picked: list(body.picked), aspect: String(body.aspect ?? "3:4") });
    return ok({ id: run.id, planned: Array.isArray(run.planned) ? run.planned.length : 0, skipped });
  } catch (error) { return handleRouteError(error); }
}
