import { buildTemplateWorkbook } from "@/lib/ktu/import-excel";
import { handleRouteError } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 下载 Excel 导入模板（城市等级带下拉）。 */
export async function GET() {
  try {
    return new Response(await buildTemplateWorkbook(), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ktu-template.xlsx"; filename*=UTF-8''${encodeURIComponent("K图店名模板.xlsx")}`,
      },
    });
  } catch (error) { return handleRouteError(error); }
}
