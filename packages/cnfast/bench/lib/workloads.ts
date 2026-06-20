import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type FrozenNode } from "../../scripts/capture-pages";
import { loadCorpora } from "../../scripts/lib/load-corpus";
import { type ClassListArgs, type Impl, type Workload } from "./harness";

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")) as T;

const uniqueStringCount = (groups: ClassListArgs[]): number => {
  const unique = new Set<string>();
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]!;
    for (let inner = 0; inner < group.length; inner++) {
      const value = group[inner];
      if (typeof value === "string") unique.add(value);
    }
  }
  return unique.size;
};

// Sums `.length` of every result so the harness can defeat DCE. Splitting per arity keeps the
// `impl(...group)` spread call monomorphic-ish and mirrors how `cn` is invoked in real code.
const replayGroups =
  (groups: ClassListArgs[]) =>
  (impl: Impl): number => {
    let sink = 0;
    for (let index = 0; index < groups.length; index++) sink += impl(...groups[index]!).length;
    return sink;
  };

// micro: the two canonical extremes — cache-hit re-renders and all-miss merge engine.
export const microWorkloads = (): Workload[] => {
  const dataset = readJson<ClassListArgs[]>(
    "../../tests/tailwind-merge/tw-merge-benchmark-data.json",
  );
  const testCases = readJson<string[]>("../cases.json");
  const datasetUnique = new Set(
    dataset.map((row) => row.filter((value) => typeof value === "string").join(" ")),
  ).size;

  return [
    {
      group: "micro",
      name: "cached / re-render",
      meta: `(${dataset.length} calls, ${datasetUnique} unique)`,
      run: replayGroups(dataset),
    },
    {
      group: "micro",
      name: "uncached / merge engine",
      meta: `(${testCases.length} unique)`,
      run: (impl) => {
        let sink = 0;
        for (let index = 0; index < testCases.length; index++)
          sink += impl(testCases[index]!).length;
        return sink;
      },
    },
  ];
};

// corpus: every cn() call harvested from a real app's source, one full pass == one cold render of
// the whole app's class plumbing (mostly unique -> exercises the merge engine).
export const corpusWorkloads = (requested?: string[]): Workload[] =>
  loadCorpora(requested).map((corpus) => ({
    group: "corpus",
    name: corpus.name,
    meta: `(${corpus.groups.length} calls, ${uniqueStringCount(corpus.groups)} unique)`,
    run: replayGroups(corpus.groups),
  }));

const pagesDir = new URL("../pages/", import.meta.url);

const callSequence = (tree: FrozenNode): ClassListArgs[] => {
  const calls: ClassListArgs[] = [];
  const walk = (node: FrozenNode): void => {
    if (node.classes.length > 0) calls.push(node.classes);
    for (const child of node.children) walk(child);
  };
  walk(tree);
  return calls;
};

// page: replay each captured page's real per-render call sequence (document order, real
// duplicates) -> the authentic cache hit/miss mix a single render produces.
export const pageWorkloads = (): Workload[] => {
  const dir = fileURLToPath(pagesDir);
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
  return files.map((file) => {
    const tree = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as FrozenNode;
    const calls = callSequence(tree);
    return {
      group: "page",
      name: file.replace(".json", ""),
      meta: `(${calls.length} calls)`,
      run: replayGroups(calls),
    };
  });
};

// grid: a virtualized data grid re-rendering every frame. Classes genuinely conflict (multiple
// bg-*/text-*), so the merge engine has real work. The dynamic variant injects a live arbitrary
// value per cell -> continuous cache misses (the genuinely hard, descriptor-cache-thrashing case).
export const gridWorkloads = (): Workload[] => {
  const ROWS = Number(process.env.GRID_ROWS ?? 200);
  const COLS = Number(process.env.GRID_COLS ?? 60);
  let frame = 0;

  const renderGrid = (impl: Impl, dynamic: boolean): number => {
    let sink = 0;
    const selectedRow = frame % ROWS;
    const selectedCol = frame % COLS;
    for (let row = 0; row < ROWS; row++) {
      const isSelectedRow = row === selectedRow;
      const zebra = row % 2 === 0 ? "bg-white" : "bg-zinc-50";
      for (let col = 0; col < COLS; col++) {
        const isSelectedCell = isSelectedRow && col === selectedCol;
        const isHeader = row === 0;
        const negative = (row * 31 + col * 17) % 7 === 0;
        sink += impl(
          "px-2 py-1 border-b border-r border-zinc-200 text-sm tabular-nums truncate",
          zebra,
          isSelectedRow && "bg-sky-50",
          isSelectedCell && "bg-sky-200 ring-1 ring-sky-500",
          isHeader && "bg-zinc-100 font-semibold text-zinc-700",
          negative ? "text-red-600" : "text-zinc-900",
          dynamic && `bg-[rgb(${(row + frame) % 256}_${(col * 4) % 256}_128)]`,
        ).length;
      }
    }
    frame++;
    return sink;
  };

  return [
    {
      group: "grid",
      name: `${ROWS}x${COLS} stable`,
      meta: "(warm cache)",
      run: (impl) => renderGrid(impl, false),
    },
    {
      group: "grid",
      name: `${ROWS}x${COLS} dynamic`,
      meta: "(live arbitrary -> misses)",
      run: (impl) => renderGrid(impl, true),
    },
  ];
};
