# Experiment ledger

One verdict row per experiment, so rejected mechanisms stay rejected and nobody re-litigates
them without new evidence. Numbers come from the run that decided the verdict; see
`results.jsonl` for raw rows and the bench README for workload definitions. Meta-rules:
overlapping confidence intervals are ties; runs on a machine shared with other benchmark
processes are exploratory, not publication evidence; a microbench win only earns a full-suite
run, retention requires corpus geomean + page replays + parity on both engines.

## Retained

| Experiment | Verdict | Evidence |
| --- | --- | --- |
| Fused split + FNV-1a token-intern table (open-addressed, charCode-verified, adaptive 2048→16384, two-generation) | retained | corpus subset geomean 3.52x→5.48x (bun); full 53-corpus 3.63x→4.71x; micro uncached 3,843→4,851 ops/s; hit path unregressed |
| Dense group indexes + packed smi-keyed conflict-key memo (concat-string registry preserved) | retained | kills 294 megamorphic `conflictingClassGroups[id]` ICs; supabase +10% (descriptor-compute-heavy); noise elsewhere |
| SoA int32 descriptors {classId, conflictStart, conflictEnd} over shared conflict pool | retained | +2–5% uniform on corpus rows; enables adaptive intern capacity |
| Contiguous kept-run slice rebuild | retained | CPU-flat as predicted; kept for flat-string/alloc benefit downstream (fewer cons strings feeding later hashes) |
| Whole-string cache capacity 500→2048 | retained | replay geomean 1.98x→2.46x (bun); calcom +77–156%, documenso +273% (node); real pages measure 633–1134 unique strings, 500 thrashed |
| TinyLFU-style doorkeeper (second-sighting admission; 8KB byte-table fingerprint) | retained | +7–10% on pure-thrash corpus rows (supabase, posthog); neutral on hit paths; collisions only admit early, never affect output |
| Arity-specialized cn2/cn3 entry + flat interleaved arg-cache buckets | retained | node micro cached 7,817→9,127 ops/s (+17%); node grid stable 5.17x→6.05x |
| Arg-cache policy: whole-bucket promotion from previous generation; trimBucket half-drop replacing shift() | retained | node grid dynamic 1.36x→1.61–1.69x; removes rotation cliffs |
| Arg cache on all engines (IS_V8 gate removed) | retained | bun micro cached 4,390→6,830 ops/s (+56%); bun grid stable +138%; old rejection premise ("JSC hashes fresh strings cheaply") measured false: ~112 ns rope flatten+hash per warm variadic probe |
| Deopt hardening: charCode dispatch, OOB guards, hand-rolled arbitrary-value scanner replacing regexes | retained | grid-dynamic 18.83→15.57 ms/grid (−17%); steady state deopt-clean (was: recurring re-deopt in getIsArbitraryVariable) |
| Validator shape-gate masks (BRACKET/PAREN/OTHER by validator identity; unknown validators never skipped) | retained | full-miss compute −6% on top of hardening; grid-dynamic 2.39–2.41x |
| Plain-token zero-parse descriptor path (no `:` `/` `[` `(` `!` → straight to group lookup) | retained | full-miss compute −12% total vs baseline; ~90% of real tokens are plain |

## Rejected

| Experiment | Verdict | Evidence / mechanism of failure |
| --- | --- | --- |
| `Map` substrate for the whole-string cache | rejected (both engines) | wins the isolated `bench:lru` shootout 2–3x on stable pre-hashed keys, loses end-to-end (bun replay geomean 2.51x→2.15x, node corpus −8%): real probes use fresh joined rope strings, so Map re-hashes them too and adds overhead |
| Skip whole-string insert on the variadic arg-cache miss route | rejected | node dub −42%, shadcn −26%: arg sequences that fall out of the arg cache then re-join and probe a cache that never stored their result |
| Reusable scratch array for the arguments copy | rejected | measured slower: old-to-new write barriers on every store; `new Array(length)` prealloc is the winner (+9%) |
| Purely arithmetic conflict keys `modifierIdx * GROUP_COUNT + groupIdx` | rejected — parity break | tailwind-merge compares concatenated key strings; distinct pairs whose concats collide must unify (e.g. `overflow-auto` vs `overflo:w-4` both key "overflow"; 130 proper-suffix pairs exist among the 379 default group ids). Registry stays string-keyed; a numeric memo bypasses the hashing cost instead |
| WASM core for token classification / merge | rejected (expiry: retest if zero-copy JS string refs land in engines' WASM string proposals) | prescience `warper-wasm-fenwick` k10: WASM loses fine-grained ops even with load/compile/glue costs excluded (update 20.8→27.8 ns); cnfast's hot ops are sub-microsecond string reads — boundary costs dominate |
| Cursor-walk / recursive-cursor / delimiter-fast-path token walks | rejected | results.jsonl: neutral-to-negative across corpus rows in every variant |

## Caveats on current headline numbers

Capacity 2048 shifts several benchmark rows (micro uncached, mid-size corpora, several page
replays) from miss- to hit-regime: their speedups now partly measure cache fit rather than
merge-engine speed. Real cold renders still pay the miss path; quote the worst rows
(shadcn-ui/unkey/midday replays, grid-dynamic) alongside the geomean.
