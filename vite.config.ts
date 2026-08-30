import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.{js,ts,tsx}": "vp check --fix",
  },
  lint: {
    ignorePatterns: ["dist", "build"],
    plugins: ["typescript"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "error",
      "no-array-constructor": "error",
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-empty-object-type": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-extra-non-null-assertion": "error",
      "@typescript-eslint/no-misused-new": "error",
      "@typescript-eslint/no-namespace": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-this-alias": "error",
      "@typescript-eslint/no-unnecessary-type-constraint": "error",
      "@typescript-eslint/no-unsafe-declaration-merging": "error",
      "@typescript-eslint/no-unsafe-function-type": "error",
      "no-unused-expressions": "error",
      "no-unused-vars": "error",
      "@typescript-eslint/no-wrapper-object-types": "error",
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/prefer-namespace-keyword": "error",
      "@typescript-eslint/triple-slash-reference": "error",
    },
    overrides: [
      {
        files: ["packages/**/*.{ts,tsx}"],
        rules: {
          "no-var": "error",
          "prefer-rest-params": "error",
          "prefer-spread": "error",
        },
      },
      {
        files: ["packages/cnfast/src/core.ts"],
        rules: {
          "prefer-rest-params": "off",
        },
      },
      {
        files: ["packages/cnfast/src/clsx.ts"],
        rules: {
          "@typescript-eslint/no-explicit-any": "off",
        },
      },
    ],
  },
  fmt: {
    semi: true,
    singleQuote: false,
    ignorePatterns: ["node_modules", "dist", "build", "pnpm-lock.yaml"],
  },
});
