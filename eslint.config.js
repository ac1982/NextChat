import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default [...compat.extends(
  "next/core-web-vitals",
  "prettier",
), {
  plugins: {
    "unused-imports": (await import("eslint-plugin-unused-imports")).default,
  },
  rules: {
    "unused-imports/no-unused-imports": "error",
    "@next/next/no-img-element": "off",
  },
}];