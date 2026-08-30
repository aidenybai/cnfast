import { describe, expect, it } from "vitest";
import { type ClassListArgs, harvestClassGroups } from "../../scripts/lib/harvest-classes";

const harvest = (source: string): ClassListArgs[] => {
  const groups = new Map<string, ClassListArgs>();
  harvestClassGroups(source, groups);
  return [...groups.values()];
};

describe("harvestClassGroups", () => {
  it("finds supported class helpers", () => {
    const groups = harvest(`
      cn("p-1")
      clsx("p-2")
      cx("p-3")
      cva("p-4")
      twMerge("p-5")
      twJoin("p-6")
      classNames("p-7")
      classnames("p-8")
      tv("p-9")
      tw("p-10")
    `);

    expect(groups).toEqual([
      ["p-1"],
      ["p-2"],
      ["p-3"],
      ["p-4"],
      ["p-5"],
      ["p-6"],
      ["p-7"],
      ["p-8"],
      ["p-9"],
      ["p-10"],
    ]);
  });

  it("ignores helper names outside executable source", () => {
    const groups = harvest(`
      const source = "cn('not-a-class')"
      // clsx("also-not-a-class")
      /* cx("still-not-a-class") */
      const pattern = /cn("not-a-class")/
      <!-- <div class="not-a-class" /> -->
      cn("p-2")
    `);

    expect(groups).toEqual([["p-2"]]);
  });

  it("finds JSX and framework class attributes", () => {
    const groups = harvest(`
      <div className="p-1 text-sm" />
      <div className={"p-2"} />
      <div class="p-3" />
      <div class:list={["p-4", active && "block"]} />
      <div :class="['p-5', active && 'hidden']" />
      <div v-bind:class="['p-6']" />
      <div class:active={active} />
      <div class:visible />
      <div classList={{ selected: active, "font-bold": active }} />
      <div [ngClass]="{ muted: disabled, 'opacity-50': disabled }" />
      <div [class.highlighted]="active" />
    `);

    expect(groups).toEqual([
      ["p-1 text-sm"],
      ["p-2"],
      ["p-3"],
      ["p-4", "block"],
      ["p-5", "hidden"],
      ["p-6"],
      ["selected", "font-bold"],
      ["muted", "opacity-50"],
      ["active"],
      ["visible"],
      ["highlighted"],
    ]);
  });

  it("finds tagged templates and strings inside template expressions", () => {
    const groups = harvest(`
      cn(\`p-1 \${active ? "block" : "hidden"}\`)
      tw\`p-2 text-sm\`
      tw.div\`p-3\`
    `);

    expect(groups).toEqual([["p-1  ", "block", "hidden"], ["p-2 text-sm"], ["p-3"]]);
  });

  it("ignores comparison values", () => {
    const groups = harvest(`
      cn(sort === "asc" ? "flex" : "hidden")
    `);

    expect(groups).toEqual([["flex", "hidden"]]);
  });

  it("finds object-form classes in clsx-compatible helpers", () => {
    const groups = harvest(`
      cn({ hidden: isHidden, "p-2 text-sm": isActive })
      clsx({ block: isVisible })
      cva("base", { variants: { size: { small: "text-sm" } } })
    `);

    expect(groups).toEqual([["hidden", "p-2 text-sm"], ["block"], ["base", "text-sm"]]);
  });

  it("finds direct DOM class changes", () => {
    const groups = harvest(`
      element.className = "p-1 text-sm"
      element.classList.add("p-2", "block")
      element.classList.toggle("hidden", isHidden)
    `);

    expect(groups).toEqual([["p-1 text-sm"], ["p-2", "block"], ["hidden"]]);
  });
});
