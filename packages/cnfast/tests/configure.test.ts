import { describe, expect, it, vi } from "vitest";

const importCnfast = async () => {
  vi.resetModules();

  return import("../src/index.js");
};

describe("configure: custom theme scales", () => {
  it("keeps a custom font size alongside a text color", async () => {
    const { cn, configure } = await importCnfast();
    configure({ extend: { theme: { text: ["xxs"] } } });

    expect(cn("text-xxs text-muted-foreground")).toBe("text-xxs text-muted-foreground");
    expect(cn("text-muted-foreground text-xxs")).toBe("text-muted-foreground text-xxs");
  });

  it("keeps a custom class group member alongside a text color", async () => {
    const { cn, configure } = await importCnfast();
    configure({ extend: { classGroups: { "font-size": ["text-24-regular"] } } });

    expect(cn("text-foreground text-24-regular")).toBe("text-foreground text-24-regular");
  });

  it("still resolves conflicts within the extended group", async () => {
    const { cn, configure } = await importCnfast();
    configure({ extend: { theme: { text: ["xxs"] } } });

    expect(cn("text-xxs text-lg")).toBe("text-lg");
    expect(cn("text-lg text-xxs")).toBe("text-xxs");
  });

  it("leaves the default merge behavior alone", async () => {
    const { cn, configure } = await importCnfast();
    configure({ extend: { theme: { text: ["xxs"] } } });

    expect(cn("text-sm text-lg")).toBe("text-lg");
    expect(cn("text-red-500 text-blue-500")).toBe("text-blue-500");
    expect(cn("text-[15px] text-[20px]")).toBe("text-[20px]");
    expect(cn("px-2 px-4")).toBe("px-4");
    expect(cn("flex items-center")).toBe("flex items-center");
  });

  it("applies an override that replaces a default theme scale", async () => {
    const { cn, configure } = await importCnfast();
    configure({ override: { theme: { text: ["xxs"] } } });

    expect(cn("text-xxs text-muted-foreground")).toBe("text-xxs text-muted-foreground");
    expect(cn("text-sm text-muted-foreground")).toBe("text-muted-foreground");
  });
});

describe("configure: call forms", () => {
  it("applies to the variadic form", async () => {
    const { cn, configure } = await importCnfast();
    configure({ extend: { theme: { text: ["xxs"] } } });

    expect(cn("text-xxs", "text-muted-foreground")).toBe("text-xxs text-muted-foreground");
    expect(cn("text-xxs", false, ["text-muted-foreground"], { "font-bold": true })).toBe(
      "text-xxs text-muted-foreground font-bold",
    );
  });

  it("applies to the tagged-template form", async () => {
    const { cn, configure } = await importCnfast();
    configure({ extend: { theme: { text: ["xxs"] } } });

    expect(cn`text-xxs text-muted-foreground`).toBe("text-xxs text-muted-foreground");
  });

  it("applies to twMerge", async () => {
    const { twMerge, configure } = await importCnfast();
    configure({ extend: { theme: { text: ["xxs"] } } });

    expect(twMerge("text-xxs", "text-muted-foreground")).toBe("text-xxs text-muted-foreground");
  });
});

describe("configure: without a call", () => {
  it("merges exactly as before", async () => {
    const { cn } = await importCnfast();

    expect(cn("text-xxs text-muted-foreground")).toBe("text-muted-foreground");
    expect(cn("px-2 px-4")).toBe("px-4");
  });
});

describe("configure: misuse", () => {
  it("throws when called after the first merge", async () => {
    const { cn, configure } = await importCnfast();
    cn("px-2 px-4");

    expect(() => configure({ extend: { theme: { text: ["xxs"] } } })).toThrowError(
      /must be called before the first cn\(\) or twMerge\(\) call/,
    );
  });

  it("throws when called after the first twMerge", async () => {
    const { twMerge, configure } = await importCnfast();
    twMerge("px-2 px-4");

    expect(() => configure({ extend: { theme: { text: ["xxs"] } } })).toThrowError();
  });
});
