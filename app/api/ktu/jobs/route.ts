import { NextRequest } from "next/server";
import { listJobs, type KtuJobFilter } from "@/lib/ktu/jobs";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS: KtuJobFilter[] = ["all", "running", "done", "attention"];

/**
 * 生成记录：按创建时间倒序。runId 只看某一批；filter 按状态筛；before 翻到下一页（上一页最后一条的「创建时间|编号」）；
 * ids 只取这几套（刷新进度用）；lite=1 不带每张图的历史版本。
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 30));
    const filter = FILTERS.find(item => item === params.get("filter")) ?? "all";
    const ids = params.get("ids")?.split(",").map(id => id.trim()).filter(Boolean).slice(0, 200);
    return ok(await listJobs({ limit, filter, before: params.get("before"), runId: params.get("runId"), ids, lite: params.get("lite") === "1" }));
  } catch (error) { return handleRouteError(error); }
}
