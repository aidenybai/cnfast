import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { type FrozenNode } from "../scripts/capture-pages";
import { benchRun, type Impl, keepAlive } from "./lib/harness";

const pagesDir = fileURLToPath(new URL("../bench/pages/", import.meta.url));

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
const remapTag = (tag: string): string =>
  tag === "html" || tag === "body" || tag === "head" ? "div" : tag;

const toReact = (node: FrozenNode, impl: Impl, key: number): ReactNode => {
  const tag = remapTag(node.tag);
  const className = impl(...node.classes);
  if (VOID_TAGS.has(tag)) return createElement(tag, { key, className });
  const children: ReactNode[] = [];
  if (node.text) children.push(node.text);
  for (let index = 0; index < node.children.length; index++) {
    children.push(toReact(node.children[index]!, impl, index));
  }
  return createElement(tag, { key, className }, ...children);
};

const renderReact = (tree: FrozenNode, impl: Impl): number =>
  renderToString(toReact(tree, impl, 0)).length;

const renderHtml = (tree: FrozenNode, impl: Impl): number => {
  let html = "";
  const walk = (node: FrozenNode): void => {
    const tag = remapTag(node.tag);
    html += `<${tag} class="${impl(...node.classes)}">`;
    if (node.text) html += node.text;
    for (let index = 0; index < node.children.length; index++) walk(node.children[index]!);
    html += `</${tag}>`;
  };
  walk(tree);
  return html.length;
};

const files = readdirSync(pagesDir)
  .filter((name) => name.endsWith(".json"))
  .sort();
if (files.length === 0) {
  console.error("No frozen pages. Capture first: pnpm bench:capture");
  process.exit(1);
}

const reactRows: Record<string, unknown>[] = [];
const stringRows: Record<string, unknown>[] = [];

for (const file of files) {
  const page = file.replace(".json", "");
  const tree = JSON.parse(readFileSync(`${pagesDir}/${file}`, "utf8")) as FrozenNode;

  const react = await benchRun((impl) => renderReact(tree, impl));
  reactRows.push({
    page,
    "cnfast renders/s": Math.round(react.cnfast).toLocaleString("en-US"),
    "reference renders/s": Math.round(react.reference).toLocaleString("en-US"),
    "cnfast ms": (1000 / react.cnfast).toFixed(2),
    "reference ms": (1000 / react.reference).toFixed(2),
    speedup: `${(react.cnfast / react.reference).toFixed(2)}x`,
  });

  const string = await benchRun((impl) => renderHtml(tree, impl));
  stringRows.push({
    page,
    "cnfast renders/s": Math.round(string.cnfast).toLocaleString("en-US"),
    "reference renders/s": Math.round(string.reference).toLocaleString("en-US"),
    speedup: `${(string.cnfast / string.reference).toFixed(2)}x`,
  });
}

console.log(`\nSSR throughput. cn() runs per node on every request.\n`);
console.log("== Real React renderToString (cn is a fraction of SSR work) ==");
console.table(reactRows);
console.log("== Pure HTML string build (cn-dominated: upper bound on SSR impact) ==");
console.table(stringRows);

keepAlive();
