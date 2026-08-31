import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type FrozenNode } from "../../scripts/capture-pages";
import { loadCorpora } from "../../scripts/lib/load-corpus";
import {
  DEFAULT_GRID_COLUMN_COUNT,
  DEFAULT_GRID_ROW_COUNT,
  UNCACHED_BENCHMARK_CASE_COUNT,
} from "../constants";
import { type ClassListArgs, type ClassNameImplementation, type Workload } from "./harness";
import { createClassListReplay } from "../utils/create-class-list-replay";

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")) as T;

const getUniqueStringCount = (groups: ClassListArgs[]): number => {
  const uniqueClassLists = new Set<string>();
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]!;
    for (let valueIndex = 0; valueIndex < group.length; valueIndex++) {
      const value = group[valueIndex];
      if (typeof value === "string") uniqueClassLists.add(value);
    }
  }
  return uniqueClassLists.size;
};

export const microWorkloads = (): Workload[] => {
  const dataset = readJson<ClassListArgs[]>(
    "../../tests/tailwind-merge/tw-merge-benchmark-data.json",
  );
  const testCases = readJson<string[]>("../cases.json");
  const uncachedTestCases: string[] = [];
  for (let index = 0; index < UNCACHED_BENCHMARK_CASE_COUNT; index++) {
    uncachedTestCases.push(`${testCases[index % testCases.length]} benchmark-miss-${index}`);
  }
  const uniqueDatasetCallCount = new Set(
    dataset.map((row) => row.filter((value) => typeof value === "string").join(" ")),
  ).size;

  return [
    {
      group: "cached",
      name: "cached / re-render",
      meta: `(${dataset.length} calls, ${uniqueDatasetCallCount} unique)`,
      classListCases: dataset,
      run: createClassListReplay(dataset),
    },
    {
      group: "uncached",
      name: "uncached / merge engine",
      meta: `(${uncachedTestCases.length} unique)`,
      classListCases: uncachedTestCases.map((classList) => [classList]),
      run: (implementation) => {
        let resultLengthSum = 0;
        for (let index = 0; index < uncachedTestCases.length; index++) {
          resultLengthSum += implementation(uncachedTestCases[index]!).length;
        }
        return resultLengthSum;
      },
    },
  ];
};

export const corpusWorkloads = (requested?: string[]): Workload[] =>
  loadCorpora(requested).map((corpus) => ({
    group: "corpus",
    name: corpus.name,
    meta: `(${corpus.groups.length} calls, ${getUniqueStringCount(corpus.groups)} unique)`,
    classListCases: corpus.groups,
    run: createClassListReplay(corpus.groups),
  }));

const pagesDirectoryUrl = new URL("../pages/", import.meta.url);

const getClassListCalls = (tree: FrozenNode): ClassListArgs[] => {
  const classListCalls: ClassListArgs[] = [];
  const collectClassListCalls = (node: FrozenNode): void => {
    if (node.classes.length > 0) classListCalls.push(node.classes);
    for (const childNode of node.children) collectClassListCalls(childNode);
  };
  collectClassListCalls(tree);
  return classListCalls;
};

export const pageWorkloads = (): Workload[] => {
  const pagesDirectoryPath = fileURLToPath(pagesDirectoryUrl);
  let pageFileNames: string[];
  try {
    pageFileNames = readdirSync(pagesDirectoryPath)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
  return pageFileNames.map((pageFileName) => {
    const frozenTree = JSON.parse(
      readFileSync(`${pagesDirectoryPath}/${pageFileName}`, "utf8"),
    ) as FrozenNode;
    const classListCalls = getClassListCalls(frozenTree);
    return {
      group: "page",
      name: pageFileName.replace(".json", ""),
      meta: `(${classListCalls.length} calls)`,
      classListCases: classListCalls,
      run: createClassListReplay(classListCalls),
    };
  });
};

export const gridWorkloads = (): Workload[] => {
  const gridRowCount = Number(process.env.GRID_ROWS ?? DEFAULT_GRID_ROW_COUNT);
  const gridColumnCount = Number(process.env.GRID_COLS ?? DEFAULT_GRID_COLUMN_COUNT);
  const frameIndexes = new WeakMap<ClassNameImplementation, number>();

  const renderGrid = (
    implementation: ClassNameImplementation,
    hasDynamicClassNames: boolean,
  ): number => {
    const frameIndex = frameIndexes.get(implementation) ?? 0;
    let resultLengthSum = 0;
    const selectedRowIndex = frameIndex % gridRowCount;
    const selectedColumnIndex = frameIndex % gridColumnCount;
    for (let rowIndex = 0; rowIndex < gridRowCount; rowIndex++) {
      const isSelectedRow = rowIndex === selectedRowIndex;
      const rowBackgroundClassName = rowIndex % 2 === 0 ? "bg-white" : "bg-zinc-50";
      for (let columnIndex = 0; columnIndex < gridColumnCount; columnIndex++) {
        const isSelectedCell = isSelectedRow && columnIndex === selectedColumnIndex;
        const isHeaderRow = rowIndex === 0;
        const isNegativeCell = (rowIndex * 31 + columnIndex * 17) % 7 === 0;
        resultLengthSum += implementation(
          "px-2 py-1 border-b border-r border-zinc-200 text-sm tabular-nums truncate",
          rowBackgroundClassName,
          isSelectedRow && "bg-sky-50",
          isSelectedCell && "bg-sky-200 ring-1 ring-sky-500",
          isHeaderRow && "bg-zinc-100 font-semibold text-zinc-700",
          isNegativeCell ? "text-red-600" : "text-zinc-900",
          hasDynamicClassNames &&
            `bg-[rgb(${(rowIndex + frameIndex) % 256}_${(columnIndex * 4) % 256}_128)]`,
        ).length;
      }
    }
    frameIndexes.set(implementation, frameIndex + 1);
    return resultLengthSum;
  };

  return [
    {
      group: "grid",
      name: `${gridRowCount}x${gridColumnCount} stable`,
      meta: "(warm cache)",
      run: (implementation) => renderGrid(implementation, false),
    },
    {
      group: "grid",
      name: `${gridRowCount}x${gridColumnCount} dynamic`,
      meta: "(live arbitrary -> misses)",
      run: (implementation) => renderGrid(implementation, true),
    },
  ];
};
