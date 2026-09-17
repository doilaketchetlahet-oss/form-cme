import { NextRequest, NextResponse } from "next/server";
import { qrRenderStyle, renderQrPng, renderQrSvg } from "@/lib/server/qr-image";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("data");
  const sizeParam = Number(request.nextUrl.searchParams.get("size") || "220");
  const size = Math.max(160, Math.min(Number.isFinite(sizeParam) ? sizeParam : 220, 520));
  const format = request.nextUrl.searchParams.get("format") === "png" ? "png" : "svg";
  const style = qrRenderStyle({
    darkColor: request.nextUrl.searchParams.get("dark"),
    accentColor: request.nextUrl.searchParams.get("accent"),
    lightColor: request.nextUrl.searchParams.get("light"),
    logoEnabled: request.nextUrl.searchParams.get("logo") !== "0",
    logoUrl: request.nextUrl.searchParams.get("logoUrl"),
    logoSize: Number(request.nextUrl.searchParams.get("logoSize") || "24"),
    moduleRadius: Number(request.nextUrl.searchParams.get("radius") || "32"),
  });

  if (!value) {
    return NextResponse.json({ error: "Missing QR data" }, { status: 400 });
  }

  const cacheHeaders = { "Cache-Control": "public, max-age=31536000, immutable" };

  // Outlook on Windows cannot render SVG, so email clients use format=png.
  if (format === "png") {
    const png = await renderQrPng(value, size, style);
    return new NextResponse(new Uint8Array(png), {
      headers: { ...cacheHeaders, "Content-Type": "image/png" },
    });
  }

  const svg = await renderQrSvg(value, size, style);
  return new NextResponse(svg, {
    headers: { ...cacheHeaders, "Content-Type": "image/svg+xml; charset=utf-8" },
  });
}
