import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // `new Date().toISOString().slice(0, 10)` is the UTC date, a day behind
    // Athens between 00:00 and 03:00. Use todayAthens()/currentMonthKey()
    // for "now" and toIso() for UTC-midnight dates, all in src/lib/dates.ts.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(slice|substring|substr|split)$/] > MemberExpression.callee > CallExpression.object[callee.property.name='toISOString']",
          message: "toISOString().slice() gives the UTC date. Use todayAthens()/currentMonthKey()/toIso() from @/lib/dates.",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "cloudflare-env.d.ts",
    "src/lib/db/types.ts",
    // Copied from node_modules by scripts/copy-excalidraw-assets.mjs.
    "public/pdfjs/**",
    "public/excalidraw-assets/**",
  ]),
]);
