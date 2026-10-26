import { connectZhishu } from "@/lib/zhishu/connection";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 用网站发的接入码换调用地址和密钥。 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { code?: string };
    return ok(await connectZhishu(String(body.code ?? "")));
  } catch (error) { return handleRouteError(error); }
}
