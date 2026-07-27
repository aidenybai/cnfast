import { describe, expect, it } from "vitest";
import { cn, createCn, createTailwindMerge, getDefaultConfig, mergeConfigs } from "./src/index.js";

const config = {
  override: { classGroups: { "text-decoration": ["underline", "overline"] } },
  extend: {
    classGroups: {
      "text-decoration-strike": ["line-through"],
      "font-size": [{ text: ["display", "title", "body"] }],
    },
  },
};

describe("createCn: honors a custom tailwind-merge config", () => {
  const themed = createCn(config);

  it("keeps a custom font-size and a color class together (issue #6)", () => {
    expect(themed("text-red-500 text-title")).toBe("text-red-500 text-title");
  });

  it("still collapses two classes that share a custom group", () => {
    expect(themed("text-title text-body")).toBe("text-body");
  });

  it("applies an overridden class group, splitting text-decoration", () => {
    expect(themed("underline line-through")).toBe("underline line-through");
    expect(themed("underline overline")).toBe("overline");
  });

  it("preserves default merging for untouched groups", () => {
    expect(themed("px-2 px-4")).toBe("px-4");
  });

  it("preserves class order across a mixed list", () => {
    expect(themed("line-through text-title text-red-500 flex")).toBe(
      "line-through text-title text-red-500 flex",
    );
  });

  it("diverges from the default cn exactly where the config matters", () => {
    expect(cn("text-red-500 text-title")).toBe("text-title");
    expect(cn("underline line-through")).toBe("line-through");
    expect(themed("text-red-500 text-title")).not.toBe(cn("text-red-500 text-title"));
  });
});

describe("createCn: every call shape keeps the config", () => {
  const themed = createCn(config);

  it("merges the variadic form, dropping falsy values", () => {
    expect(themed("text-red-500", false, "text-title")).toBe("text-red-500 text-title");
    expect(themed("text-red-500", "text-title")).toBe("text-red-500 text-title");
  });

  it("honors the config through the tagged-template form", () => {
    const size = "text-title";
    expect(themed`text-red-500 ${size}`).toBe("text-red-500 text-title");
    expect(themed`underline ${"line-through"}`).toBe("underline line-through");
  });

  it("resolves array and object inputs like clsx, then merges", () => {
    expect(themed(["text-title", { "text-body": true }])).toBe("text-body");
  });

  it("returns a stable result across repeated calls", () => {
    expect(themed("text-red-500 text-title")).toBe("text-red-500 text-title");
    expect(themed("text-red-500 text-title")).toBe("text-red-500 text-title");
  });
});

describe("createCn: a config-building function receives the default config", () => {
  it("can return the default config unchanged", () => {
    const passthrough = createCn((defaultConfig) => defaultConfig);
    expect(passthrough("px-2 px-4")).toBe("px-4");
  });
});

describe("createCn: instances are isolated", () => {
  it("does not leak config between instances or into the default cn", () => {
    const themed = createCn(config);
    const empty = createCn({});
    expect(themed("text-red-500 text-title")).toBe("text-red-500 text-title");
    expect(empty("text-red-500 text-title")).toBe("text-title");
    expect(cn("text-red-500 text-title")).toBe("text-title");
  });
});

describe("mergeConfigs", () => {
  it("extends a class group by concatenating onto the defaults", () => {
    const lengthBefore = getDefaultConfig().classGroups["font-size"].length;
    const merged = mergeConfigs(getDefaultConfig(), {
      extend: { classGroups: { "font-size": [{ text: ["title"] }] } },
    });
    expect(merged.classGroups["font-size"].length).toBe(lengthBefore + 1);
  });

  it("overrides a class group wholesale", () => {
    const merged = mergeConfigs(getDefaultConfig(), {
      override: { classGroups: { "text-decoration": ["underline", "overline"] } },
    });
    expect(merged.classGroups["text-decoration"]).toEqual(["underline", "overline"]);
  });

  it("extends and overrides conflictingClassGroupModifiers", () => {
    const extended = mergeConfigs(getDefaultConfig(), {
      extend: { conflictingClassGroupModifiers: { "font-size": ["my-mod"] } },
    });
    expect(extended.conflictingClassGroupModifiers["font-size"]).toEqual(["leading", "my-mod"]);

    const overridden = mergeConfigs(getDefaultConfig(), {
      override: { conflictingClassGroupModifiers: { "font-size": ["my-mod"] } },
    });
    expect(overridden.conflictingClassGroupModifiers["font-size"]).toEqual(["my-mod"]);
  });

  it("extends and overrides postfixLookupClassGroups", () => {
    const extended = mergeConfigs(getDefaultConfig(), {
      extend: { postfixLookupClassGroups: ["font-size"] },
    });
    expect(extended.postfixLookupClassGroups).toEqual(["container-type", "font-size"]);

    const overridden = mergeConfigs(getDefaultConfig(), {
      override: { postfixLookupClassGroups: ["font-size"] },
    });
    expect(overridden.postfixLookupClassGroups).toEqual(["font-size"]);
  });

  it("mutates and returns the passed base config", () => {
    const base = getDefaultConfig();
    expect(mergeConfigs(base, {})).toBe(base);
  });

  it("never mutates a fresh default config", () => {
    const lengthBefore = getDefaultConfig().classGroups["text-decoration"].length;
    createCn(config);
    expect(getDefaultConfig().classGroups["text-decoration"].length).toBe(lengthBefore);
  });
});

describe("public exports", () => {
  it("exposes the configurable factory and its building blocks", () => {
    expect(typeof createCn).toBe("function");
    expect(typeof createTailwindMerge).toBe("function");
    expect(typeof getDefaultConfig).toBe("function");
    expect(typeof mergeConfigs).toBe("function");
  });
});
