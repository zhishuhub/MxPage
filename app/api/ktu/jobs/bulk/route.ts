import { exportJobs } from "@/lib/ktu/export";
import { deleteJobs, retryJobs } from "@/lib/ktu/jobs";
import { fail, handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 生成记录里勾选的几套：删除（连同图片文件）、导出到文件夹、没完成的接着生成。 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { action?: string; ids?: unknown; dir?: unknown };
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).filter(Boolean))].slice(0, 500) : [];
    if (!ids.length) return fail("VALIDATION_ERROR", "请先勾选图文", null, 400);
    switch (body.action) {
      case "delete": return ok(await deleteJobs(ids));
      case "export": return ok(await exportJobs(ids, typeof body.dir === "string" ? body.dir : undefined));
      case "retry": return ok(await retryJobs(ids));
      default: return fail("VALIDATION_ERROR", "未知操作", null, 400);
    }
  } catch (error) { return handleRouteError(error); }
}
