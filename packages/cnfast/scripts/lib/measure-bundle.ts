import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export interface BundleResult {
  label: string;
  minified: number;
  gzipped: number;
}

export interface BundleComparison {
  cnfast: BundleResult;
  reference: BundleResult;
}

const sourceEntryPath = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
const packageDirectoryPath = fileURLToPath(new URL("../..", import.meta.url));

const measureBundle = async (label: string, source: string): Promise<BundleResult> => {
  const buildResult = await build({
    stdin: { contents: source, resolveDir: packageDirectoryPath, loader: "ts" },
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    write: false,
    legalComments: "none",
    treeShaking: true,
  });
  const bundledCode = buildResult.outputFiles[0]!.contents;
  return {
    label,
    minified: bundledCode.byteLength,
    gzipped: gzipSync(bundledCode).byteLength,
  };
};

export const measureBundles = async (): Promise<BundleComparison> => {
  const cnfast = await measureBundle(
    "cnfast",
    `export { cn } from ${JSON.stringify(sourceEntryPath)};`,
  );
  const reference = await measureBundle(
    "clsx + tailwind-merge",
    `import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs) => twMerge(clsx(inputs));`,
  );
  return { cnfast, reference };
};
