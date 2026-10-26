// 一键接入：AI 服务只用网站接入码换来的地址和密钥，用户不能自己配置服务商、地址、密钥和模型。
// 这个文件只读写接入信息（不碰数据库），请求凭据、后台任务都从这里取密钥。

import fs from "fs";
import path from "path";

export { ZHISHU_MANAGED_AI } from "./managed";

/** 网站上本应用的编号，接入和检查更新都用它。 */
export const ZHISHU_APP_KEY = "ktuwen26";

/** 对话写 chat、生图写 image，由平台换成当前模型，模型更新时应用不用改。 */
export const ZHISHU_CHAT_MODEL = "chat";
export const ZHISHU_IMAGE_MODEL = "image";

export const ZHISHU_CODE_PATTERN = /APP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/;

export type ZhishuConnection = {
  base_url: string;
  api_key: string;
  user_name: string;
  models: string[];
  connected_at: string;
};

const FILE_NAME = "zhishu-connection.json";

/** 桌面版放在用户数据目录；本地部署放在存储目录。 */
export function connectionPath() {
  const dir = process.env.APP_USER_DATA_DIR?.trim() || path.resolve(process.cwd(), process.env.STORAGE_ROOT || "./storage");
  return path.join(dir, FILE_NAME);
}

export function loadZhishuConnection(): ZhishuConnection | null {
  try {
    const data = JSON.parse(fs.readFileSync(connectionPath(), "utf8")) as Partial<ZhishuConnection>;
    if (!data.base_url || !data.api_key) return null;
    return data as ZhishuConnection;
  } catch {
    return null;
  }
}

export function saveZhishuConnection(connection: ZhishuConnection) {
  const file = connectionPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(connection, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function clearZhishuConnection() {
  fs.rmSync(connectionPath(), { force: true });
}

export function normalizedBaseUrl(connection: ZhishuConnection) {
  return connection.base_url.trim().replace(/\/+$/, "");
}

/** 当前接入的调用凭据；没接入时为空，调用会提示先接入。 */
export function zhishuCredentials(): { apiKey?: string; baseUrl?: string } {
  const connection = loadZhishuConnection();
  return connection ? { apiKey: connection.api_key, baseUrl: normalizedBaseUrl(connection) } : {};
}

export function siteOrigin(connection: ZhishuConnection | null, connectUrl: string) {
  const match = /^(https?:\/\/[^/]+)/.exec(connection?.base_url || connectUrl);
  return match ? match[1] : "https://zhishuhub.com";
}
