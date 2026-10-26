import packageInfo from "@/package.json";
import { getLatestAppVersion } from "@/lib/zhishu/connection";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 当前版本与网站上的最新版本；不一样就提示去网站下载。 */
export async function GET() {
  try {
    const latest = await getLatestAppVersion();
    return ok({ current: packageInfo.version, latest, hasUpdate: Boolean(latest) && latest !== packageInfo.version });
  } catch (error) { return handleRouteError(error); }
}
