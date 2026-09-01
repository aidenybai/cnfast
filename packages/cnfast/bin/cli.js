#!/usr/bin/env node
import module from "node:module";

if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Compile caching is optional, so startup can continue when it fails.
  }
}

await import("../dist/cli.js");
