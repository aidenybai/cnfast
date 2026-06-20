import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface RepoTarget {
  name: string;
  url: string;
  ref?: string;
  paths?: string[];
}

const cacheRoot = new URL("../../.cache/", import.meta.url);

const envOverride = (name: string): string | undefined =>
  process.env[`REPO_DIR_${name.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`];

// Resolves a repo to a local source directory, cloning it shallow + blobless on
// first use (cached under .cache/<name>). An env override REPO_DIR_<NAME> points
// at an existing checkout to skip cloning entirely.
export const ensureRepo = (target: RepoTarget): string => {
  const override = envOverride(target.name);
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`REPO_DIR override for ${target.name} points at a missing path: ${override}`);
    }
    return override;
  }

  const checkoutDir = fileURLToPath(new URL(target.name, cacheRoot));
  if (existsSync(checkoutDir)) {
    console.log(`Using cached checkout: ${checkoutDir}`);
    return checkoutDir;
  }

  const refArgs = target.ref ? `--branch ${JSON.stringify(target.ref)} ` : "";
  console.log(`Cloning ${target.url} (shallow, blobless) -> ${checkoutDir} ...`);
  execSync(
    `git clone --depth 1 ${refArgs}--filter=blob:none ${target.url} ${JSON.stringify(checkoutDir)}`,
    { stdio: "inherit" },
  );
  return checkoutDir;
};
