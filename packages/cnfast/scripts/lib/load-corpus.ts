import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ClassListArgs } from "./harvest-classes";
import type { RepoTarget } from "./clone-repo";

export interface Corpus {
  name: string;
  groups: ClassListArgs[];
}

const corporaDir = new URL("../../bench/corpora/", import.meta.url);
const registryPath = fileURLToPath(new URL("../../bench/repos.json", import.meta.url));

export const corpusPath = (name: string): string =>
  fileURLToPath(new URL(`${name}.json`, corporaDir));

export const loadRegistry = (): RepoTarget[] =>
  JSON.parse(readFileSync(registryPath, "utf8")) as RepoTarget[];

// Loads named corpora, or every *.json under bench/corpora when none requested.
export const loadCorpora = (names?: string[]): Corpus[] => {
  const dir = fileURLToPath(corporaDir);
  const wanted =
    names && names.length > 0
      ? names
      : existsSync(dir)
        ? readdirSync(dir)
            .filter((file) => file.endsWith(".json"))
            .map((file) => file.slice(0, -".json".length))
        : [];

  const corpora: Corpus[] = [];
  for (const name of wanted) {
    const path = corpusPath(name);
    if (!existsSync(path)) {
      throw new Error(`Missing corpus "${name}" (${path}). Run: pnpm bench:extract ${name}`);
    }
    corpora.push({ name, groups: JSON.parse(readFileSync(path, "utf8")) as ClassListArgs[] });
  }
  return corpora;
};
