import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export interface PageTarget {
  name: string;
  url: string;
}

// A frozen snapshot of a real rendered page: the element tree with its class
// lists and leaf text, stripped of scripts/styles/network so it replays offline.
export interface FrozenNode {
  tag: string;
  classes: string[];
  text?: string;
  children: FrozenNode[];
}

const registryPath = fileURLToPath(new URL("../bench/pages.json", import.meta.url));
const VIEWPORT = { width: 1280, height: 900 };

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../bench/pages/${name}.json`, import.meta.url));

const resolveTargets = (registry: PageTarget[]): PageTarget[] => {
  const names = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (names.length === 0) return registry;
  return names.map((name) => {
    const match = registry.find((page) => page.name === name);
    if (!match) throw new Error(`Unknown page "${name}".`);
    return match;
  });
};

const countNodes = (node: FrozenNode): number => {
  let total = 1;
  for (const child of node.children) total += countNodes(child);
  return total;
};

// Passed to page.evaluate as a string so tsx/esbuild never transforms it (a
// compiled closure references the missing `__name` helper in the page context).
const SERIALIZE_SCRIPT = `(() => {
  const MAX_TEXT = 140;
  const SKIP = new Set(["SCRIPT","STYLE","LINK","META","NOSCRIPT","TEMPLATE","SVG","PATH","IFRAME"]);
  const serialize = (element) => {
    const classAttr = element.getAttribute("class") || "";
    const node = {
      tag: element.tagName.toLowerCase(),
      classes: classAttr.trim() ? classAttr.trim().split(/\\s+/) : [],
      children: [],
    };
    const childNodes = element.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
      const child = childNodes[i];
      if (child.nodeType === 3) {
        const text = (child.textContent || "").trim();
        if (text) node.text = (node.text ? node.text + " " : "") + text;
      } else if (child.nodeType === 1 && !SKIP.has(child.tagName)) {
        node.children.push(serialize(child));
      }
    }
    if (node.text) node.text = node.text.slice(0, MAX_TEXT);
    return node;
  };
  return serialize(document.body);
})()`;

const captureTarget = async (
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  target: PageTarget,
): Promise<void> => {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.goto(target.url, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2500);

    const tree = (await page.evaluate(SERIALIZE_SCRIPT)) as FrozenNode;

    const outputPath = fixturePath(target.name);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(tree)}\n`);
    console.log(
      `[${target.name}] froze ${countNodes(tree)} nodes -> bench/pages/${target.name}.json`,
    );
  } finally {
    await page.close();
  }
};

const main = async (): Promise<void> => {
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as PageTarget[];
  const targets = resolveTargets(registry);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const failed: string[] = [];
  try {
    for (const target of targets) {
      try {
        await captureTarget(browser, target);
      } catch (error) {
        failed.push(target.name);
        console.error(
          `[${target.name}] capture failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  if (failed.length > 0) console.error(`\nSkipped ${failed.length} page(s): ${failed.join(", ")}`);
};

await main();
