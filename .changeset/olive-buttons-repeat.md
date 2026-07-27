---
"cnfast": minor
---

Add `configure` for custom Tailwind themes.

`cn` bakes in the default tailwind-merge configuration, so a utility from a custom theme is unknown to it and merges wrong: `cn("text-xxs text-muted-foreground")` reads `text-xxs` as a text color and drops the font size. `configure({ extend: { theme: { text: ["xxs"] } } })` registers the same `{ override, extend }` extension `extendTailwindMerge` accepts, on the shared `cn` and `twMerge` that the migration CLI and the shadcn registry entry point users at.

The configuration is read once, when the merge config is built on first use, so nothing changes on the hot path and an unconfigured `cn` behaves exactly as before. Calling `configure` after the first merge throws rather than dropping the caches, because classes already returned to a caller were merged under the old configuration.
