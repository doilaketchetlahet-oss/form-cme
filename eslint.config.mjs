import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prebuilt/vendor bundles served as static files (EventPlay studio, pdf.js...).
    "public/**",
    // EventPlay studio static export (served by the auth-gated route handler).
    "studio/**",
    // Standalone Node scripts (CommonJS by design).
    "scripts/**",
  ]),
]);

export default eslintConfig;
