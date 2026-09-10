import { FormEditorPage } from "@/components/admin/FormEditorPage";

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormEditorPage formId={id} />;
}
