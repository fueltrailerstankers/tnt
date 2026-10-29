import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-*/**", // NEXT_DIST_DIR build dirs of parallel test runs
      "out/**",
      "build/**",
      "next-env.d.ts",
      ".claude/worktrees/**",
      ".next-*/**",
    ],
  },
];

export default eslintConfig;
