import { createTailwindMerge } from "./create-tailwind-merge";
import { getDefaultConfig } from "./default-config";
import { mergeConfigs } from "./merge-configs";
import { AnyConfig, ConfigExtension } from "./types";

let configExtension: ConfigExtension | undefined;
let hasBuiltConfig = false;

const createConfig = (): AnyConfig => {
  hasBuiltConfig = true;
  const defaultConfig = getDefaultConfig();

  return configExtension === undefined
    ? defaultConfig
    : mergeConfigs(defaultConfig, configExtension);
};

export const twMerge = createTailwindMerge(createConfig);

/**
 * Registers a merge configuration for the shared `cn` and `twMerge`.
 *
 * Call it once, before the first merge. Configuring afterwards would make the same input merge to
 * one string early in the process and a different string later, which is why that throws instead of
 * dropping the caches: strings already handed to a caller cannot be recalled.
 */
export const configure = (extension: ConfigExtension) => {
  if (hasBuiltConfig) {
    throw new Error(
      "cnfast: configure() must be called before the first cn() or twMerge() call. Move it to a module that runs before any class merging.",
    );
  }

  configExtension = extension;
};
