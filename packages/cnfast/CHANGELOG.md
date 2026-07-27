# cnfast

## 0.1.0

### Minor Changes

- 8643c3c: Add `createCn` for custom tailwind-merge configuration.

  `createCn(config)` builds a `cn` that honors a custom merge config, accepting the same `{ override, extend }` shape as tailwind-merge's `extendTailwindMerge` (or a `(defaultConfig) => config` function). The default `cn` export is unchanged. Also re-exports `createTailwindMerge`, `getDefaultConfig`, and `mergeConfigs`. Fixes custom `font-size`/class-group configs being ignored (#6).

### Patch Changes

- fix

## 0.0.8

### Patch Changes

- fix

## 0.0.7

### Patch Changes

- fix
- a5d9603: Cache variadic `cn(...)` results by argument sequence on V8.

  Repeated multi-arg calls (`cn("base", cond && "variant", ...)`) previously rebuilt and re-hashed the joined class string on every render. On V8 a freshly built string is not hash-cached, so each `cn` call paid a full flatten and hash for the cache lookup. The new cache keys on the stable individual argument strings instead, whose hashes V8 already caches, and skips the rebuild on a hit. This is ~4x faster on the cached re-render path and lifts the suite geomean to 3.8x on V8.

  The cache is gated to V8 (Chrome, Node, Edge, Deno). JavaScriptCore (Safari, Bun) and SpiderMonkey (Firefox) hash fresh strings cheaply and gain nothing from the extra layer, so they take the original path unchanged. Output stays byte-identical across all engines.

## 0.0.6

### Patch Changes

- fix

## 0.0.5

### Patch Changes

- fix

## 0.0.4

### Patch Changes

- fix

## 0.0.3

### Patch Changes

- fix

## 0.0.2

### Patch Changes

- init
