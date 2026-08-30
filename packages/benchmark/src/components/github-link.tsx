import { useEffect, useState } from "react";

import { GitHubIcon } from "@/components/github-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BENCHMARK_REPOSITORY_API_URL,
  BENCHMARK_REPOSITORY_URL,
  GITHUB_STAR_COUNT_ABBREVIATION_THRESHOLD,
  GITHUB_STAR_COUNT_DIVISOR,
} from "@/constants";

const formatStarCount = (starCount: number): string =>
  starCount >= GITHUB_STAR_COUNT_ABBREVIATION_THRESHOLD
    ? `${Math.round(starCount / GITHUB_STAR_COUNT_DIVISOR)}k`
    : starCount.toLocaleString();

export const GitHubLink = () => {
  const [formattedStarCount, setFormattedStarCount] = useState<string>();

  useEffect(() => {
    const abortController = new AbortController();
    const loadStarCount = async (): Promise<void> => {
      const response = await fetch(BENCHMARK_REPOSITORY_API_URL, {
        signal: abortController.signal,
      });
      if (!response.ok) return;

      const repository: GitHubRepositoryResponse = await response.json();
      setFormattedStarCount(formatStarCount(repository.stargazers_count));
    };

    loadStarCount().catch(() => undefined);
    return () => abortController.abort();
  }, []);

  return (
    <Button
      className="h-8 gap-1.5 px-3 shadow-none"
      render={
        <a href={BENCHMARK_REPOSITORY_URL} rel="noreferrer" target="_blank">
          <GitHubIcon className="size-4" />
          {formattedStarCount ? (
            <span className="w-fit text-xs text-muted-foreground tabular-nums">
              {formattedStarCount}
            </span>
          ) : (
            <Skeleton className="h-4 w-10" />
          )}
        </a>
      }
      nativeButton={false}
      size="sm"
      variant="ghost"
    />
  );
};
