import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // The `_` prefix is this codebase's convention for deliberately unused
      // bindings (dropped rest-destructure keys, ignored params).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist-desktop/**",
      "build/**",
      "public/**",
      "graphify-out/**",
      "electron/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
