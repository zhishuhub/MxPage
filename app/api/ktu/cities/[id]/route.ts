import { deleteCity, setCityVenuesFromText, updateCity } from "@/lib/ktu/library";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 改城市名、等级；带 venuesText 时用粘贴的店名列表整体替换。 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json() as { name?: unknown; tier?: unknown; venuesText?: unknown };
    if (body.name !== undefined || body.tier !== undefined) await updateCity(params.id, body);
    const venueCount = typeof body.venuesText === "string" ? await setCityVenuesFromText(params.id, body.venuesText) : undefined;
    return ok({ id: params.id, venueCount });
  } catch (error) { return handleRouteError(error); }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try { await deleteCity(params.id); return ok({ id: params.id }); }
  catch (error) { return handleRouteError(error); }
}
