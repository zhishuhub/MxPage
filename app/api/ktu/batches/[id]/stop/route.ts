import { stopRun } from "@/lib/ktu/scheduler";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 停止一批：在跑的几套停掉，后面的不再开始。 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try { const run = await stopRun(params.id); return ok({ id: run.id, status: run.status }); }
  catch (error) { return handleRouteError(error); }
}
