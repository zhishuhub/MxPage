// 一键接入：用户在网站「我的应用」点「一键接入」拿到接入码，应用把接入码和应用编号发给接入接口，换回 base_url、api_key。
// 接入后服务商配置只有一条由它生成的记录（固定 chat / image 两个模型），设置页不再提供修改入口。

import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/utils/crypto";
import {
  ZHISHU_APP_KEY, ZHISHU_CHAT_MODEL, ZHISHU_CODE_PATTERN, ZHISHU_IMAGE_MODEL,
  clearZhishuConnection, loadZhishuConnection, normalizedBaseUrl, saveZhishuConnection, siteOrigin,
  type ZhishuConnection,
} from "./connection-file";

export { zhishuCredentials } from "./connection-file";

// 接入地址固定，不提供修改入口；ZHISHU_CONNECT_URL 只给本地测试用。
// 请求网站一律 cache: "no-store"：这些都在 GET 接口里调用，不写的话 Next 会把结果缓存住，版本、授权状态、余额就不更新了。
const CONNECT_URL = process.env.ZHISHU_CONNECT_URL?.trim() || "https://zhishuhub.com/api/apps/connect";
export const ZHISHU_PROVIDER_ID = "zhishu-managed";

export type ZhishuStatus = {
  connected: boolean;
  userName: string;
  /** 用户所在网站的地址，检查更新、去网站下载都用它 */
  siteOrigin: string;
  appKey: string;
  /** 接入失败或接入失效时给用户看的提示 */
  message: string;
};

function status(connection: ZhishuConnection | null, message = ""): ZhishuStatus {
  return { connected: connection !== null, userName: connection?.user_name ?? "", siteOrigin: siteOrigin(connection, CONNECT_URL), appKey: ZHISHU_APP_KEY, message };
}

/**
 * 接入后唯一的服务商配置。模型能力直接写死：按名字自动识别会把 chat 认成不能识图、把 image 认成不能改图。
 * 文本固定走 Chat Completions + JSON 对象输出：中转站背后可能是 GPT 也可能是 Claude，这是两边都接受的组合，
 * 也避免自动探测先试 /responses 时被非标准报错打断。
 */
export async function applyZhishuProvider(connection: ZhishuConnection) {
  const baseUrl = normalizedBaseUrl(connection);
  await prisma.$transaction(async tx => {
    await tx.providerConfig.updateMany({ where: { id: { not: ZHISHU_PROVIDER_ID } }, data: { isActive: false } });
    await tx.providerConfig.upsert({
      where: { id: ZHISHU_PROVIDER_ID },
      create: { id: ZHISHU_PROVIDER_ID, name: "AI 服务", baseUrl, textProtocol: "chat_completions", structuredOutputMode: "json_object", apiKeyEncrypted: encryptSecret(""), isActive: true },
      update: { baseUrl, textProtocol: "chat_completions", structuredOutputMode: "json_object", isActive: true },
    });
    await tx.modelProfile.deleteMany({ where: { providerConfigId: ZHISHU_PROVIDER_ID } });
    await tx.modelProfile.createMany({
      data: [
        { providerConfigId: ZHISHU_PROVIDER_ID, modelId: ZHISHU_CHAT_MODEL, label: "对话", capabilities: { text: true, vision: true, structured_output: true }, roles: {}, isDefaultAnalysis: true, isDefaultPlanning: true },
        { providerConfigId: ZHISHU_PROVIDER_ID, modelId: ZHISHU_IMAGE_MODEL, label: "生图", capabilities: { image_gen: true, image_edit: true }, roles: {}, isDefaultHeroImage: true, isDefaultDetailImage: true, isDefaultImageEdit: true },
      ],
    });
  });
}

