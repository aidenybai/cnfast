import { useEffect, useState } from "react";

import latestBenchmarkReport from "../../cnfast/bench/latest.json";
import { BenchmarkSectionTable } from "@/components/benchmark-section-table";
import { PerformanceChart } from "@/components/performance-chart";
import { SiteHeader } from "@/components/site-header";
import { BENCHMARK_COMMIT_BASE_URL, BENCHMARK_THEME_STORAGE_KEY } from "@/constants";
import generatedBenchmarkData from "@/generated/benchmark-data.json";
import { createPerformanceSection } from "@/utils/create-performance-section";
import { formatBenchmarkDate } from "@/utils/format-benchmark-date";

const benchmarkReport: BenchmarkReport = latestBenchmarkReport;
const benchmarkSiteData: BenchmarkSiteData = generatedBenchmarkData;
const performanceSection = createPerformanceSection(benchmarkReport, benchmarkSiteData);

export const BenchmarkViewer = () => {
  const [isDark, setIsDark] = useState(() => {
    const storedTheme = window.localStorage.getItem(BENCHMARK_THEME_STORAGE_KEY);
    return (
      storedTheme === "dark" ||
      (storedTheme === null && window.matchMedia("(prefers-color-scheme: dark)").matches)
    );
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    window.localStorage.setItem(BENCHMARK_THEME_STORAGE_KEY, isDark ? "dark" : "light");
  }, [isDark]);

  return (
    <div className="min-h-screen">
      <SiteHeader isDark={isDark} onDarkModeChange={setIsDark} />
      <main className="container-wrapper flex flex-1 flex-col px-2">
        <div className="flex scroll-mt-24 items-stretch pb-8 text-[1.05rem] sm:text-[15px] xl:w-full">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-1 flex-col gap-6 px-4 py-6 text-foreground md:px-0 lg:py-8 dark:text-foreground">
              <header className="flex flex-col gap-2">
                <h1 className="scroll-m-24 text-3xl font-semibold tracking-tight sm:text-3xl">
                  <code className="font-mono">cn</code> benchmark
                </h1>
                <p className="text-[1.05rem] text-muted-foreground sm:text-base sm:text-balance md:max-w-[80%]">
                  Compare cnfast against clsx + tailwind-merge across real component repositories,
                  common rendering workloads, and bundle size.
                </p>
              </header>

              <div className="typeset w-full">
                <p>
                  The latest committed result was generated{" "}
                  {formatBenchmarkDate(benchmarkReport.generatedAt)} with {benchmarkReport.runtime}.
                  Each workload records the highest mean throughput from {benchmarkReport.bestOf}
                  timed attempts of {benchmarkReport.timeMs} ms after warmup.
                </p>
                <p>
                  Overall speedup is the geometric mean of {benchmarkReport.workloadCount} common
                  workloads. Bundle size is reported separately because smaller is better.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span>{benchmarkReport.runtime}</span>
                <span aria-hidden>·</span>
                <span>best of {benchmarkReport.bestOf}</span>
                <span aria-hidden>·</span>
                <a
                  className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                  href={`${BENCHMARK_COMMIT_BASE_URL}/${benchmarkReport.gitSha}`}
                >
                  source {benchmarkReport.gitSha}
                </a>
              </div>

              <div className="space-y-10">
                <section className="space-y-6">
                  <PerformanceChart report={benchmarkReport} />
                  <BenchmarkSectionTable hideHeading section={performanceSection} />
                </section>
                {performanceSection.relatedSections?.map((relatedSection) => (
                  <BenchmarkSectionTable key={relatedSection.id} section={relatedSection} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
