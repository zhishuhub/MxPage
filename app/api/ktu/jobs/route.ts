import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { summarizeJob } from "@/lib/ktu/jobs";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 最近生成的图文；runId 只看某一批。 */
export async function GET(request: NextRequest) {
  try {
    const runId = request.nextUrl.searchParams.get("runId");
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 30));
    const jobs = await prisma.ktuJob.findMany({ where: runId ? { scheduleRunId: runId } : {}, orderBy: { createdAt: "desc" }, take: limit });
    return ok(await Promise.all(jobs.map(summarizeJob)));
  } catch (error) { return handleRouteError(error); }
}
