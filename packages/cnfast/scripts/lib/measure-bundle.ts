import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export interface BundleResult {
  label: string;
  minified: number;
  gzipped: number;
}

export interface BundleComparison {
  fastcn: BundleResult;
  reference: BundleResult;
}

const sourceEntry = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
const resolveDir = fileURLToPath(new URL("../..", import.meta.url));

const measure = async (label: string, contents: string): Promise<BundleResult> => {
  const result = await build({
    stdin: { contents, resolveDir, loader: "ts" },
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    write: false,
    legalComments: "none",
    treeShaking: true,
  });
  const code = result.outputFiles[0]!.contents;
  return { label, minified: code.byteLength, gzipped: gzipSync(code).byteLength };
};

export const measureBundles = async (): Promise<BundleComparison> => {
  const fastcn = await measure("cnfast", `export { cn } from ${JSON.stringify(sourceEntry)};`);
  const reference = await measure(
    "clsx + tailwind-merge",
    `import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs) => twMerge(clsx(inputs));`,
  );
  return { fastcn, reference };
};
