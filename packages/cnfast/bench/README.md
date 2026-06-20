# cnfast benchmarks

This suite measures how fast `cn` runs against `clsx` + `tailwind-merge`, using real class strings harvested from open-source apps that ship Tailwind. It answers one question: where does a faster `cn` actually change what a user feels, and where is it noise? Every benchmark runs on committed fixtures, so `pnpm bench:report` reproduces the tables below without network access.

## Headline results

cnfast produces byte-identical output and runs faster on the `cn` operation, but the end-to-end payoff depends entirely on whether `cn` is on your critical path. The numbers below come from `pnpm bench:report` on Bun, best-of-3.

| Scenario                                    | cnfast          | clsx + tailwind-merge | Outcome                                           |
| ------------------------------------------- | --------------- | --------------------- | ------------------------------------------------- |
| Output correctness                          | identical       | baseline              | 0 mismatches across 113,291 real call groups      |
| Live 12,000-cell data grid, per frame       | 15.4 ms         | 32.5 ms               | 2.11x: cnfast holds 60 fps, baseline drops frames |
| One typical page render (`cn` cost only)    | 0.06 to 0.50 ms | 0.10 to 1.00 ms       | 1.5x to 3.1x, saves at most 0.50 ms               |
| React server-side rendering throughput      | up to 1.26x     | baseline              | marginal                                          |
| `cn` throughput on harvested component code | per-repo        | baseline              | 3.53x geomean across 53 repos (2.07x to 6.70x)    |
| Bundle size, minified and gzipped           | 8.73 KB         | 8.45 KB               | cnfast is 0.28 KB larger                          |

The one place the speed converts into user-visible behavior is the data grid. The places it does not: ordinary page renders, Core Web Vitals, and React server-side rendering.

## What the numbers mean

Read the suite as three claims, in order of importance.

**Correctness comes first**: `pnpm bench:parity` runs every harvested call through both implementations and compares output. It finds 0 differences in 113,291 call groups harvested from 53 open-source apps, so the speed is real work, not skipped work.

**The win is narrow and real**: a live data grid recomputes thousands of class names per frame, and those classes change every frame (a heatmap color, a live width), so the [least-recently-used (LRU) cache](../src/lib/create-tailwind-merge.ts) misses on most calls. At 12,000 cells, cnfast finishes in 15.4 ms and stays inside the 16.7 ms budget for 60 frames per second (fps). `clsx` + `tailwind-merge` takes 32.5 ms and drops to roughly 31 fps. Same output, one janks and one does not.

**Everywhere else it is a rounding error**: replaying each captured page’s real call sequence (with duplicates, so the cache behaves as it does in production) shows that a whole page render spends 0.06 to 0.50 ms in `cn`. cnfast saves at most 0.50 ms per render. Largest Contentful Paint (LCP) and Interaction to Next Paint (INP), measured in Chrome by `pnpm bench:pages`, do not change: paint and layout dominate those metrics, and `cn` is a fraction of a fraction.

## Where cnfast helps, and where it does not

Use the table to decide whether `cn` speed matters for your workload before optimizing it.

| Workload                                                         | cnfast advantage                           | Worth switching for speed? |
| ---------------------------------------------------------------- | ------------------------------------------ | -------------------------- |
| Live grids, virtualized tables, dashboards with changing classes | 2.1x, 60 fps instead of dropped frames     | Yes                        |
| Server rendering where output is mostly class strings            | 1.4x to 3.0x (`cn`-dominated string build) | Sometimes                  |
| React server-side rendering                                      | 1.08x to 1.26x                             | Marginal                   |
| Typical page render and Core Web Vitals                          | flat to 1.1x, no LCP or INP change         | No                         |

The general rule: cnfast pays off when you render many class combinations per frame that the cache cannot hold. For static or repeated classes, the cache absorbs the work and both libraries land within run-to-run noise.

## Reproduce

Install [Bun](https://bun.sh) and run the report. Fixtures are committed, so no network or app setup is required.

```bash
pnpm bench:report
```

Or run every throughput workload through one harness and get a single geomean:

```bash
pnpm bench:all       # micro + corpus + page replay + data grid, unified geomean
```

Run a single benchmark when you want one table:

```bash
pnpm bench:tpl       # cn`...` tagged-template identity cache vs cn(...) vs reference
pnpm bench:hard      # live data-grid stress (the headline win)
pnpm bench:replay    # real per-render cn cost on captured pages
pnpm bench:ssr       # server-side rendering throughput
pnpm bench:corpus    # raw cn throughput on harvested component code
pnpm bench:parity    # output correctness vs clsx + tailwind-merge
pnpm size            # bundle size
pnpm bench:pages     # LCP and INP in Chrome (needs Google Chrome installed)
```

Rebuild the fixtures from source when you want fresh data. This step clones the repos in `repos.json` and loads the sites in `pages.json`, so it needs network access and Google Chrome:

```bash
pnpm bench:setup
```

## What gets measured

Each benchmark targets one workload, with fixtures alongside this file. They all share one runner, **`lib/harness.ts`**, which benchmarks cnfast against the reference best-of-N and accumulates every result into a sink so the JIT cannot dead-code-eliminate `cn`'s side-effect-free fast paths (single bare tokens, no-op merges) and report illusory throughput. **`lib/workloads.ts`** builds the reusable workload set that both the individual entries and the combined **`index.ts`** (`pnpm bench:all`) consume.

- **`corpus.bench.ts`**: replays class strings harvested from `repos.json` checkouts into `corpora/*.json`. This is the raw `cn` speed under cache pressure, the most flattering and least representative number. The repo set is restricted to apps that actually use Tailwind: a repo is included only if at least half its harvested tokens are recognized Tailwind classes and it yields at least 50 call groups. That gate (applied independent of measured speed) keeps the corpus from being padded with non-Tailwind code (CSS-modules/BEM/Emotion), where neither library does real merge work, and drops degenerate empty/tiny corpora that would otherwise add noise to the equal-weighted geomean.
- **`page-replay.bench.ts`**: replays each captured page’s real call sequence from `pages/*.json`, with duplicates, so the cache hit rate matches production. This is the honest per-render cost.
- **`hard-task.bench.ts`**: a synthetic 200 by 60 data grid with conflict-heavy, cache-busting classes. This is the workload where speed changes frame rate.
- **`ssr.bench.ts`**: React `renderToString` over the captured trees, plus a string-only upper bound.
- **`template.bench.ts`**: the ``cn`...` `` tagged-template form against the equivalent `cn(...)` call and the reference, on a stable call site with an alternating variant. Shows the identity cache skipping the join and hash (about 3x over `cn(...)`).
- **`index.ts`**: runs every throughput workload above through the shared harness and prints one geomean (`pnpm bench:all`).
- **`report.ts`**: runs the suite in order and prints every table.
- **`scripts/verify-parity.ts`**: proves output parity.
- **`scripts/analyze-pages.ts`**: reports class-string reuse per page, which explains why real pages stay near parity.

## Caveats

Hold these in mind when quoting the numbers:

- **Runtime matters**: results come from Bun. Node produces slightly different figures, so pick one runtime for comparisons and do not mix rows from `results.jsonl` across runtimes.
- **The corpus number is a ceiling**: `corpus.bench.ts` deduplicates inputs and thrashes the cache, which is close to a worst case for the baseline. Real pages reuse classes and sit far below it.
- **`cn` is not your render**: the replay and server-side rendering numbers show `cn` as a small slice of a page. A 3x faster slice of a 2% cost is still a 2% cost.
- **Bundle size is a wash**: cnfast is 0.28 KB larger gzipped, so size is not a reason to switch.
