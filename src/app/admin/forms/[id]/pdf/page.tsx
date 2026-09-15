import { InvitePdfPage } from "@/components/admin/InvitePdfPage";

export default async function FormPdfPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvitePdfPage formId={id} />;
}
