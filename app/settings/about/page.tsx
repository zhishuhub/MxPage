import { ExternalLink, Github } from "lucide-react";
import packageInfo from "@/package.json";
import { VersionCard } from "@/components/zhishu/zhishu-settings";
import { ZHISHU_SOURCE_URL, ZHISHU_UPSTREAM_URL } from "@/lib/zhishu/links";

const { version } = packageInfo;

export default function AboutPage() {
  return <div className="space-y-6"><div><p className="text-xs text-muted-foreground">应用信息</p><h1 className="mt-1 text-2xl font-semibold">关于 K图</h1></div>
    <section className="rounded-3xl border border-border p-6 sm:p-8">
      <div className="flex items-center gap-4"><img src="/brand-icon.png" alt="K图" className="h-16 w-16 rounded-2xl" /><div><h2 className="text-2xl font-semibold">K图</h2><p className="mt-1 text-sm text-muted-foreground">商K宣传图文 · v{version}</p></div></div>
      <p className="mt-6 text-sm leading-7 text-muted-foreground">按城市整理商K店名，自动生成排行榜、精选推荐、选店攻略等抖音图文，支持批量生成和定时任务。</p>
    </section>
    <VersionCard />
    <section className="space-y-4 rounded-2xl border border-border p-6"><h2 className="font-semibold">开源说明</h2><p className="text-sm leading-6 text-muted-foreground">K图基于开源项目 MxPage（灵矩绘境出品，MIT 许可）修改。修改后的源码同样公开，许可与原项目一致。</p>
      <div className="flex flex-wrap gap-2">
        <a href={ZHISHU_SOURCE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-accent"><Github className="h-4 w-4" />K图源码<ExternalLink className="h-3.5 w-3.5" /></a>
        <a href={ZHISHU_UPSTREAM_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-accent"><Github className="h-4 w-4" />原项目 MxPage<ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
    </section>
  </div>;
}
