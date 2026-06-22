---
"cnfast": patch
---

Cache variadic `cn(...)` results by argument sequence on V8.

Repeated multi-arg calls (`cn("base", cond && "variant", ...)`) previously rebuilt and re-hashed the joined class string on every render. On V8 a freshly built string is not hash-cached, so each `cn` call paid a full flatten and hash for the cache lookup. The new cache keys on the stable individual argument strings instead, whose hashes V8 already caches, and skips the rebuild on a hit. This is ~4x faster on the cached re-render path and lifts the suite geomean to 3.8x on V8.

The cache is gated to V8 (Chrome, Node, Edge, Deno). JavaScriptCore (Safari, Bun) and SpiderMonkey (Firefox) hash fresh strings cheaply and gain nothing from the extra layer, so they take the original path unchanged. Output stays byte-identical across all engines.
