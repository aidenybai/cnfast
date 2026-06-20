## General Rules

- MUST: Use @antfu/ni. Use `ni` to install, `nr SCRIPT_NAME` to run. `nun` to uninstall.
- MUST: Use TypeScript interfaces over types.
- MUST: Keep all types in the global scope.
- MUST: Use arrow functions over function declarations
- MUST: Default to NO comments. Only add a comment when the user explicitly asks, or when the "why" is truly non-obvious - browser quirks, platform bugs, performance tradeoffs, fragile internal patching, or counter-intuitive design decisions. Never add comments that restate what the code does or what a well-named function/variable already conveys. When in doubt, leave the comment out.
  - Do not delete descriptive comments >3 lines without confirming with the user
- MUST: Use kebab-case for files
- MUST: Use descriptive names for variables (avoid shorthands, or 1-2 character names).
  - Example: for .map(), you can use `innerX` instead of `x`
  - Example: instead of `moved` use `didPositionChange`
- MUST: Frequently re-evaluate and refactor variable names to be more accurate and descriptive.
- MUST: Do not type cast ("as") unless absolutely necessary
- MUST: Remove unused code and don't repeat yourself.
- MUST: Always search the codebase, think of many solutions, then implement the most _elegant_ solution.
- MUST: Put all magic numbers in `constants.ts` using `SCREAMING_SNAKE_CASE` with unit suffixes (`_MS`, `_PX`).
- MUST: Put small, focused utility functions in `utils/` with one utility per file.
- MUST: Use Boolean over !!.

## Testing

Run checks always before committing with:

```bash
pnpm test # runs tests
pnpm lint
pnpm typecheck # runs type checking
pnpm format
```

## Development instructions

This is a pnpm monorepo with `packages/` (libraries, tools). No external services (databases, Docker, etc.) are required.

### Build before test

`pnpm build` must complete before `pnpm test` or `pnpm lint`. After modifying source files, always rebuild before running tests.

### Key commands reference

See root `package.json` scripts for the full list. Quick reference:

- **Install**: `ni` (or `pnpm install`)
- **Build**: `nr build` (or `pnpm build`)
- **Dev watch**: `nr dev` (or `pnpm dev`) - watches packages
- **Test**: `pnpm test` - runs tests
- **Lint**: `pnpm lint` - oxlint
- **Typecheck**: `pnpm typecheck` - tsc
- **Format**: `pnpm format` - oxfmt

## Performance (cnfast hot paths)

`cnfast` competes on speed with `clsx` + `tailwind-merge` at 100% output parity. The merge/join
hot paths (`src/clsx.ts`, `src/lib/merge-classlist.ts`, `config-utils.ts`, `parse-class-name.ts`,
`class-group-utils.ts`, `sort-modifiers.ts`, `tw-join.ts`) are performance-critical. Rules:

- MUST: Keep hot paths on `for`/`while` loops + string concatenation. Never `map`/`filter`/`reduce`/`join` or array spread (`push(...arr)`) in per-call code.
- MUST: Preserve monomorphic object shapes. Route every parse/descriptor result through a single factory with identical key order (see `createResultObject`, `EXTERNAL_DESCRIPTOR`).
- MUST: Restrict `Object.entries`/`Object.keys`/spread/`Object.fromEntries` to init-time (config building) only; never per-call.
- MUST: Keep `Object.create(null)` for LRU/lookup maps; do not "modernize" to `Map` in hot paths.
- MUST: Hoist RegExps, validators, and constants to module scope; never construct a `RegExp` or closure inside a per-class function.
- MUST: Never use `delete`; overwrite/reuse instead. Maintain lazy init (self-patching `initTailwindMerge`).
- MUST: Bound any per-input cache (use the LRU); do not let caches grow unbounded on arbitrary class values.

### Measurement discipline

- Gate every hot-path change on `pnpm test` (parity, incl. differential fuzz vs real `twMerge`) and `pnpm iter <label>` (best-of-N bench + size, recorded to `bench/results.jsonl`).
- Report ops/sec + speedup before/after; use best-of-3, never single samples.
- Profile the production build; use `pnpm deopt` to check for V8 deoptimizations in hot-path frames.
