import { EmailTemplatePage } from "@/components/admin/EmailTemplatePage";

export default async function FormEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmailTemplatePage formId={id} />;
}
