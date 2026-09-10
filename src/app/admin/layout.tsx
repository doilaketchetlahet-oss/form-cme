import { AuthGuard } from "@/components/auth/AuthGuard";
import { AdminShell } from "@/components/admin/AdminShell";
import { BackgroundMesh } from "@/components/ui/BackgroundMesh";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <BackgroundMesh />
      <AdminShell>{children}</AdminShell>
    </AuthGuard>
  );
}
