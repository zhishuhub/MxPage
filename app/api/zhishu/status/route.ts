import { NextRequest } from "next/server";
import { getZhishuStatus } from "@/lib/zhishu/connection";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 接入状态；verify=1 时顺带确认接入在网站上还有效。 */
export async function GET(request: NextRequest) {
  try { return ok(await getZhishuStatus(request.nextUrl.searchParams.get("verify") === "1")); }
  catch (error) { return handleRouteError(error); }
}
