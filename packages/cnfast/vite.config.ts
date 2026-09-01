import fs from "node:fs";
import { defineConfig } from "vite-plus";

interface PackageJson {
  version: string;
}

const packageJson: PackageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

export default defineConfig({
  pack: [
    {
      entry: ["./src/index.ts"],
      format: ["cjs", "esm"],
      dts: true,
      clean: false,
      platform: "node",
      sourcemap: false,
      minify: process.env.NODE_ENV === "production",
    },
    {
      entry: { cli: "./src/cli/index.ts" },
      format: ["esm"],
      dts: false,
      clean: false,
      platform: "node",
      sourcemap: false,
      fixedExtension: false,
      outExtensions: () => ({ js: ".js" }),
      minify: process.env.NODE_ENV === "production",
      define: {
        "process.env.VERSION": JSON.stringify(process.env.VERSION ?? packageJson.version),
      },
    },
  ],
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
