import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { type FrozenNode } from "../scripts/capture-pages";
import { type ClassNameImplementation, keepAlive, runImplementationBenchmark } from "./lib/harness";

const pagesDirectoryPath = fileURLToPath(new URL("../bench/pages/", import.meta.url));

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const getRenderableTagName = (tag: string): string =>
  tag === "html" || tag === "body" || tag === "head" ? "div" : tag;

const createReactNode = (
  node: FrozenNode,
  implementation: ClassNameImplementation,
  key: number,
): ReactNode => {
  const tag = getRenderableTagName(node.tag);
  const className = implementation(...node.classes);
  if (VOID_TAGS.has(tag)) return createElement(tag, { key, className });
  const children: ReactNode[] = [];
  if (node.text) children.push(node.text);
  for (let index = 0; index < node.children.length; index++) {
    children.push(createReactNode(node.children[index]!, implementation, index));
  }
  return createElement(tag, { key, className }, ...children);
};

const renderReact = (frozenTree: FrozenNode, implementation: ClassNameImplementation): number =>
  renderToString(createReactNode(frozenTree, implementation, 0)).length;

const renderHtml = (frozenTree: FrozenNode, implementation: ClassNameImplementation): number => {
  let html = "";
  const appendNodeHtml = (node: FrozenNode): void => {
    const tag = getRenderableTagName(node.tag);
    html += `<${tag} class="${implementation(...node.classes)}">`;
    if (node.text) html += node.text;
    for (let index = 0; index < node.children.length; index++) {
      appendNodeHtml(node.children[index]!);
    }
    html += `</${tag}>`;
  };
  appendNodeHtml(frozenTree);
  return html.length;
};

const pageFileNames = readdirSync(pagesDirectoryPath)
  .filter((name) => name.endsWith(".json"))
  .sort();
if (pageFileNames.length === 0) {
  console.error("No frozen pages. Capture first: pnpm bench:capture");
  process.exit(1);
}

const reactRows: Record<string, unknown>[] = [];
const stringRows: Record<string, unknown>[] = [];

for (const pageFileName of pageFileNames) {
  const pageName = pageFileName.replace(".json", "");
  const frozenTree = JSON.parse(
    readFileSync(`${pagesDirectoryPath}/${pageFileName}`, "utf8"),
  ) as FrozenNode;

  const reactResult = await runImplementationBenchmark((implementation) =>
    renderReact(frozenTree, implementation),
  );
  reactRows.push({
    page: pageName,
    "cnfast renders/s": Math.round(reactResult.cnfast).toLocaleString("en-US"),
    "reference renders/s": Math.round(reactResult.reference).toLocaleString("en-US"),
    "cnfast ms": (1000 / reactResult.cnfast).toFixed(2),
    "reference ms": (1000 / reactResult.reference).toFixed(2),
    speedup: `${(reactResult.cnfast / reactResult.reference).toFixed(2)}x`,
  });

  const stringResult = await runImplementationBenchmark((implementation) =>
    renderHtml(frozenTree, implementation),
  );
  stringRows.push({
    page: pageName,
    "cnfast renders/s": Math.round(stringResult.cnfast).toLocaleString("en-US"),
    "reference renders/s": Math.round(stringResult.reference).toLocaleString("en-US"),
    speedup: `${(stringResult.cnfast / stringResult.reference).toFixed(2)}x`,
  });
}

console.log(`\nSSR throughput. cn() runs per node on every request.\n`);
console.log("== Real React renderToString (cn is a fraction of SSR work) ==");
console.table(reactRows);
console.log("== Pure HTML string build (cn-dominated: upper bound on SSR impact) ==");
console.table(stringRows);

keepAlive();
