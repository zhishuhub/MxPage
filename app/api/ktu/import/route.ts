import { importCities } from "@/lib/ktu/library";
import { mergeImports } from "@/lib/ktu/import-text";
import { parseImportFile } from "@/lib/ktu/import-excel";
import { fail, handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOTAL = 20_000_000;

/** 导入城市店名（Excel / CSV / TXT）：dryRun 时只返回预览（每个城市新增 / 删除几家、哪里填得不对），不写入。 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { files?: Array<{ name?: unknown; text?: unknown; base64?: unknown }>; removeMissing?: unknown; dryRun?: unknown };
    const files = (Array.isArray(body.files) ? body.files : []).map(file => ({
      name: String(file.name ?? ""),
      text: typeof file.text === "string" ? file.text : undefined,
      base64: typeof file.base64 === "string" ? file.base64 : undefined,
    }));
    if (!files.length || files.every(file => !file.text?.trim() && !file.base64)) return fail("VALIDATION_ERROR", "没有读到内容", null, 400);
    if (files.reduce((sum, file) => sum + (file.text?.length ?? 0) + (file.base64?.length ?? 0), 0) > MAX_TOTAL) return fail("VALIDATION_ERROR", "文件太大，请分几次导入", null, 400);
    const parsed = mergeImports(await Promise.all(files.map(file => parseImportFile(file).catch(error => ({ cities: [], issues: [{ line: 0, file: file.name, message: error instanceof Error ? error.message : "文件读取失败" }] })))));
    const plan = await importCities(parsed.cities, { removeMissing: body.removeMissing === true, dryRun: body.dryRun !== false });
    return ok({ plan, issues: parsed.issues });
  } catch (error) { return handleRouteError(error); }
}
