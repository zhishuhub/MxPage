import { ManagedRedirect } from "@/lib/zhishu/managed-redirect";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ManagedRedirect>{children}</ManagedRedirect>;
}
