import { pageCountFor, selectVenues } from "@/lib/ktu/brief";
import { planManualBatch } from "@/lib/ktu/scheduler";
import { handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

/** 开始生成前预估：能出几套、大约画几张图（不含检查没通过的重画），资料不够的几套。不建任何记录。 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const input = { cityIds: list(body.cityIds), tiers: list(body.tiers), templateKeys: list(body.templateKeys), picked: list(body.picked), aspect: String(body.aspect ?? "3:4") };
    if (!input.templateKeys.length || (!input.cityIds.length && !input.tiers.length)) return ok({ sets: 0, images: 0, skipped: [] });
    const { specs, skipped, templates, cities } = await planManualBatch(input).catch(() => ({ specs: [], skipped: [], templates: [], cities: [] }));
    let images = 0;
    for (const spec of specs) {
      const template = templates.find(item => item.key === spec.templateKey);
      const city = cities.find(item => item.id === spec.cityId);
      if (template && city) images += pageCountFor(template, selectVenues(template, city.venues, spec.picked));
    }
    return ok({ sets: specs.length, images, skipped });
  } catch (error) { return handleRouteError(error); }
}
