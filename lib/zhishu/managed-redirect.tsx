import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ZHISHU_MANAGED_AI } from "./managed";

/** K图：原项目的详情页、翻译、小红书、Agent 等页面不开放，用地址打开时跳回商K宣传。 */
export function ManagedRedirect({ children }: { children: ReactNode }) {
  if (ZHISHU_MANAGED_AI) redirect("/ktu");
  return <>{children}</>;
}
