"use client";

import { useState } from "react";
import { Download, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tierLabel } from "@/lib/ktu/catalog";
import { TEMPLATE_ROWS } from "@/lib/ktu/import-table";
import { api } from "./api";

type Plan = Array<{ name: string; tier: string | null; exists: boolean; added: number; removed: number; total: number; error: string }>;
type Preview = { plan: Plan; issues: Array<{ line: number; file: string; message: string }> };
type SourceFile = { name: string; text?: string; base64?: string };

/** Windows 记事本存的 TXT / CSV 可能是 UTF-8、GBK（ANSI）或 UTF-16，按字节判断后解码。 */
async function decodeText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("gbk").decode(bytes); }
}

async function readSource(file: File): Promise<SourceFile> {
  if (!/\.xlsx?$/i.test(file.name)) return { name: file.name, text: await decodeText(file) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { name: file.name, base64: btoa(binary) };
}

export function KtuImport({ onDone, onClose }: { onDone: () => Promise<void>; onClose: () => void }) {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [pasted, setPasted] = useState("");
  const [removeMissing, setRemoveMissing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  // 从 Excel 复制过来的是 Tab 分隔的表格，按表格读；否则按 TXT 读
  const sources = (nextFiles: SourceFile[], nextPasted: string) => [...nextFiles, ...(nextPasted.trim() ? [{ name: /\t|店名/.test(nextPasted.split(/\r?\n/)[0] ?? "") ? "粘贴内容.csv" : "粘贴内容.txt", text: nextPasted }] : [])];

  const run = async (dryRun: boolean, nextFiles = files, nextPasted = pasted, nextRemove = removeMissing) => {
    const list = sources(nextFiles, nextPasted);
    if (!list.length) { setPreview(null); return; }
    setBusy(true);
    try {
      const result = await api.send<Preview>("/api/ktu/import", "POST", { files: list, removeMissing: nextRemove, dryRun });
      if (dryRun) setPreview(result);
      else {
        const done = result.plan.filter(city => !city.error);
        toast.success(`已导入 ${done.length} 个城市，新增 ${done.reduce((sum, city) => sum + city.added, 0)} 家场所`);
        await onDone();
        onClose();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    const next = await Promise.all([...list].map(readSource));
    setFiles(next);
    await run(true, next);
  };

  const okCities = preview?.plan.filter(city => !city.error) ?? [];

  return <div className="space-y-5 rounded-2xl border border-primary/40 p-5">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="font-semibold">导入 Excel</h2>
        <p className="text-sm leading-6 text-muted-foreground">两列：城市、场所名称，一行一家。同一城市连续几行时，城市可以只写第一行。不在常见城市表里的新城市导入后显示为未分级，到资料库里选一下等级。</p>
      </div>
      <Button variant="ghost" className="shrink-0" onClick={onClose}>收起</Button>
    </div>
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      <div className="space-y-2">
        <table className="w-full overflow-hidden rounded-xl bg-muted text-xs">
          <tbody>{TEMPLATE_ROWS.map((row, index) => <tr key={index} className={index === 0 ? "font-medium" : ""}>{row.map((cell, column) => <td key={column} className="border border-background px-2 py-1">{cell}</td>)}</tr>)}</tbody>
        </table>
        <a href="/api/ktu/import/template" download="K图店名模板.xlsx" className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-accent"><Download className="h-4 w-4" />下载 Excel 模板</a>
      </div>
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border p-5 text-sm hover:bg-accent">
          <FileUp className="h-4 w-4" />{files.length ? files.map(file => file.name).join("、") : "选择 Excel 文件（可多选）"}
          <input type="file" accept=".xlsx,.xls,.csv,.txt" multiple className="hidden" onChange={event => { void pick(event.target.files); event.target.value = ""; }} />
        </label>
        <Textarea rows={4} value={pasted} placeholder="也可以在 Excel 里选中表格复制，直接粘贴到这里" onChange={event => setPasted(event.target.value)} onBlur={() => void run(true)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={removeMissing} onChange={event => { setRemoveMissing(event.target.checked); void run(true, files, pasted, event.target.checked); }} />同时删掉表格里没有的场所（不勾选时只追加新场所）</label>
        <p className="text-xs text-muted-foreground">也能导入 CSV 和 TXT（TXT 用「# 城市名」开头，下面每行一家）。</p>
      </div>
    </div>

    {preview && <div className="space-y-3">
      {preview.plan.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2">城市</th><th>等级</th><th>新增</th><th>删除</th><th>导入后共</th><th /></tr></thead>
        <tbody>{preview.plan.map(city => <tr key={city.name} className="border-b border-border/60">
          <td className="py-2">{city.name}{!city.exists && <span className="ml-1 text-xs text-muted-foreground">新城市</span>}</td>
          <td>{city.tier ? tierLabel(city.tier) : <span className="text-amber-600">未分级</span>}</td><td>{city.added}</td><td>{city.removed || "—"}</td><td>{city.error ? "—" : city.total}</td>
          <td className="text-destructive">{city.error}</td>
        </tr>)}</tbody>
      </table></div>}
      {preview.issues.map((issue, index) => <p key={index} className="text-sm text-destructive">{issue.file ? `${issue.file} ` : ""}{issue.line ? `第 ${issue.line} 行：` : ""}{issue.message}</p>)}
      <div className="flex items-center gap-3">
        <Button disabled={busy || !okCities.length} onClick={() => void run(false)}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认导入 {okCities.length} 个城市</Button>
        {preview.plan.some(city => city.error) && <span className="text-sm text-muted-foreground">标红的城市不会导入，改好表格后重新选择</span>}
      </div>
    </div>}
  </div>;
}
