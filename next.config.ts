import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compress responses
  compress: true,

  // Optimize images
  images: {
    formats: ["image/avif", "image/webp"],
  },

  // Keep sharp native binaries external to the server bundle
  serverExternalPackages: ["sharp", "nodemailer", "@vladmandic/human"],

  // sharp loads its linux binaries via dynamic require, which file tracing
  // cannot follow. Include them (and the overlay fonts) in the lambdas that
  // compose invitation images.
  outputFileTracingIncludes: {
    "/api/qr": ["./node_modules/@img/**", "./public/logo_qr.png"],
    "/api/send-checkin-email": ["./node_modules/@img/**", "./public/fonts/**", "./public/logo_qr.png"],
    "/api/admin/forms/[id]/email/test": ["./node_modules/@img/**", "./public/fonts/**", "./public/logo_qr.png"],
    "/api/cron/email-campaigns": ["./node_modules/@img/**", "./public/fonts/**", "./public/logo_qr.png"],
    // Static EventPlay bundle served by the auth-gated studio route.
    "/studio/[[...slug]]": ["./studio/**"],
  },

  // Experimental: optimize package imports (tree-shake heavy libs)
  experimental: {
    optimizePackageImports: [
      "framer-motion",
      "lucide-react",
      "recharts",
      "@supabase/supabase-js",
    ],
  },
};

export default nextConfig;
