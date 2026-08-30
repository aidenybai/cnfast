import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type FrozenNode } from "./capture-pages";
import { type VitalsSample, bundleImplementations, getBestVitals } from "./lib/measure-vitals";

const pagesDirectoryUrl = new URL("../bench/pages/", import.meta.url);

const getFixturePath = (pageName: string): string =>
  fileURLToPath(new URL(`${pageName}.json`, pagesDirectoryUrl));

const getAllPageNames = (): string[] => {
  const pagesDirectoryPath = fileURLToPath(pagesDirectoryUrl);
  if (!existsSync(pagesDirectoryPath)) return [];
  return readdirSync(pagesDirectoryPath)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => fileName.slice(0, -".json".length))
    .sort();
};

const requestedPageNames = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const pageNames = requestedPageNames.length > 0 ? requestedPageNames : getAllPageNames();
if (pageNames.length === 0) {
  console.error("No frozen pages found. Capture first: pnpm bench:capture");
  process.exit(1);
}

const INTERACTION_COUNT = Number(process.env.WV_INTERACTIONS ?? 8);
const RUN_COUNT = Number(process.env.WV_RUNS ?? 2);
const CPU_SLOWDOWNS = (process.env.WV_CPU_SLOWDOWN ?? "6,20")
  .split(",")
  .map((value) => Math.max(1, Number(value.trim())))
  .filter((value) => Number.isFinite(value));

const countNodes = (node: FrozenNode): number => {
  let nodeCount = 1;
  for (const childNode of node.children) nodeCount += countNodes(childNode);
  return nodeCount;
};

const createPageHtml = (cnBundle: string, frozenTreeJson: string): string => `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
  <button id="go" style="position:fixed;top:0;right:0;z-index:99999">re-render</button>
  <div id="root"></div>
  <script>${cnBundle}</script>
  <script>
    const mergeClassNames = window.__cnModule.cn;
    const frozenTree = ${frozenTreeJson};
    const rootElement = document.getElementById('root');
    let renderEpoch = 0;

    const createNodeElement = (node, isColdRender) => {
      const element = document.createElement(
        node.tag === 'html' || node.tag === 'body' ? 'div' : node.tag,
      );
      const classNames = isColdRender ? node.classes.concat('e' + renderEpoch) : node.classes;
      element.className = mergeClassNames.apply(null, classNames);
      if (node.text) element.appendChild(document.createTextNode(node.text));
      for (let childIndex = 0; childIndex < node.children.length; childIndex++) {
        element.appendChild(createNodeElement(node.children[childIndex], isColdRender));
      }
      return element;
    };

    const renderTree = (isColdRender) =>
      rootElement.replaceChildren(createNodeElement(frozenTree, isColdRender));

    performance.mark('render-start');
    renderTree(false);
    performance.mark('render-end');
    performance.measure('initial-render', 'render-start', 'render-end');

    document.getElementById('go').addEventListener('click', () => {
      renderEpoch++;
      renderTree(true);
    });
  </script>
</body></html>`;

const round = (value: number): string => value.toFixed(1);
const getSpeedup = (referenceMilliseconds: number, cnfastMilliseconds: number): string =>
  `${(referenceMilliseconds / cnfastMilliseconds).toFixed(2)}x`;

const { cnfast: cnfastBundle, reference: referenceBundle } = await bundleImplementations();

console.log(
  `Frozen-page web vitals: ${pageNames.length} real pages x slowdowns [${CPU_SLOWDOWNS.join(", ")}], ` +
    `best-of-${RUN_COUNT}, ${INTERACTION_COUNT} interactions, cnfast vs clsx+tailwind-merge ...\n`,
);

const resultRows: Record<string, unknown>[] = [];

for (const pageName of pageNames) {
  const fixturePath = getFixturePath(pageName);
  if (!existsSync(fixturePath)) {
    console.error(`Skipping "${pageName}": missing fixture (${fixturePath})`);
    continue;
  }
  const frozenTree = JSON.parse(readFileSync(fixturePath, "utf8")) as FrozenNode;
  const nodeCount = countNodes(frozenTree);
  const frozenTreeJson = JSON.stringify(frozenTree).replace(/</g, "\\u003c");
  const cnfastHtml = createPageHtml(cnfastBundle, frozenTreeJson);
  const referenceHtml = createPageHtml(referenceBundle, frozenTreeJson);

  for (const cpuSlowdown of CPU_SLOWDOWNS) {
    const options = {
      interactionCount: INTERACTION_COUNT,
      runCount: RUN_COUNT,
      cpuSlowdown,
    };
    const cnfast: VitalsSample = await getBestVitals(cnfastHtml, options);
    const reference: VitalsSample = await getBestVitals(referenceHtml, options);
    resultRows.push({
      page: pageName,
      nodes: nodeCount,
      CPU: `${cpuSlowdown}x`,
      "render f/r": `${round(cnfast.initialRenderMs)}/${round(reference.initialRenderMs)}`,
      "render x": getSpeedup(reference.initialRenderMs, cnfast.initialRenderMs),
      "LCP f/r": `${round(cnfast.lcpMs)}/${round(reference.lcpMs)}`,
      "INP f/r": `${round(cnfast.inpMs)}/${round(reference.inpMs)}`,
    });
    console.log(`  done: ${pageName} @ ${cpuSlowdown}x`);
  }
}

console.log("\n(f/r = cnfast / clsx+tailwind-merge, milliseconds; lower is better)");
console.table(resultRows);
