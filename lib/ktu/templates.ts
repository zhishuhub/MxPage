// K图：宣传模板存在数据库里。内置六个第一次用到时写入，可以改、可以恢复默认、不能删；自己新增的可以删。

import { randomUUID } from "crypto";

import { prisma } from "@/lib/db/prisma";
import { BUILTIN_TEMPLATES, builtinTemplate, parseTemplateInput, type KtuTemplateDef } from "./catalog";

type TemplateRow = Awaited<ReturnType<typeof prisma.ktuTemplate.findFirstOrThrow>>;

function toDef(row: TemplateRow): KtuTemplateDef & { id: string } {
  return {
    id: row.id, key: row.key, name: row.name, builtin: row.builtin, minVenues: row.minVenues, maxVenues: row.maxVenues,
    pick: row.pick === "rotate" ? "rotate" : "random",
    pages: row.pages === "perVenue" || row.pages === "perDistrict" ? row.pages : "fixed",
    pageCount: row.pageCount, content: row.content,
  };
}

/** 补上还没写入的内置模板（已有的不覆盖，用户改过的保留）。 */
async function ensureBuiltins() {
  const existing = new Set((await prisma.ktuTemplate.findMany({ where: { builtin: true }, select: { key: true } })).map(row => row.key));
  for (const [index, template] of BUILTIN_TEMPLATES.entries()) {
    if (existing.has(template.key)) continue;
    const { builtin: _builtin, ...fields } = template;
    await prisma.ktuTemplate.upsert({ where: { key: template.key }, update: {}, create: { ...fields, builtin: true, sortOrder: index } });
  }
}

export async function listTemplates() {
  await ensureBuiltins();
  const rows = await prisma.ktuTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map(toDef);
}

export async function getTemplate(key: string) {
  await ensureBuiltins();
  const row = await prisma.ktuTemplate.findUnique({ where: { key } });
  return row ? toDef(row) : null;
}

export async function createTemplate(raw: Record<string, unknown>) {
  const data = parseTemplateInput(raw);
  const last = await prisma.ktuTemplate.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return toDef(await prisma.ktuTemplate.create({ data: { ...data, key: `c_${randomUUID().slice(0, 8)}`, builtin: false, sortOrder: (last?.sortOrder ?? 0) + 1 } }));
}

export async function updateTemplate(id: string, raw: Record<string, unknown>) {
  return toDef(await prisma.ktuTemplate.update({ where: { id }, data: parseTemplateInput(raw) }));
}

export async function resetTemplate(id: string) {
  const row = await prisma.ktuTemplate.findUniqueOrThrow({ where: { id } });
  const original = builtinTemplate(row.key);
  if (!row.builtin || !original) throw new Error("只有内置模板可以恢复默认");
  const { key: _key, builtin: _builtin, ...fields } = original;
  return toDef(await prisma.ktuTemplate.update({ where: { id }, data: fields }));
}

/** 删除自建模板；有定时任务在用时不删，返回提示。 */
export async function deleteTemplate(id: string) {
  const row = await prisma.ktuTemplate.findUniqueOrThrow({ where: { id } });
  if (row.builtin) throw new Error("内置模板不能删除，可以改或恢复默认");
  const schedules = await prisma.ktuSchedule.findMany({ select: { name: true, templateKeys: true } });
  const users = schedules.filter(schedule => Array.isArray(schedule.templateKeys) && schedule.templateKeys.includes(row.key)).map(schedule => `「${schedule.name}」`);
  if (users.length) throw new Error(`定时任务${users.join("、")}正在用这个模板，请先在定时任务里去掉它`);
  await prisma.ktuTemplate.delete({ where: { id } });
}
