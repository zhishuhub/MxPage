import { deleteSchedule, updateSchedule } from "@/lib/ktu/schedules";
import { runScheduleNow } from "@/lib/ktu/scheduler";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 修改定时任务；只传 enabled 时只切换开关。 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try { return ok(await updateSchedule(params.id, await request.json())); }
  catch (error) { return handleRouteError(error); }
}

/** 立即运行一次。 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try { const run = await runScheduleNow(params.id); return ok({ id: run.id, status: run.status }); }
  catch (error) { return handleRouteError(error); }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try { await deleteSchedule(params.id); return ok({ id: params.id }); }
  catch (error) { return handleRouteError(error); }
}
