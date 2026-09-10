import { FormReportView } from "@/components/admin/FormReportView";

export default async function FormReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormReportView formId={id} />;
}
