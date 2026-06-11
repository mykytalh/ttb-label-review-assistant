import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Build output, deps, coverage, and Next's auto-generated type shim.
    ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
