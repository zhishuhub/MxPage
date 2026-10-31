import { getZhishuBalance } from "@/lib/zhishu/connection";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 账户剩余额度，页头显示用；查不到时 display 为空。 */
export async function GET() {
  try { return ok({ display: await getZhishuBalance() }); }
  catch (error) { return handleRouteError(error); }
}
