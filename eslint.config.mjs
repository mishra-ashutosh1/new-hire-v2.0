import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig } from "eslint/config";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default defineConfig([
  {
    ignores: [
      "node_modules/",
      ".next/",
      "build/",
      "dist/",
      "coverage/",
      "out/",
      "next-env.d.ts",
      "*.min.js",
      ".env*",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
]);