// JSC Error objects carry a `line` own property; V8 and SpiderMonkey do not. A deterministic,
// allocation-cheap, timing-free engine signal, evaluated once at module load. Only ever used to
// pick between output-identical code paths.
export const IS_JSC = "line" in new Error();
