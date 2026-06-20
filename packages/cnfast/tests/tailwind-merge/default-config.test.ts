import { expect, test } from "vitest";

import { getDefaultConfig } from "../src/lib/default-config.js";
import { Config, DefaultClassGroupIds, DefaultThemeGroupIds } from "../src/lib/types.js";

test("default config has correct types", () => {
  const defaultConfig = getDefaultConfig();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const genericConfig: Config<DefaultClassGroupIds, DefaultThemeGroupIds> = defaultConfig;

  // @ts-expect-error nonExistent is not a config property
  expect(defaultConfig.nonExistent).toBeUndefined();
  expect(defaultConfig.classGroups.display[0]).toBe("block");
  expect(defaultConfig.classGroups.overflow[0].overflow[0]).toBe("auto");
  // @ts-expect-error nonExistent is not a property of the overflow class group
  expect(defaultConfig.classGroups.overflow[0].nonExistent).toBeUndefined();
});
