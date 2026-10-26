import { createSchedule, listSchedules } from "@/lib/ktu/schedules";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 定时任务列表（含最近几次运行记录）。 */
export async function GET() {
  try { return ok(await listSchedules()); }
  catch (error) { return handleRouteError(error); }
}

export async function POST(request: Request) {
  try { return ok(await createSchedule(await request.json())); }
  catch (error) { return handleRouteError(error); }
}
