# cnfast

[![version](https://img.shields.io/npm/v/cnfast?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/cnfast)
[![downloads](https://img.shields.io/npm/dt/cnfast.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/cnfast)

Fast drop-in replacement for `cn`.

cnfast runs 3.9x faster than `clsx` + `tailwind-merge` (1.3x on cached re-renders), with byte-identical output. Same API, no code changes.

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

As a tagged template, `cn` caches by call-site identity: a stable call site runs 3x faster than the call form and 9x faster than `clsx` + `tailwind-merge`.

```ts
cn`px-2 px-4 ${isActive && "bg-blue-500"}`; // "px-4 bg-blue-500"
```

## Benchmarks

Byte-identical output to `clsx` + `tailwind-merge` (0 mismatches over 30,127 real-world call groups) at 9.04 KB gzipped, against 8.45 KB for the baseline.

| Workload                           | Speedup vs clsx + tailwind-merge |
| ---------------------------------- | -------------------------------- |
| Merge engine, unique class strings | 3.9x                             |
| Cached re-render                   | 1.3x                             |
| Tagged template, stable call site  | 9.0x                             |
| Geometric mean, 22 workloads       | 2.61x                            |

See the [benchmark suite](./bench/README.md) for the full breakdown and the [architecture guide](../../docs/architecture.md) for how it works.

## Credits

cnfast adapts MIT-licensed code from [clsx](https://github.com/lukeed/clsx) (Luke Edwards) and [tailwind-merge](https://github.com/dcastil/tailwind-merge) (Dany Castillo). See [LICENSE](../../LICENSE).

## License

MIT
