import { KtuRecords } from "@/components/ktu/ktu-records";

export const metadata = { title: "我的作品" };

export default function KtuWorksPage() {
  return <section className="mx-auto max-w-5xl space-y-6 py-2">
    <header><p className="text-sm text-muted-foreground">我的作品</p><h1 className="mt-2 text-3xl font-semibold">生成过的图文</h1></header>
    <KtuRecords pageSize={30} title="全部图文" />
  </section>;
}
