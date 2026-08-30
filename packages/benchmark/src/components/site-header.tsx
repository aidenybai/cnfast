import { Suspense } from "react";

import { GitHubLink, GitHubLinkFallback } from "@/components/github-link";
import { ModeSwitcher } from "@/components/mode-switcher";
import { BENCHMARK_REPOSITORY_URL } from "@/constants";

const navigationItemClassName =
  "inline-flex h-7 shrink-0 items-center justify-center rounded-lg border border-transparent px-2.5 text-[0.8rem] font-medium transition-[color,background-color,border-color,box-shadow] outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export const SiteHeader = () => (
  <header className="sticky top-0 z-50 w-full bg-background">
    <div className="container-wrapper px-6">
      <div className="flex h-14 items-center lg:h-16">
        <nav aria-label="Main navigation" className="hidden items-center gap-0 lg:flex">
          <a className={navigationItemClassName} href={BENCHMARK_REPOSITORY_URL}>
            cnfast
          </a>
          <span className={navigationItemClassName}>Benchmark</span>
        </nav>
        <a
          className="inline-flex h-7 items-center rounded-lg px-0 text-base font-medium lg:hidden"
          href={BENCHMARK_REPOSITORY_URL}
        >
          cnfast
        </a>
        <div className="ml-auto flex items-center gap-2 md:flex-1 md:justify-end">
          <span aria-hidden className="ml-2 hidden h-4 w-px bg-border lg:block" />
          <Suspense fallback={<GitHubLinkFallback />}>
            <GitHubLink />
          </Suspense>
          <span aria-hidden className="h-4 w-px bg-border" />
          <ModeSwitcher />
        </div>
      </div>
    </div>
  </header>
);
