import type { Metadata } from "next";
import { PublicBoothMapView } from "@/components/booth/PublicBoothMapView";

export const metadata: Metadata = {
  title: "Sơ đồ vị trí gian hàng | I-solution Manager",
  description: "Tra cứu vị trí gian hàng, công ty và khu vực trên sơ đồ sự kiện.",
  robots: { index: false, follow: false },
};

export default async function SharedBoothMapPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicBoothMapView token={token} />;
}
