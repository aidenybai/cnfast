import { expect, test } from "vitest";

import { getDefaultConfig } from "../../src/lib/default-config.js";
import { mergeConfigs } from "../../src/lib/merge-configs.js";
import { AnyConfig } from "../../src/lib/types.js";

const createBaseConfig = (): AnyConfig => ({
  theme: { text: ["sm", "lg"] },
  classGroups: { "font-size": ["text-sm"], display: ["block", "flex"] },
  conflictingClassGroups: { "font-size": ["leading"] },
  conflictingClassGroupModifiers: { "font-size": ["leading"] },
  postfixLookupClassGroups: ["container-type"],
  orderSensitiveModifiers: ["before"],
});

test("extend appends to existing config properties", () => {
  const merged = mergeConfigs(createBaseConfig(), {
    extend: {
      theme: { text: ["xxs"] },
      classGroups: { "font-size": ["text-huge"] },
      conflictingClassGroups: { "font-size": ["tracking"] },
      conflictingClassGroupModifiers: { "font-size": ["tracking"] },
      postfixLookupClassGroups: ["font-size"],
      orderSensitiveModifiers: ["after"],
    },
  });

  expect(merged.theme["text"]).toEqual(["sm", "lg", "xxs"]);
  expect(merged.classGroups["font-size"]).toEqual(["text-sm", "text-huge"]);
  expect(merged.conflictingClassGroups["font-size"]).toEqual(["leading", "tracking"]);
  expect(merged.conflictingClassGroupModifiers["font-size"]).toEqual(["leading", "tracking"]);
  expect(merged.postfixLookupClassGroups).toEqual(["container-type", "font-size"]);
  expect(merged.orderSensitiveModifiers).toEqual(["before", "after"]);
});

test("extend adds config properties that do not exist yet", () => {
  const merged = mergeConfigs(createBaseConfig(), {
    extend: { theme: { spacing: ["1"] }, classGroups: { opacity: ["opacity-50"] } },
  });

  expect(merged.theme["spacing"]).toEqual(["1"]);
  expect(merged.classGroups["opacity"]).toEqual(["opacity-50"]);
  expect(merged.theme["text"]).toEqual(["sm", "lg"]);
});

test("override replaces config properties instead of appending", () => {
  const merged = mergeConfigs(createBaseConfig(), {
    override: {
      theme: { text: ["xxs"] },
      classGroups: { "font-size": ["text-huge"] },
      postfixLookupClassGroups: ["font-size"],
      orderSensitiveModifiers: ["after"],
    },
  });

  expect(merged.theme["text"]).toEqual(["xxs"]);
  expect(merged.classGroups["font-size"]).toEqual(["text-huge"]);
  expect(merged.postfixLookupClassGroups).toEqual(["font-size"]);
  expect(merged.orderSensitiveModifiers).toEqual(["after"]);
  expect(merged.classGroups["display"]).toEqual(["block", "flex"]);
});

test("override is applied before extend so both can target one property", () => {
  const merged = mergeConfigs(createBaseConfig(), {
    override: { theme: { text: ["xxs"] } },
    extend: { theme: { text: ["xs"] } },
  });

  expect(merged.theme["text"]).toEqual(["xxs", "xs"]);
});

test("an empty extension leaves the config untouched", () => {
  expect(mergeConfigs(createBaseConfig(), {})).toEqual(createBaseConfig());
});

test("does not mutate the extension it is given", () => {
  const extension = { extend: { theme: { text: ["xxs"] } } };

  mergeConfigs(createBaseConfig(), extension);

  expect(extension).toEqual({ extend: { theme: { text: ["xxs"] } } });
});

test("does not leak into the next getDefaultConfig() call", () => {
  mergeConfigs(getDefaultConfig(), { extend: { theme: { text: ["xxs"] } } });

  expect(getDefaultConfig().theme.text).not.toContain("xxs");
});
