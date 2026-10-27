import { createTemplate, listTemplates } from "@/lib/ktu/templates";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 模板库：内置六个 + 自己新增的。 */
export async function GET() {
  try { return ok(await listTemplates()); }
  catch (error) { return handleRouteError(error); }
}

export async function POST(request: Request) {
  try { return ok(await createTemplate(await request.json())); }
  catch (error) { return handleRouteError(error); }
}
