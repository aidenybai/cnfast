// JSC has a `line` property that V8 and SpiderMonkey lack.
export const IS_JSC = "line" in new Error();
