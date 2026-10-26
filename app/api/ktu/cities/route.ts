import { createCity, listCities } from "@/lib/ktu/library";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 资料库：全部城市及店名。 */
export async function GET() {
  try { return ok(await listCities()); }
  catch (error) { return handleRouteError(error); }
}

/** 新增城市；等级不填时按常见城市表预填。 */
export async function POST(request: Request) {
  try { return ok(await createCity(await request.json())); }
  catch (error) { return handleRouteError(error); }
}
