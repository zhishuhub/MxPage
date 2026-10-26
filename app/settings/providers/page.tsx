import ProviderSettingsPageClient from "@/components/providers/provider-settings-page-client";
import { ZhishuSettings } from "@/components/zhishu/zhishu-settings";
import { getBillingRules } from "@/lib/monitor/billing-settings";
import { ZHISHU_MANAGED_AI } from "@/lib/zhishu/managed";

export const dynamic = "force-dynamic";

export default async function ProviderSettingsPage() {
  // 一键接入后服务商由接入决定，这里只显示接入状态
  if (ZHISHU_MANAGED_AI) return <ZhishuSettings />;
  return <ProviderSettingsPageClient billingRules={await getBillingRules()} />;
}
