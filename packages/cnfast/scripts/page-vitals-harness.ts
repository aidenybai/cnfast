import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type FrozenNode } from "./capture-pages";
import { type VitalsSample, bundleImplementations, bestOfVitals } from "./lib/measure-vitals";

const pagesDir = new URL("../bench/pages/", import.meta.url);

const fixturePath = (name: string): string => fileURLToPath(new URL(`${name}.json`, pagesDir));

const listAllPages = (): string[] => {
  const dir = fileURLToPath(pagesDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
};

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const pageNames = requested.length > 0 ? requested : listAllPages();
if (pageNames.length === 0) {
  console.error("No frozen pages found. Capture first: pnpm bench:capture");
  process.exit(1);
}

const INTERACTION_COUNT = Number(process.env.WV_INTERACTIONS ?? 8);
const RUNS = Number(process.env.WV_RUNS ?? 2);
// Comma-separated CPU throttle multipliers, e.g. WV_CPU_SLOWDOWN=6,20 sweeps a
// mid-range and a very low-end device. 1 = no throttle.
const SLOWDOWNS = (process.env.WV_CPU_SLOWDOWN ?? "6,20")
  .split(",")
  .map((value) => Math.max(1, Number(value.trim())))
  .filter((value) => Number.isFinite(value));

const countNodes = (node: FrozenNode): number => {
  let total = 1;
  for (const child of node.children) total += countNodes(child);
  return total;
};

// Rebuilds the real page tree, computing every element's className via one cn()
// call over its captured class list -> cn runs once per real node, in real
// nesting. The cold re-render appends a unique token per node so the LRU misses.
const pageHtml = (cnBundle: string, treeJson: string): string => `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
  <button id="go" style="position:fixed;top:0;right:0;z-index:99999">re-render</button>
  <div id="root"></div>
  <script>${cnBundle}</script>
  <script>
    const cn = window.__cnModule.cn;
    const tree = ${treeJson};
    const root = document.getElementById('root');
    let epoch = 0;

    const build = (node, cold) => {
      const el = document.createElement(node.tag === 'html' || node.tag === 'body' ? 'div' : node.tag);
      const classes = cold ? node.classes.concat('e' + epoch) : node.classes;
      el.className = cn.apply(null, classes);
      if (node.text) el.appendChild(document.createTextNode(node.text));
      for (let i = 0; i < node.children.length; i++) el.appendChild(build(node.children[i], cold));
      return el;
    };

    const render = (cold) => root.replaceChildren(build(tree, cold));

    performance.mark('render-start');
    render(false);
    performance.mark('render-end');
    performance.measure('initial-render', 'render-start', 'render-end');

    document.getElementById('go').addEventListener('click', () => {
      epoch++;
      render(true);
    });
  </script>
</body></html>`;

const round = (value: number): string => value.toFixed(1);
const ratio = (slow: number, fast: number): string => `${(slow / fast).toFixed(2)}x`;

const { fastcn: fastcnBundle, reference: referenceBundle } = await bundleImplementations();

console.log(
  `Frozen-page web vitals: ${pageNames.length} real pages x slowdowns [${SLOWDOWNS.join(", ")}], ` +
    `best-of-${RUNS}, ${INTERACTION_COUNT} interactions, fastcn vs clsx+tailwind-merge ...\n`,
);

const rows: Record<string, unknown>[] = [];

for (const name of pageNames) {
  const path = fixturePath(name);
  if (!existsSync(path)) {
    console.error(`Skipping "${name}": missing fixture (${path})`);
    continue;
  }
  const tree = JSON.parse(readFileSync(path, "utf8")) as FrozenNode;
  const nodes = countNodes(tree);
  const treeJson = JSON.stringify(tree).replace(/</g, "\\u003c");
  const fastcnHtml = pageHtml(fastcnBundle, treeJson);
  const referenceHtml = pageHtml(referenceBundle, treeJson);

  for (const cpuSlowdown of SLOWDOWNS) {
    const options = { interactions: INTERACTION_COUNT, runs: RUNS, cpuSlowdown };
    const fastcn: VitalsSample = await bestOfVitals(fastcnHtml, options);
    const reference: VitalsSample = await bestOfVitals(referenceHtml, options);
    rows.push({
      page: name,
      nodes,
      CPU: `${cpuSlowdown}x`,
      "render f/r": `${round(fastcn.initialRenderMs)}/${round(reference.initialRenderMs)}`,
      "render x": ratio(reference.initialRenderMs, fastcn.initialRenderMs),
      "LCP f/r": `${round(fastcn.lcpMs)}/${round(reference.lcpMs)}`,
      "INP f/r": `${round(fastcn.inpMs)}/${round(reference.inpMs)}`,
    });
    console.log(`  done: ${name} @ ${cpuSlowdown}x`);
  }
}

console.log("\n(f/r = fastcn / clsx+tailwind-merge, milliseconds; lower is better)");
console.table(rows);
