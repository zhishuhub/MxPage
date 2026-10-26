import { tick } from "@/lib/ktu/scheduler";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 推进批量和定时任务；桌面壳定时调用，返回需要弹系统通知的完成消息。 */
export async function POST() {
  try { return ok({ notifications: await tick() }); }
  catch (error) { return handleRouteError(error); }
}
