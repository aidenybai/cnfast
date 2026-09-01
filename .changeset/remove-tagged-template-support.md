---
"cnfast": minor
---

This release adds new public APIs, a new merge engine, more migration support, and a larger verification suite.

## Public API

- Add `cva` as a compatible replacement for `class-variance-authority` 0.7.1. It supports base classes, variants, default variants, compound variants, boolean and numeric variant keys, and the `class` and `className` props.
- Export the CVA types `ClassProp`, `ClassPropKey`, `CvaConfig`, `CvaProps`, `CxOptions`, `CxReturn`, `OmitUndefined`, `StringToBoolean`, `VariantProps`, and `VariantSchema`.
- Add `cx` as an alias for `clsx`. This supports code that imports `cx` from `class-variance-authority`.
- Add `createCallSiteCn`. It creates a separate bounded memo for one call site. It accepts the default `cn` function or a custom function from `createCn`. It memoizes repeated primitive argument lists. It does not memoize object, array, or function inputs because these values can change without a new identity.

## CVA execution

- Compile each CVA configuration on its first call. This removes repeated configuration work from later calls.
- Add a bounded combination table for configurations without compound variants. The table stores stable class results for known variant combinations.
- Add fast and wide memo lanes for calls that cannot use the combination table. The memo stores primitive prop combinations and keeps mutable class values on the uncached path.
- Preserve one property-key coercion per variant value. This matches `class-variance-authority` when an object has a custom `toString` method.
- Preserve byte-identical output for the supported CVA input set. CVA configurations must remain unchanged after the first call. Props must be plain objects. Inherited or non-enumerable props can produce different results.

## Merge performance

- Replace the class merge path with a single-pass token scanner and a right-to-left conflict resolver. The resolver avoids temporary token strings for known classes.
- Add bounded token, class, argument, and result caches. The caches use admission checks, generation rotation, and adaptive capacity limits.
- Add specialized paths for calls with one, two, and three arguments. Add a separate path for calls with more arguments.
- Add argument-sequence lookup for repeated calls. Add successor prediction for common render sequences. Keep mutable values on the full resolution path.
- Add JavaScriptCore-specific paths for common calls with falsy values. Keep the V8 paths small enough for inlining.
- Keep custom configurations from `createCn` on the same optimized execution paths as the default configuration.

## Tailwind compatibility

- Align the default conflict rules with the pinned `tailwind-merge` development configuration used by the parity suite.
- Update logical spacing, inset, border, and scroll conflict behavior.
- Update `max-h-none`, `shadow-inner`, and related shadow conflict behavior.
- Preserve support for Tailwind CSS 4.0, 4.1, 4.1.5, and 4.2 syntax covered by the test suite.

## Migration command

- Extend `cnfast migrate` to replace imports from `class-variance-authority` and `class-variance-authority/types`.
- Support value imports, type-only imports, re-exports, dynamic imports, and CommonJS `require` calls for the new CVA migration sources.
- Preserve local aliases and quote style when the command rewrites an import.

## API change

- Remove tagged-template support from `cn` and `createCn`. Use the variadic `cn(...)` call form.

## Verification tools

- Expand the stateful parity checks for `cn`, the merge cache, call-site memoization, and CVA memoization.
- Add seeded differential tests against `tailwind-merge` and `class-variance-authority`.
- Expand the focused benchmarks for cached and uncached calls, input shapes, Tailwind syntax, cache boundaries, conditional renders, result reuse, CVA variants, call-site replay, page replay, server rendering, and live data grids.
- Add paired A/B comparison. Expand the bundle-size checks, V8 deoptimization checks, and repository corpora.
