// K图：读取 Excel（.xlsx）资料，生成导入模板。只在服务端用（exceljs）。

import { mergeImports, parseImportText, type ImportCity, type ImportIssue } from "./import-text";
import { parseCsv, rowsToCities, TEMPLATE_ROWS } from "./import-table";

const MAX_EXPANDED = 50 * 1024 * 1024;
/** 模板里的说明页，导入时跳过。 */
const NOTES_SHEET = "填写说明";

/** 解压前先看 zip 目录里的展开大小，防止异常文件撑爆内存。 */
function assertSaneArchive(bytes: Buffer) {
  let total = 0, count = 0;
  for (let pos = 0; pos < bytes.length - 46; pos++) if (bytes.readUInt32LE(pos) === 0x02014b50) {
    total += bytes.readUInt32LE(pos + 24); count++;
    if (total > MAX_EXPANDED || count > 2000) throw new Error("Excel 文件太大，请分几次导入");
    pos += 45 + bytes.readUInt16LE(pos + 28) + bytes.readUInt16LE(pos + 30) + bytes.readUInt16LE(pos + 32);
  }
  if (!count) throw new Error("不是有效的 Excel 文件，请用 Excel 另存为 .xlsx 后再导入");
}

export async function parseWorkbook(bytes: Buffer, fileName: string) {
  assertSaneArchive(bytes);
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  const results: Array<{ cities: ImportCity[]; issues: ImportIssue[] }> = [];
  book.eachSheet(sheet => {
    if ((sheet.state && sheet.state !== "visible") || sheet.name === NOTES_SHEET) return;
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = [];
      for (let column = 1; column <= Math.min(row.cellCount, 20); column++) {
        const cell = row.getCell(column);
        // 合并单元格读主单元格的内容
        cells.push((cell.isMerged ? cell.master : cell).text ?? "");
      }
      rows[rowNumber - 1] = cells;
    });
    const filled = Array.from(rows, row => row ?? []);
    if (filled.some(row => row.some(cell => cell.trim()))) results.push(rowsToCities(filled, { sheetName: sheet.name, fileName }));
  });
  return mergeImports(results);
}

/** 按扩展名分派：.xlsx 走 Excel，.csv 走表格，其他按 TXT。 */
export async function parseImportFile(file: { name: string; text?: string; base64?: string }) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xls")) return { cities: [], issues: [{ line: 0, file: file.name, message: "不支持旧版 .xls，请用 Excel 打开后「另存为」.xlsx 再导入" }] };
  if (lower.endsWith(".xlsx")) return parseWorkbook(Buffer.from(file.base64 ?? "", "base64"), file.name);
  if (lower.endsWith(".csv")) return rowsToCities(parseCsv(file.text ?? ""), { fileName: file.name });
  return parseImportText(file.text ?? "", file.name);
}

export async function buildTemplateWorkbook() {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sheet1");
  sheet.columns = [{ width: 14 }, { width: 32 }];
  TEMPLATE_ROWS.forEach(row => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const notes = book.addWorksheet(NOTES_SHEET);
  notes.columns = [{ width: 80 }];
  [
    "一行一家场所：A 列写城市，B 列写场所名称。",
    "同一城市连续几行时，城市可以只写第一行，下面留空。",
    "这一页是说明，导入时不会读取。",
  ].forEach(line => notes.addRow([line]));
  return Buffer.from(await book.xlsx.writeBuffer());
}
