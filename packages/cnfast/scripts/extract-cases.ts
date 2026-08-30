import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { glob } from "tinyglobby";
import { type ClassListArgs, harvestClassGroups } from "./lib/harvest-classes";
import { type RepoTarget, ensureRepo } from "./lib/clone-repo";
import { getCorpusPath, loadRegistry } from "./lib/load-corpus";

const DEFAULT_SOURCE_GLOBS = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue,svelte,astro,html,mdx}"];
const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/coverage/**",
  "**/*.d.ts",
];

const getRequestedTargets = (repositoryRegistry: RepoTarget[]): RepoTarget[] => {
  const argumentsList = process.argv.slice(2);
  const urlIndex = argumentsList.indexOf("--url");
  if (urlIndex !== -1) {
    const repositoryUrl = argumentsList[urlIndex + 1];
    const nameIndex = argumentsList.indexOf("--name");
    const repositoryName = nameIndex !== -1 ? argumentsList[nameIndex + 1] : undefined;
    if (!repositoryUrl || !repositoryName) {
      throw new Error("--url requires both --url <git-url> and --name <slug>");
    }
    return [{ name: repositoryName, url: repositoryUrl }];
  }

  const requestedRepositoryNames = argumentsList.filter((argument) => !argument.startsWith("--"));
  if (requestedRepositoryNames.length === 0) return repositoryRegistry;
  return requestedRepositoryNames.map((repositoryName) => {
    const matchingTarget = repositoryRegistry.find(
      (repository) => repository.name === repositoryName,
    );
    if (!matchingTarget) {
      throw new Error(
        `Unknown repo "${repositoryName}". Known: ${repositoryRegistry.map((repository) => repository.name).join(", ")}`,
      );
    }
    return matchingTarget;
  });
};

const extractTarget = async (target: RepoTarget): Promise<void> => {
  const sourceDirectoryPath = ensureRepo(target);
  console.log(`Scanning ${sourceDirectoryPath} ...`);

  const sourceFilePaths = await glob(target.paths ?? DEFAULT_SOURCE_GLOBS, {
    cwd: sourceDirectoryPath,
    absolute: true,
    ignore: IGNORE_GLOBS,
  });

  const classGroups = new Map<string, ClassListArgs>();
  let scannedFileCount = 0;
  let matchedFileCount = 0;
  for (const sourceFilePath of sourceFilePaths) {
    let source: string;
    try {
      source = readFileSync(sourceFilePath, "utf8");
    } catch {
      continue;
    }
    scannedFileCount++;
    if (harvestClassGroups(source, classGroups)) matchedFileCount++;
  }

  const classListCases = [...classGroups.values()].sort((left, right) =>
    left.join(" ").localeCompare(right.join(" ")),
  );
  const outputPath = getCorpusPath(target.name);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(classListCases)}\n`);

  const totalStringCount = classListCases.reduce(
    (stringCount, classList) => stringCount + classList.length,
    0,
  );
  console.log(
    `[${target.name}] ${classListCases.length} class groups (${totalStringCount} strings) ` +
      `from ${matchedFileCount}/${scannedFileCount} files -> bench/corpora/${target.name}.json\n`,
  );
};

const extractRequestedTargets = async (): Promise<void> => {
  const repositoryTargets = getRequestedTargets(loadRegistry());
  const failedRepositoryNames: string[] = [];
  for (const target of repositoryTargets) {
    try {
      await extractTarget(target);
    } catch (error) {
      failedRepositoryNames.push(target.name);
      console.error(`[${target.name}] failed: ${error instanceof Error ? error.message : error}\n`);
    }
  }
  if (failedRepositoryNames.length > 0) {
    console.error(
      `Skipped ${failedRepositoryNames.length} repo(s): ${failedRepositoryNames.join(", ")}`,
    );
  }
};

await extractRequestedTargets();
