import { deleteTemplate, resetTemplate, updateTemplate } from "@/lib/ktu/templates";
import { fail, handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try { return ok(await updateTemplate(params.id, await request.json())); }
  catch (error) { return handleRouteError(error); }
}

/** 内置模板恢复默认。 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({})) as { action?: string };
    if (body.action !== "reset") return fail("VALIDATION_ERROR", "未知操作", null, 400);
    return ok(await resetTemplate(params.id));
  } catch (error) { return handleRouteError(error); }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try { await deleteTemplate(params.id); return ok({ id: params.id }); }
  catch (error) { return handleRouteError(error); }
}
