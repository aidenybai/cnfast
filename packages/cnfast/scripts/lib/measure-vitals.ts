import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

export interface VitalsSample {
  lcpMs: number;
  initialRenderMs: number;
  inpMs: number;
}

export interface MeasureOptions {
  interactions: number;
  runs: number;
  cpuSlowdown: number;
}

const sourceEntry = fileURLToPath(new URL("../../src/index.ts", import.meta.url));

const bundle = async (contents: string): Promise<string> => {
  const result = await build({
    stdin: { contents, resolveDir: fileURLToPath(new URL("../..", import.meta.url)), loader: "ts" },
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "__cnModule",
    platform: "browser",
    write: false,
    legalComments: "none",
  });
  return result.outputFiles[0]!.text;
};

// IIFE bundles exposing window.__cnModule.cn for each implementation. The
// reference is the canonical shadcn `cn = (...i) => twMerge(clsx(i))`.
export const bundleImplementations = async (): Promise<{ fastcn: string; reference: string }> => ({
  fastcn: await bundle(`export { cn } from ${JSON.stringify(sourceEntry)};`),
  reference: await bundle(
    `import { clsx } from "clsx";
     import { twMerge } from "tailwind-merge";
     export const cn = (...inputs) => twMerge(clsx(inputs));`,
  ),
});

const serve = (html: string): Promise<{ url: string; close: () => Promise<void> }> =>
  new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });

// Contract for `html`: it must inject the cn bundle, render once synchronously
// while wrapping the work in a `performance.measure('initial-render', ...)`, and
// expose a `#go` button whose click triggers a cold re-render.
const measureOnce = async (html: string, options: MeasureOptions): Promise<VitalsSample> => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const server = await serve(html);
  try {
    const page = await browser.newPage();
    if (options.cpuSlowdown > 1) {
      const cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send("Emulation.setCPUThrottlingRate", { rate: options.cpuSlowdown });
    }
    await page.addInitScript(() => {
      const globalWithVitals = window as unknown as { __lcp: number; __inp: number };
      globalWithVitals.__lcp = 0;
      globalWithVitals.__inp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) globalWithVitals.__lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      const eventObserverInit = { type: "event", durationThreshold: 16, buffered: true };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = (entry as PerformanceEntry & { duration: number }).duration;
          if (duration > globalWithVitals.__inp) globalWithVitals.__inp = duration;
        }
      }).observe(eventObserverInit);
    });

    await page.goto(server.url, { waitUntil: "load" });

    for (let index = 0; index < options.interactions; index++) {
      await page.click("#go");
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(150);

    const sample = await page.evaluate(() => {
      const globalWithVitals = window as unknown as { __lcp: number; __inp: number };
      const renderEntry = performance.getEntriesByName("initial-render")[0];
      return {
        lcpMs: globalWithVitals.__lcp,
        inpMs: globalWithVitals.__inp,
        initialRenderMs: renderEntry ? renderEntry.duration : Number.NaN,
      };
    });
    await page.close();
    return sample;
  } finally {
    await browser.close();
    await server.close();
  }
};

export const bestOfVitals = async (
  html: string,
  options: MeasureOptions,
): Promise<VitalsSample> => {
  let best: VitalsSample = { lcpMs: Infinity, initialRenderMs: Infinity, inpMs: Infinity };
  for (let run = 0; run < options.runs; run++) {
    const sample = await measureOnce(html, options);
    best = {
      lcpMs: Math.min(best.lcpMs, sample.lcpMs),
      initialRenderMs: Math.min(best.initialRenderMs, sample.initialRenderMs),
      inpMs: Math.min(best.inpMs, sample.inpMs),
    };
  }
  return best;
};
