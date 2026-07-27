---
"cnfast": minor
---

Add `createCn` for custom tailwind-merge configuration.

`createCn(config)` builds a `cn` that honors a custom merge config, accepting the same `{ override, extend }` shape as tailwind-merge's `extendTailwindMerge` (or a `(defaultConfig) => config` function). The default `cn` export is unchanged. Also re-exports `createTailwindMerge`, `getDefaultConfig`, and `mergeConfigs`. Fixes custom `font-size`/class-group configs being ignored (#6).
