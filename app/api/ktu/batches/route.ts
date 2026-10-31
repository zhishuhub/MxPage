import { prisma } from "@/lib/db/prisma";
import { queuedSpecs, startManualBatch } from "@/lib/ktu/scheduler";
import { getKtuSettings } from "@/lib/ktu/settings";
import { effectiveConcurrency } from "@/lib/ktu/throttle";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

/** 最近的批量生成和定时任务批次；在跑的带上还在排队的几套，以及当前同时生成几套。 */
export async function GET() {
  try {
    const [runs, settings] = await Promise.all([
      prisma.ktuScheduleRun.findMany({ orderBy: { startedAt: "desc" }, take: 20, include: { schedule: { select: { name: true } } } }),
      getKtuSettings(),
    ]);
    const concurrency = { configured: settings.concurrency, effective: effectiveConcurrency(settings.concurrency) };
    return ok(await Promise.all(runs.map(async run => ({
      id: run.id, kind: run.kind, name: run.schedule?.name ?? "", status: run.status, planned: Array.isArray(run.planned) ? run.planned.length : 0, nextIndex: run.nextIndex,
      succeeded: run.succeeded, failed: run.failed, message: run.message, startedAt: run.startedAt, finishedAt: run.finishedAt,
      queued: run.status === "running" ? await queuedSpecs(run) : [],
      concurrency,
    }))));
  } catch (error) { return handleRouteError(error); }
}

/** 手动批量：选城市（或城市等级）× 模板排成一批，按设置同时生成几套。返回已经开出的作品编号。 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { run, skipped, jobIds } = await startManualBatch({ cityIds: list(body.cityIds), tiers: list(body.tiers), templateKeys: list(body.templateKeys), picked: list(body.picked), aspect: String(body.aspect ?? "3:4") });
    return ok({ id: run.id, planned: Array.isArray(run.planned) ? run.planned.length : 0, skipped, jobIds });
  } catch (error) { return handleRouteError(error); }
}
