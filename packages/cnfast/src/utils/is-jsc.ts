// Only JavaScriptCore errors have their own `line` property. This selects between equivalent
// verification paths once at module load.
export const IS_JSC = "line" in new Error();
