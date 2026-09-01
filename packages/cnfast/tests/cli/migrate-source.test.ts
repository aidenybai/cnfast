import { describe, expect, it } from "vitest";
import { migrateSource } from "../../src/cli/utils/migrate-source.js";

describe("migrateSource", () => {
  it("rewrites named clsx imports", () => {
    const result = migrateSource(`import { clsx } from "clsx";`);
    expect(result.code).toBe(`import { clsx } from "cnfast";`);
    expect(result.changeCount).toBe(1);
  });

  it("rewrites named tailwind-merge imports", () => {
    const result = migrateSource(`import { twMerge } from "tailwind-merge";`);
    expect(result.code).toBe(`import { twMerge } from "cnfast";`);
  });

  it("preserves type-only named specifiers", () => {
    const result = migrateSource(`import { type ClassValue, clsx } from "clsx";`);
    expect(result.code).toBe(`import { type ClassValue, clsx } from "cnfast";`);
  });

  it("converts default clsx imports to named", () => {
    const result = migrateSource(`import clsx from "clsx";`);
    expect(result.code).toBe(`import { clsx } from "cnfast";`);
  });

  it("aliases default clsx imports with a different local name", () => {
    const result = migrateSource(`import cx from "clsx";`);
    expect(result.code).toBe(`import { clsx as cx } from "cnfast";`);
  });

  it("maps default classnames imports to clsx", () => {
    const result = migrateSource(`import classNames from "classnames";`);
    expect(result.code).toBe(`import { clsx as classNames } from "cnfast";`);
  });

  it("preserves single quotes", () => {
    const result = migrateSource(`import { twMerge } from 'tailwind-merge';`);
    expect(result.code).toBe(`import { twMerge } from 'cnfast';`);
  });

  it("migrates the shadcn cn util so it keeps working", () => {
    const input = [
      `import { type ClassValue, clsx } from "clsx"`,
      `import { twMerge } from "tailwind-merge"`,
      ``,
      `export function cn(...inputs: ClassValue[]) {`,
      `  return twMerge(clsx(inputs))`,
      `}`,
    ].join("\n");
    const result = migrateSource(input);
    expect(result.code).toContain(`import { type ClassValue, clsx } from "cnfast"`);
    expect(result.code).toContain(`import { twMerge } from "cnfast"`);
    expect(result.code).toContain(`return twMerge(clsx(inputs))`);
    expect(result.changeCount).toBe(2);
  });

  it("rewrites re-exports", () => {
    const result = migrateSource(`export { twMerge } from "tailwind-merge";`);
    expect(result.code).toBe(`export { twMerge } from "cnfast";`);
  });

  it("rewrites dynamic imports", () => {
    const result = migrateSource(`const { clsx } = await import("clsx");`);
    expect(result.code).toBe(`const { clsx } = await import("cnfast");`);
  });

  it("rewrites require calls", () => {
    const result = migrateSource(`const { twMerge } = require("tailwind-merge");`);
    expect(result.code).toBe(`const { twMerge } = require("cnfast");`);
  });

  it("rewrites side-effect imports", () => {
    const result = migrateSource(`import "clsx";`);
    expect(result.code).toBe(`import "cnfast";`);
  });

  it("rewrites named class-variance-authority imports", () => {
    const result = migrateSource(`import { cva } from "class-variance-authority";`);
    expect(result.code).toBe(`import { cva } from "cnfast";`);
    expect(result.changeCount).toBe(1);
  });

  it("rewrites mixed value and type cva specifiers", () => {
    const result = migrateSource(
      `import { cva, cx, type VariantProps } from "class-variance-authority";`,
    );
    expect(result.code).toBe(`import { cva, cx, type VariantProps } from "cnfast";`);
  });

  it("rewrites type-only class-variance-authority imports", () => {
    const result = migrateSource(`import type { VariantProps } from "class-variance-authority";`);
    expect(result.code).toBe(`import type { VariantProps } from "cnfast";`);
    expect(result.changeCount).toBe(1);
  });

  it("rewrites type-only clsx imports without inventing a default specifier", () => {
    const result = migrateSource(`import type { ClassValue } from "clsx";`);
    expect(result.code).toBe(`import type { ClassValue } from "cnfast";`);
  });

  it("rewrites class-variance-authority/types subpath imports", () => {
    const result = migrateSource(
      `import type { ClassProp, StringToBoolean } from "class-variance-authority/types";`,
    );
    expect(result.code).toBe(`import type { ClassProp, StringToBoolean } from "cnfast";`);
  });

  it("rewrites the shadcn buttonVariants module so it keeps working", () => {
    const input = [
      `import { cva, type VariantProps } from "class-variance-authority"`,
      ``,
      `const buttonVariants = cva("inline-flex items-center", {`,
      `  variants: { variant: { default: "bg-primary" } },`,
      `  defaultVariants: { variant: "default" },`,
      `})`,
      ``,
      `export interface ButtonProps extends VariantProps<typeof buttonVariants> {}`,
    ].join("\n");
    const result = migrateSource(input);
    expect(result.code).toContain(`import { cva, type VariantProps } from "cnfast"`);
    expect(result.code).toContain(`const buttonVariants = cva("inline-flex items-center", {`);
    expect(result.changeCount).toBe(1);
  });

  it("rewrites class-variance-authority re-exports and require calls", () => {
    expect(migrateSource(`export { cva } from "class-variance-authority";`).code).toBe(
      `export { cva } from "cnfast";`,
    );
    expect(migrateSource(`const { cva } = require("class-variance-authority");`).code).toBe(
      `const { cva } = require("cnfast");`,
    );
    expect(migrateSource(`const { cx } = await import("class-variance-authority");`).code).toBe(
      `const { cx } = await import("cnfast");`,
    );
  });

  it("leaves unrelated imports untouched", () => {
    const input = `import { useState } from "react";\nexport function cn() {}`;
    const result = migrateSource(input);
    expect(result.code).toBe(input);
    expect(result.changeCount).toBe(0);
  });

  it("does not touch existing cnfast imports", () => {
    const input = `import { cn } from "cnfast";`;
    const result = migrateSource(input);
    expect(result.changeCount).toBe(0);
  });

  it("handles multiple imports in one file", () => {
    const input = `import clsx from "clsx";\nimport { twMerge } from "tailwind-merge";`;
    const result = migrateSource(input);
    expect(result.code).toBe(`import { clsx } from "cnfast";\nimport { twMerge } from "cnfast";`);
    expect(result.changeCount).toBe(2);
  });
});
