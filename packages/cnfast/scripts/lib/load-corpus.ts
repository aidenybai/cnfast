import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ClassListArgs } from "./harvest-classes";
import type { RepoTarget } from "./clone-repo";

export interface Corpus {
  name: string;
  groups: ClassListArgs[];
}

const corporaDirectoryUrl = new URL("../../bench/corpora/", import.meta.url);
const registryPath = fileURLToPath(new URL("../../bench/repos.json", import.meta.url));

export const getCorpusPath = (corpusName: string): string =>
  fileURLToPath(new URL(`${corpusName}.json`, corporaDirectoryUrl));

export const loadRegistry = (): RepoTarget[] =>
  JSON.parse(readFileSync(registryPath, "utf8")) as RepoTarget[];

export const loadCorpora = (names?: string[]): Corpus[] => {
  const corporaDirectoryPath = fileURLToPath(corporaDirectoryUrl);
  const requestedCorpusNames =
    names && names.length > 0
      ? names
      : existsSync(corporaDirectoryPath)
        ? readdirSync(corporaDirectoryPath)
            .filter((fileName) => fileName.endsWith(".json"))
            .map((fileName) => fileName.slice(0, -".json".length))
        : [];

  const corpora: Corpus[] = [];
  for (const corpusName of requestedCorpusNames) {
    const corpusFilePath = getCorpusPath(corpusName);
    if (!existsSync(corpusFilePath)) {
      throw new Error(
        `Missing corpus "${corpusName}" (${corpusFilePath}). Run: pnpm bench:extract ${corpusName}`,
      );
    }
    corpora.push({
      name: corpusName,
      groups: JSON.parse(readFileSync(corpusFilePath, "utf8")) as ClassListArgs[],
    });
  }
  return corpora;
};
