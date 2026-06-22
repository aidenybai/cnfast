# cnfast

[![version](https://img.shields.io/npm/v/cnfast?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/cnfast)
[![downloads](https://img.shields.io/npm/dt/cnfast.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/cnfast)

Fast drop-in replacement for `cn`.

cnfast runs **3.2x faster** on average than `tailwind-merge`, up to **7x** with tagged templates, with byte-identical output. Same API, no code changes.

```ts
import { cn } from "cnfast";

cn("px-2 py-1", isActive && "px-4", { "text-red-500": hasError });
// "py-1 px-4 text-red-500"
```

## Install

```bash
npm install cnfast
```

Migrate an existing `clsx`, `classnames`, or `tailwind-merge` project in one command:

```bash
npx cnfast migrate
```

On a shadcn/ui project, add or replace your `cn` utility through the registry. This rewrites `lib/utils.ts` to re-export cnfast and installs the package:

```bash
npx shadcn@latest add aidenybai/cnfast/cn
```

## Usage

Swap the shadcn/ui `cn` helper for cnfast:

```ts
// before
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// after
export { cn } from "cnfast";
```

cnfast also exports `clsx`, `twMerge`, and `twJoin`.

## Going even faster

As a tagged template, `cn` caches by call-site identity: a stable call site runs 2.6x faster than the `cn(...)` call form and 7x faster than `tailwind-merge`.

```ts
cn`px-2 px-4 ${isActive && "bg-blue-500"}`; // "px-4 bg-blue-500"
```

## Comparing against cn

cnfast produces byte-identical output to `tailwind-merge`, then does that work faster. On a re-rendering call site, the tagged-template form pulls furthest ahead:

![cnfast on a re-rendering call site, operations per second](https://raw.githubusercontent.com/aidenybai/cnfast/main/packages/cnfast/bench/chart.svg)

Across the wider suite, operations per second on Bun, best-of-3:

| Workload           | tailwind-merge        | cnfast      | Speedup   |
| ------------------ | --------------------- | ----------- | --------- |
| Cached re-render   | 2,192 ops/s           | 2,925 ops/s | **1.33x** |
| Merge engine, cold | 473 ops/s             | 2,153 ops/s | **4.55x** |
| Component corpus   | 682 ops/s             | 2,421 ops/s | **3.55x** |
| Page render        | 3,047 ops/s           | 5,614 ops/s | **1.84x** |
| Live data grid     | 128 ops/s             | 231 ops/s   | **1.81x** |

Corpus and page rows are geometric means across 53 Tailwind apps and 8 captured pages; cached/cold/grid rows are single workloads. Across 65 workloads the geometric mean is **3.17x**, with 0 mismatches over 113,291 real-world call groups. The bundle is 9.04 KB gzipped against 8.45 KB for the baseline.

`cn` runs once per element, so its cost scales with how much you render. Server-rendering a large page calls it across the whole tree, and a client app that re-renders often (data grids, virtualized tables, live dashboards) calls it thousands of times per second. A faster `cn` keeps those busy frames inside budget. On a small or rarely-updated page, the saving disappears into noise.

See the [benchmark suite](https://github.com/aidenybai/cnfast/blob/main/packages/cnfast/bench/README.md) for the full breakdown and the [architecture guide](https://github.com/aidenybai/cnfast/blob/main/docs/architecture.md) for how it works.

## Credits

cnfast adapts MIT-licensed code from [clsx](https://github.com/lukeed/clsx) (Luke Edwards) and [tailwind-merge](https://github.com/dcastil/tailwind-merge) (Dany Castillo). See [LICENSE](../../LICENSE).

## License

MIT