/** 已接入但数据库里的配置缺失或地址不一致时补上（换电脑恢复数据、清空数据后都会走到）。 */
export async function ensureZhishuProvider() {
  const connection = loadZhishuConnection();
  if (!connection) return null;
  const saved = await prisma.providerConfig.findUnique({ where: { id: ZHISHU_PROVIDER_ID }, include: { models: true } });
  const fresh = saved && saved.isActive && saved.baseUrl === normalizedBaseUrl(connection) && saved.textProtocol === "chat_completions" && saved.models.length === 2;
  if (!fresh) await applyZhishuProvider(connection);
  return connection;
}

/** 用保存的密钥拉一次模型列表：401（额度上限用完除外）说明接入已在网站停止授权。 */
async function tokenRevoked(connection: ZhishuConnection) {
  let response: Response;
  try {
    response = await fetch(`${normalizedBaseUrl(connection)}/models`, { headers: { Authorization: `Bearer ${connection.api_key}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch {
    return false;
  }
  if (response.status !== 401) return false;
  const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  return body?.error?.code !== "app_quota_exhausted";
}

/** 接入状态；verify 为真时顺带确认接入还有效，失效就清掉。 */
export async function getZhishuStatus(verify: boolean): Promise<ZhishuStatus> {
  const connection = await ensureZhishuProvider();
  if (connection && verify && await tokenRevoked(connection)) {
    clearZhishuConnection();
    return status(null, "接入已失效，请回到网站重新点「一键接入」");
  }
  return status(connection);
}

/** 用接入码换调用地址和密钥。失败时把网站返回的提示原样给用户看。 */
export async function connectZhishu(rawCode: string): Promise<ZhishuStatus> {
  const match = ZHISHU_CODE_PATTERN.exec(String(rawCode ?? "").toUpperCase());
  if (!match) return status(loadZhishuConnection(), "没有识别到接入码，请回到网站重新点「一键接入」");
  let response: Response;
  try {
    response = await fetch(CONNECT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ZHISHU_APP_KEY, code: match[0] }), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    return status(loadZhishuConnection(), "网络异常，请检查网络后重试");
  }
  if (response.status === 429) return status(loadZhishuConnection(), "操作太频繁，请过几秒再试");
  const result = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: Partial<ZhishuConnection> };
  if (!result.success || !result.data?.base_url || !result.data.api_key) return status(loadZhishuConnection(), result.message || "接入失败，请稍后再试");
  const connection: ZhishuConnection = { base_url: result.data.base_url, api_key: result.data.api_key, user_name: result.data.user_name ?? "", models: result.data.models ?? [], connected_at: new Date().toISOString() };
  saveZhishuConnection(connection);
  await applyZhishuProvider(connection);
  return status(connection);
}

/** 重新接入：清掉保存的接入信息，回到接入页。 */
export function disconnectZhishu(): ZhishuStatus {
  clearZhishuConnection();
  return status(null);
}

/** 账户剩余额度（按网站的显示方式，如「¥12.35」）；没接入、网站还没有这个接口或查不到时返回空，界面就不显示。 */
export async function getZhishuBalance() {
  const connection = loadZhishuConnection();
  if (!connection) return "";
  try {
    const response = await fetch(`${siteOrigin(connection, CONNECT_URL)}/api/apps/connect/balance`, {
      method: "POST", headers: { Authorization: `Bearer ${connection.api_key}`, "Content-Type": "application/json" }, body: "{}", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return "";
    const result = await response.json() as { success?: boolean; data?: { display?: unknown } };
    return result.success && typeof result.data?.display === "string" ? result.data.display.slice(0, 40) : "";
  } catch {
    return "";
  }
}

/** 网站上本应用的最新版本号（公开接口），取不到返回空。子站用户查自己所在的网站，不引到主站。 */
export async function getLatestAppVersion() {
  const connection = loadZhishuConnection();
  if (!connection) return "";
  try {
    const response = await fetch(`${siteOrigin(connection, CONNECT_URL)}/api/apps/${ZHISHU_APP_KEY}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as { success?: boolean; data?: { version?: string } };
    return result.success ? String(result.data?.version ?? "") : "";
  } catch {
    return "";
  }
}
