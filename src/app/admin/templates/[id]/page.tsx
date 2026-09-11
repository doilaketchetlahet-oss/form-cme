import { EmailTemplateEditPage } from "@/components/admin/EmailTemplateEditPage";

export default async function EditEmailTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmailTemplateEditPage templateId={id} />;
}
