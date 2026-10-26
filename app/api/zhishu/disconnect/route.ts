import { disconnectZhishu } from "@/lib/zhishu/connection";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 重新接入：清掉保存的接入信息。 */
export async function POST() {
  try { return ok(disconnectZhishu()); }
  catch (error) { return handleRouteError(error); }
}
