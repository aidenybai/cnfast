import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import {
  EVENT_DURATION_THRESHOLD_MS,
  FINAL_RENDER_SETTLE_TIME_MS,
  INTERACTION_SETTLE_TIME_MS,
} from "../constants";

export interface VitalsSample {
  lcpMs: number;
  initialRenderMs: number;
  inpMs: number;
}

export interface MeasureOptions {
  interactionCount: number;
  runCount: number;
  cpuSlowdown: number;
}

export interface ImplementationBundles {
  cnfast: string;
  reference: string;
}

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

declare global {
  interface Window {
    __lcp: number;
    __inp: number;
  }
}

const sourceEntryPath = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
const packageDirectoryPath = fileURLToPath(new URL("../..", import.meta.url));

const createBundle = async (source: string): Promise<string> => {
  const buildResult = await build({
    stdin: { contents: source, resolveDir: packageDirectoryPath, loader: "ts" },
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "__cnModule",
    platform: "browser",
    write: false,
    legalComments: "none",
  });
  return buildResult.outputFiles[0]!.text;
};

export const bundleImplementations = async (): Promise<ImplementationBundles> => ({
  cnfast: await createBundle(`export { cn } from ${JSON.stringify(sourceEntryPath)};`),
  reference: await createBundle(
    `import { clsx } from "clsx";
     import { twMerge } from "tailwind-merge";
     export const cn = (...inputs) => twMerge(clsx(inputs));`,
  ),
});

const serveHtml = (html: string): Promise<TestServer> =>
  new Promise((resolveServer) => {
    const testServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(html);
    });
    testServer.listen(0, "127.0.0.1", () => {
      const serverAddress = testServer.address();
      const serverPort =
        typeof serverAddress === "object" && serverAddress ? serverAddress.port : 0;
      resolveServer({
        url: `http://127.0.0.1:${serverPort}/`,
        close: () => new Promise((resolveClose) => testServer.close(() => resolveClose())),
      });
    });
  });

const measureVitalsOnce = async (html: string, options: MeasureOptions): Promise<VitalsSample> => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const testServer = await serveHtml(html);
  try {
    const page = await browser.newPage();
    if (options.cpuSlowdown > 1) {
      const cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send("Emulation.setCPUThrottlingRate", { rate: options.cpuSlowdown });
    }
    await page.addInitScript(() => {
      const globalWithVitals = window;
      globalWithVitals.__lcp = 0;
      globalWithVitals.__inp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) globalWithVitals.__lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      const eventObserverInit = {
        type: "event",
        durationThreshold: EVENT_DURATION_THRESHOLD_MS,
        buffered: true,
      };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = entry.duration;
          if (duration > globalWithVitals.__inp) globalWithVitals.__inp = duration;
        }
      }).observe(eventObserverInit);
    });

    await page.goto(testServer.url, { waitUntil: "load" });

    for (let index = 0; index < options.interactionCount; index++) {
      await page.click("#go");
      await page.waitForTimeout(INTERACTION_SETTLE_TIME_MS);
    }
    await page.waitForTimeout(FINAL_RENDER_SETTLE_TIME_MS);

    const vitalsSample = await page.evaluate(() => {
      const globalWithVitals = window;
      const renderEntry = performance.getEntriesByName("initial-render")[0];
      return {
        lcpMs: globalWithVitals.__lcp,
        inpMs: globalWithVitals.__inp,
        initialRenderMs: renderEntry ? renderEntry.duration : Number.NaN,
      };
    });
    await page.close();
    return vitalsSample;
  } finally {
    await browser.close();
    await testServer.close();
  }
};

export const getBestVitals = async (
  html: string,
  options: MeasureOptions,
): Promise<VitalsSample> => {
  let bestSample: VitalsSample = { lcpMs: Infinity, initialRenderMs: Infinity, inpMs: Infinity };
  for (let runIndex = 0; runIndex < options.runCount; runIndex++) {
    const vitalsSample = await measureVitalsOnce(html, options);
    bestSample = {
      lcpMs: Math.min(bestSample.lcpMs, vitalsSample.lcpMs),
      initialRenderMs: Math.min(bestSample.initialRenderMs, vitalsSample.initialRenderMs),
      inpMs: Math.min(bestSample.inpMs, vitalsSample.inpMs),
    };
  }
  return bestSample;
};
