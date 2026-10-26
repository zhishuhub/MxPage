import { redirect } from "next/navigation";
import { HomeCreateWorkspace } from "@/components/projects/home-create-workspace";
import { ZHISHU_MANAGED_AI } from "@/lib/zhishu/managed";
export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: { batch?: string } }) {
  if (ZHISHU_MANAGED_AI) redirect("/ktu");
  return (
    <div className="space-y-6" data-home-workspace>
      <HomeCreateWorkspace key={searchParams.batch || "new"} initialBatch={!!searchParams.batch} />
    </div>
  );
}
