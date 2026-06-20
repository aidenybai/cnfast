import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { glob } from "tinyglobby";
import { type ClassListArgs, harvestClassGroups } from "./lib/harvest-classes";
import { type RepoTarget, ensureRepo } from "./lib/clone-repo";
import { corpusPath, loadRegistry } from "./lib/load-corpus";

const DEFAULT_SOURCE_GLOBS = ["**/*.{ts,tsx,js,jsx}"];
const IGNORE_GLOBS = ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/*.d.ts"];

// Parses `extract-cases.ts [name ...]` and `--url <url> --name <name>`. With no
// args it extracts every repo in bench/repos.json.
const resolveTargets = (registry: RepoTarget[]): RepoTarget[] => {
  const argv = process.argv.slice(2);
  const urlIndex = argv.indexOf("--url");
  if (urlIndex !== -1) {
    const url = argv[urlIndex + 1];
    const nameIndex = argv.indexOf("--name");
    const name = nameIndex !== -1 ? argv[nameIndex + 1] : undefined;
    if (!url || !name) throw new Error("--url requires both --url <git-url> and --name <slug>");
    return [{ name, url }];
  }

  const names = argv.filter((arg) => !arg.startsWith("--"));
  if (names.length === 0) return registry;
  return names.map((name) => {
    const match = registry.find((repo) => repo.name === name);
    if (!match) {
      throw new Error(
        `Unknown repo "${name}". Known: ${registry.map((repo) => repo.name).join(", ")}`,
      );
    }
    return match;
  });
};

const extractTarget = async (target: RepoTarget): Promise<void> => {
  const sourceDir = ensureRepo(target);
  console.log(`Scanning ${sourceDir} ...`);

  const files = await glob(target.paths ?? DEFAULT_SOURCE_GLOBS, {
    cwd: sourceDir,
    absolute: true,
    ignore: IGNORE_GLOBS,
  });

  const groups = new Map<string, ClassListArgs>();
  let scannedFiles = 0;
  for (const file of files) {
    let contents: string;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!contents.includes("className") && !contents.includes("cn(")) continue;
    harvestClassGroups(contents, groups);
    scannedFiles++;
  }

  const cases = [...groups.values()].sort((left, right) =>
    left.join(" ").localeCompare(right.join(" ")),
  );
  const outputPath = corpusPath(target.name);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(cases)}\n`);

  const totalStrings = cases.reduce((sum, group) => sum + group.length, 0);
  console.log(
    `[${target.name}] ${cases.length} cn-call groups (${totalStrings} strings) ` +
      `from ${scannedFiles}/${files.length} files -> bench/corpora/${target.name}.json\n`,
  );
};

const main = async (): Promise<void> => {
  const targets = resolveTargets(loadRegistry());
  const failed: string[] = [];
  for (const target of targets) {
    try {
      await extractTarget(target);
    } catch (error) {
      failed.push(target.name);
      console.error(`[${target.name}] failed: ${error instanceof Error ? error.message : error}\n`);
    }
  }
  if (failed.length > 0) console.error(`Skipped ${failed.length} repo(s): ${failed.join(", ")}`);
};

await main();
