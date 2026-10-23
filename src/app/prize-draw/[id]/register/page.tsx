import { PrizeRegistration } from "@/components/prize/PrizeRegistration";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PrizeRegistration id={(await params).id} />;
}
