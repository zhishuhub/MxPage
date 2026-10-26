import { fail } from "@/lib/utils/route";
import { ZHISHU_MANAGED_AI } from "./connection-file";

/** 一键接入后服务商由接入决定，改服务商、探测模型、改默认模型的接口一律拒绝。 */
export function managedProviderGuard() {
  return ZHISHU_MANAGED_AI ? fail("MANAGED_PROVIDER", "AI 服务由网站接入统一提供，不能在这里修改。", null, 403) : null;
}
