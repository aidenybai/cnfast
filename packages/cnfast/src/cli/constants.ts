export const TARGET_PACKAGE = "cnfast";

export const MIGRATABLE_SOURCES = ["clsx", "classnames", "tailwind-merge"] as const;

export const DEFAULT_EXPORT_NAME: Record<string, string> = {
  clsx: "clsx",
  classnames: "clsx",
  "tailwind-merge": "twMerge",
};

export const SOURCE_FILE_GLOBS = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];

export const IGNORED_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.git/**",
  "**/coverage/**",
];

export const DIFF_CONTEXT_LINES = 2;
