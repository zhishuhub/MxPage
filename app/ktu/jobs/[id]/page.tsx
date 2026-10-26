import { KtuJobView } from "@/components/ktu/ktu-job-view";

export const metadata = { title: "图文详情" };

export default function KtuJobPage({ params }: { params: { id: string } }) {
  return <KtuJobView jobId={params.id} />;
}
