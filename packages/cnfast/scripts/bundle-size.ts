import { measureBundles } from "./lib/measure-bundle";

const formatBytes = (bytes: number): string => `${(bytes / 1024).toFixed(2)} kB`;

const { cnfast, reference } = await measureBundles();

console.table(
  [cnfast, reference].map((entry) => ({
    bundle: entry.label,
    minified: formatBytes(entry.minified),
    "min+gzip": formatBytes(entry.gzipped),
  })),
);

const gzipRatio = reference.gzipped / cnfast.gzipped;
const savedBytes = reference.gzipped - cnfast.gzipped;
console.log(
  `\ncnfast is ${formatBytes(savedBytes)} ${savedBytes >= 0 ? "smaller" : "larger"} gzipped (${gzipRatio.toFixed(2)}x vs clsx + tailwind-merge)`,
);
