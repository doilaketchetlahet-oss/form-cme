import { PosterScoreboardView } from "@/components/admin/PosterScoreboardView";

export default async function PosterScoreboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PosterScoreboardView formId={id} />;
}
