import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { PublicSurveyView } from "@/components/survey/PublicSurveyView";

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("placeholder")) return null;
  return createClient(url, key);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = getServerSupabase();
  if (!supabase) return { title: "Form đăng ký - Form CME" };

  const { data: survey } = await supabase
    .from("surveys")
    .select("title, banner_url")
    .eq("id", id)
    .single();

  const title = survey?.title ?? "Form đăng ký";
  const description = "Đăng ký sự kiện và nhận mã QR check-in.";
  const ogImage = survey?.banner_url || "/window.svg";

  return {
    title: `${title} - Form CME`,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      siteName: "Form CME",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function PublicSurveyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  return <PublicSurveyView surveyId={id} preview={query.preview === "1"} />;
}
