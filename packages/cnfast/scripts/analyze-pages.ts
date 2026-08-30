import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type FrozenNode } from "./capture-pages";

const pagesDirectoryPath = fileURLToPath(new URL("../bench/pages/", import.meta.url));

const walkNodes = (node: FrozenNode, onNode: (node: FrozenNode) => void): void => {
  onNode(node);
  for (const child of node.children) walkNodes(child, onNode);
};

const CACHE_ENTRY_COUNT = 500;

const pageAnalysisRows: Record<string, unknown>[] = [];
for (const pageFileName of readdirSync(pagesDirectoryPath)
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  const frozenTree = JSON.parse(
    readFileSync(`${pagesDirectoryPath}/${pageFileName}`, "utf8"),
  ) as FrozenNode;

  let nodeCount = 0;
  let nodeWithClassesCount = 0;
  let totalTokenCount = 0;
  const uniqueClassLists = new Set<string>();
  const classTokenCounts = new Map<string, number>();

  walkNodes(frozenTree, (node) => {
    nodeCount++;
    if (node.classes.length === 0) return;
    nodeWithClassesCount++;
    totalTokenCount += node.classes.length;
    uniqueClassLists.add(node.classes.join(" "));
    for (const classToken of node.classes) {
      classTokenCounts.set(classToken, (classTokenCounts.get(classToken) ?? 0) + 1);
    }
  });

  const compulsoryMissCount = Math.min(uniqueClassLists.size, nodeWithClassesCount);
  const estimatedHitRate =
    nodeWithClassesCount > 0 ? 1 - compulsoryMissCount / nodeWithClassesCount : 0;

  pageAnalysisRows.push({
    page: pageFileName.replace(".json", ""),
    nodes: nodeCount,
    "nodes w/ class": nodeWithClassesCount,
    "unique strings": uniqueClassLists.size,
    "uniq <= cache?": uniqueClassLists.size <= CACHE_ENTRY_COUNT ? "yes" : "no",
    "string hit-rate": `${(estimatedHitRate * 100).toFixed(1)}%`,
    "unique tokens": classTokenCounts.size,
    "avg tokens/node": (totalTokenCount / Math.max(1, nodeWithClassesCount)).toFixed(1),
  });
}

if (!existsSync(pagesDirectoryPath) || pageAnalysisRows.length === 0) {
  console.error("No frozen pages. Capture first: pnpm bench:capture");
  process.exit(1);
}

console.log("Class-string reuse in real captured pages (1 cn() call per node):\n");
console.table(pageAnalysisRows);
