import { hasRunningBatches, tick } from "@/lib/ktu/scheduler";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 推进批量和定时任务；桌面壳定时调用，返回需要弹系统通知的完成消息，以及还有没有批次在跑。 */
export async function POST() {
  try {
    const notifications = await tick();
    return ok({ notifications, busy: await hasRunningBatches() });
  } catch (error) { return handleRouteError(error); }
}
