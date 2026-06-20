import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type FrozenNode } from "./capture-pages";

const pagesDir = fileURLToPath(new URL("../bench/pages/", import.meta.url));

const walk = (node: FrozenNode, onNode: (node: FrozenNode) => void): void => {
  onNode(node);
  for (const child of node.children) walk(child, onNode);
};

const CACHE_SIZE = 500;

const rows: Record<string, unknown>[] = [];
for (const file of readdirSync(pagesDir)
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  const tree = JSON.parse(readFileSync(`${pagesDir}/${file}`, "utf8")) as FrozenNode;

  let nodes = 0;
  let withClasses = 0;
  let totalTokens = 0;
  const uniqueStrings = new Set<string>();
  const tokenCounts = new Map<string, number>();

  walk(tree, (node) => {
    nodes++;
    if (node.classes.length === 0) return;
    withClasses++;
    totalTokens += node.classes.length;
    uniqueStrings.add(node.classes.join(" "));
    for (const token of node.classes) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  });

  // Cache-hit rate for a one-pass render with a 500-entry whole-string LRU:
  // the first time each unique string appears it misses, every repeat hits.
  const misses = Math.min(uniqueStrings.size, withClasses);
  const hitRate = withClasses > 0 ? 1 - misses / withClasses : 0;

  rows.push({
    page: file.replace(".json", ""),
    nodes,
    "nodes w/ class": withClasses,
    "unique strings": uniqueStrings.size,
    "uniq <= cache?": uniqueStrings.size <= CACHE_SIZE ? "yes" : "no",
    "string hit-rate": `${(hitRate * 100).toFixed(1)}%`,
    "unique tokens": tokenCounts.size,
    "avg tokens/node": (totalTokens / Math.max(1, withClasses)).toFixed(1),
  });
}

if (!existsSync(pagesDir) || rows.length === 0) {
  console.error("No frozen pages. Capture first: pnpm bench:capture");
  process.exit(1);
}

console.log("Class-string reuse in real captured pages (1 cn() call per node):\n");
console.table(rows);
