import type { Metadata } from "next";
import { ThemeToaster } from "@/components/layout/theme-toggle";

import "./globals.css";
import "@/components/editor/taobao-product-preview.css";

import { AppShell } from "@/components/layout/app-shell";
import { ProviderCredentialFetchBridge } from "@/components/layout/provider-credential-fetch-bridge";
import { ZhishuGate } from "@/components/zhishu/zhishu-gate";
import { ZHISHU_MANAGED_AI } from "@/lib/zhishu/managed";
import { ThemeScript } from "@/components/layout/theme-script";
import { BackToTopButton } from "@/components/shared/back-to-top-button";
import { BrandConsole } from "@/components/shared/brand-console";
import { ChunkReloadGuard } from "@/components/shared/chunk-reload-guard";
import { ImagePreviewProvider } from "@/components/shared/image-preview-provider";
import { TaskQueue } from "@/components/tasks/task-queue";
import { productDescription, productTitle, publicSiteUrl } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: publicSiteUrl(),
  title: { default: productTitle, template: `%s · ${ZHISHU_MANAGED_AI ? "K图" : "MxPage"}` },
  applicationName: ZHISHU_MANAGED_AI ? "K图" : "MxPage",
  keywords: ZHISHU_MANAGED_AI ? ["K图", "商K宣传", "抖音图文", "KTV排行榜", "商K推荐"] : ["MxPage", "AI电商详情页", "商品主图生成", "图片翻译", "小红书图文", "AI product images", "self-hosted"],
  authors: [{ name: "灵矩绘境", url: "https://github.com/ziguishian/MxPage" }],
  robots: { index: false, follow: false },
  openGraph: { type: "website", locale: "zh_CN", siteName: ZHISHU_MANAGED_AI ? "K图" : "MxPage", title: productTitle, description: productDescription },
  twitter: { card: "summary", title: productTitle, description: productDescription },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/brand-icon.ico",
  },
  description: productDescription,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeScript />
        <ChunkReloadGuard />
        {!ZHISHU_MANAGED_AI && <BrandConsole />}
        {!ZHISHU_MANAGED_AI && <ProviderCredentialFetchBridge />}
        {ZHISHU_MANAGED_AI ? <ZhishuGate>
          <ImagePreviewProvider>
            <AppShell>{children}</AppShell>
            <TaskQueue />
            <BackToTopButton />
          </ImagePreviewProvider>
        </ZhishuGate> : <ImagePreviewProvider>
          <AppShell>{children}</AppShell>
          <TaskQueue />
          <BackToTopButton />
        </ImagePreviewProvider>}
        <ThemeToaster />
      </body>
    </html>
  );
}
