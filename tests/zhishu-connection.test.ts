import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../lib/db/prisma";
import { selectModel } from "../lib/ai/model-selection";
import { clearZhishuConnection, loadZhishuConnection, saveZhishuConnection, zhishuCredentials } from "../lib/zhishu/connection-file";
import { ZHISHU_PROVIDER_ID, applyZhishuProvider, ensureZhishuProvider } from "../lib/zhishu/connection";

test("connection file round-trips and yields trimmed credentials", { concurrency: false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ktu-zhishu-"));
  const previous = process.env.APP_USER_DATA_DIR;
  process.env.APP_USER_DATA_DIR = dir;
  try {
    assert.equal(loadZhishuConnection(), null);
    assert.deepEqual(zhishuCredentials(), {});
    saveZhishuConnection({ base_url: "https://site.test/v1/", api_key: "sk-app", user_name: "测试", models: ["chat", "image"], connected_at: "2026-10-26T00:00:00Z" });
    assert.deepEqual(zhishuCredentials(), { apiKey: "sk-app", baseUrl: "https://site.test/v1" });
    clearZhishuConnection();
    assert.equal(loadZhishuConnection(), null);
  } finally {
    if (previous === undefined) delete process.env.APP_USER_DATA_DIR; else process.env.APP_USER_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("managed provider fixes chat / image capabilities so every workflow role resolves", { concurrency: false }, async () => {
  await prisma.providerConfig.create({ data: { name: "旧服务", baseUrl: "https://old.test", apiKeyEncrypted: "", isActive: true } });
  await applyZhishuProvider({ base_url: "https://site.test/v1", api_key: "sk-app", user_name: "", models: [], connected_at: "" });
  const providers = await prisma.providerConfig.findMany({ include: { models: true } });
  const managed = providers.find(provider => provider.id === ZHISHU_PROVIDER_ID)!;
  assert.equal(providers.filter(provider => provider.isActive).length, 1);
  assert.equal(managed.isActive, true);
  assert.equal(managed.textProtocol, "chat_completions");
  assert.equal(managed.structuredOutputMode, "json_object");
  assert.equal(selectModel(managed.models, "planning", undefined, true), "chat");
  assert.equal(selectModel(managed.models, "analysis"), "chat");
  assert.equal(selectModel(managed.models, "hero"), "image");
  assert.equal(selectModel(managed.models, "detail"), "image");
  assert.equal(selectModel(managed.models, "edit"), "image");

  // 地址变了（换了网站 / 子站）时补齐配置
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ktu-zhishu-"));
  process.env.APP_USER_DATA_DIR = dir;
  try {
    saveZhishuConnection({ base_url: "https://sub.test/v1", api_key: "sk-sub", user_name: "", models: [], connected_at: "" });
    await ensureZhishuProvider();
    const refreshed = await prisma.providerConfig.findUniqueOrThrow({ where: { id: ZHISHU_PROVIDER_ID }, include: { models: true } });
    assert.equal(refreshed.baseUrl, "https://sub.test/v1");
    assert.equal(refreshed.models.length, 2);
  } finally {
    delete process.env.APP_USER_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
    await prisma.providerConfig.deleteMany({});
  }
});
