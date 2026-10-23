import { PrizeDrawPlayer } from "@/components/prize/PrizeDrawPlayer";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PrizeDrawPlayer id={(await params).id} />;
}
