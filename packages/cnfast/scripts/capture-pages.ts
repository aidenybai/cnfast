import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { CAPTURE_VIEWPORT, NAVIGATION_TIMEOUT_MS, PAGE_SETTLE_TIME_MS } from "./constants";

export interface PageTarget {
  name: string;
  url: string;
}

export interface FrozenNode {
  tag: string;
  classes: string[];
  text?: string;
  children: FrozenNode[];
}

const registryPath = fileURLToPath(new URL("../bench/pages.json", import.meta.url));

const getFixturePath = (pageName: string): string =>
  fileURLToPath(new URL(`../bench/pages/${pageName}.json`, import.meta.url));

const getRequestedTargets = (pageRegistry: PageTarget[]): PageTarget[] => {
  const requestedPageNames = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (requestedPageNames.length === 0) return pageRegistry;
  return requestedPageNames.map((pageName) => {
    const matchingTarget = pageRegistry.find((page) => page.name === pageName);
    if (!matchingTarget) throw new Error(`Unknown page "${pageName}".`);
    return matchingTarget;
  });
};

const countNodes = (node: FrozenNode): number => {
  let nodeCount = 1;
  for (const childNode of node.children) nodeCount += countNodes(childNode);
  return nodeCount;
};

const SERIALIZE_SCRIPT = `(() => {
  const MAX_TEXT_LENGTH = 140;
  const SKIPPED_TAG_NAMES = new Set(["SCRIPT","STYLE","LINK","META","NOSCRIPT","TEMPLATE","SVG","PATH","IFRAME"]);
  const serializeElement = (element) => {
    const classAttribute = element.getAttribute("class") || "";
    const serializedNode = {
      tag: element.tagName.toLowerCase(),
      classes: classAttribute.trim() ? classAttribute.trim().split(/\\s+/) : [],
      children: [],
    };
    const childNodes = element.childNodes;
    for (let childIndex = 0; childIndex < childNodes.length; childIndex++) {
      const childNode = childNodes[childIndex];
      if (childNode.nodeType === 3) {
        const text = (childNode.textContent || "").trim();
        if (text) {
          serializedNode.text = (serializedNode.text ? serializedNode.text + " " : "") + text;
        }
      } else if (childNode.nodeType === 1 && !SKIPPED_TAG_NAMES.has(childNode.tagName)) {
        serializedNode.children.push(serializeElement(childNode));
      }
    }
    if (serializedNode.text) {
      serializedNode.text = serializedNode.text.slice(0, MAX_TEXT_LENGTH);
    }
    return serializedNode;
  };
  return serializeElement(document.body);
})()`;

const capturePageTarget = async (
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  target: PageTarget,
): Promise<void> => {
  const page = await browser.newPage({ viewport: CAPTURE_VIEWPORT });
  try {
    await page.goto(target.url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(PAGE_SETTLE_TIME_MS);

    const frozenTree = (await page.evaluate(SERIALIZE_SCRIPT)) as FrozenNode;

    const outputPath = getFixturePath(target.name);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(frozenTree)}\n`);
    console.log(
      `[${target.name}] froze ${countNodes(frozenTree)} nodes -> bench/pages/${target.name}.json`,
    );
  } finally {
    await page.close();
  }
};

const captureRequestedPages = async (): Promise<void> => {
  const pageRegistry = JSON.parse(readFileSync(registryPath, "utf8")) as PageTarget[];
  const pageTargets = getRequestedTargets(pageRegistry);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const failedPageNames: string[] = [];
  try {
    for (const target of pageTargets) {
      try {
        await capturePageTarget(browser, target);
      } catch (error) {
        failedPageNames.push(target.name);
        console.error(
          `[${target.name}] capture failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  if (failedPageNames.length > 0) {
    console.error(`\nSkipped ${failedPageNames.length} page(s): ${failedPageNames.join(", ")}`);
  }
};

await captureRequestedPages();
