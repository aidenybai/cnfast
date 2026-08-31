import latestBenchmarkReport from "../../../cnfast/bench/latest.json";
import { Suspense } from "react";

import { BenchmarkSectionTable } from "@/components/benchmark-section-table";
import { PerformanceChart } from "@/components/performance-chart";
import { SiteHeader } from "@/components/site-header";
import { BENCHMARK_COMMIT_BASE_URL } from "@/constants";
import generatedBenchmarkData from "@/generated/benchmark-data.json";
import { createPerformanceSection } from "@/utils/create-performance-section";
import { formatBenchmarkDate } from "@/utils/format-benchmark-date";
import { getBenchmarkSortState } from "@/utils/get-benchmark-sort-state";

const benchmarkReport: BenchmarkReport = latestBenchmarkReport;
const benchmarkSiteData: BenchmarkSiteData = generatedBenchmarkData;
const performanceSection = createPerformanceSection(benchmarkReport, benchmarkSiteData);

const PerformanceBenchmarkTable = async ({ searchParams }: BenchmarkTablesProps) => {
  const resolvedSearchParams = await searchParams;

  return (
    <BenchmarkSectionTable
      hideHeading
      section={performanceSection}
      sortState={getBenchmarkSortState(performanceSection.id, resolvedSearchParams)}
    />
  );
};

const RelatedBenchmarkTables = async ({ searchParams }: BenchmarkTablesProps) => {
  const resolvedSearchParams = await searchParams;

  return performanceSection.relatedSections?.map((relatedSection) => (
    <BenchmarkSectionTable
      key={relatedSection.id}
      section={relatedSection}
      sortState={getBenchmarkSortState(relatedSection.id, resolvedSearchParams)}
    />
  ));
};

const BenchmarkPage = ({ searchParams }: BenchmarkPageProps) => {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="container-wrapper flex flex-1 flex-col px-2">
        <div className="flex scroll-mt-24 items-stretch pb-8 text-[1.05rem] sm:text-[15px] xl:w-full">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-1 flex-col gap-6 px-4 py-6 text-foreground md:px-0 lg:py-8 dark:text-foreground">
              <header className="flex flex-col gap-2">
                <h1 className="scroll-m-24 text-3xl font-semibold tracking-tight sm:text-3xl">
                  <code className="relative rounded bg-muted px-[0.3em] py-[0.125em] font-mono text-[0.85em] font-semibold">
                    cn
                  </code>{" "}
                  benchmark
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
                  Overall speedup is balanced across {benchmarkReport.workloadGroupCount} workload
                  groups containing {benchmarkReport.workloadCount} workloads. Bundle size is
                  reported separately because smaller is better.
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
                  <Suspense
                    fallback={
                      <div
                        aria-label="Loading performance benchmarks"
                        className="h-96 animate-pulse rounded-lg border bg-muted/40"
                        role="status"
                      />
                    }
                  >
                    <PerformanceBenchmarkTable searchParams={searchParams} />
                  </Suspense>
                </section>
                <Suspense
                  fallback={
                    <div
                      aria-label="Loading bundle benchmarks"
                      className="h-40 animate-pulse rounded-lg border bg-muted/40"
                      role="status"
                    />
                  }
                >
                  <RelatedBenchmarkTables searchParams={searchParams} />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default BenchmarkPage;
