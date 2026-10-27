import { DEFAULT_REVIEW_REQUIREMENTS, getKtuSettings, updateKtuSettings } from "@/lib/ktu/settings";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 出图检查的开关和检查要求。 */
export async function GET() {
  try { return ok({ ...await getKtuSettings(), defaultReviewRequirements: DEFAULT_REVIEW_REQUIREMENTS }); }
  catch (error) { return handleRouteError(error); }
}

export async function PATCH(request: Request) {
  try { return ok(await updateKtuSettings(await request.json())); }
  catch (error) { return handleRouteError(error); }
}
