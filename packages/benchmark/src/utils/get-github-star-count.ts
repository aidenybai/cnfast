import "server-only";

import {
  BENCHMARK_REPOSITORY_API_URL,
  GITHUB_STAR_COUNT_ABBREVIATION_THRESHOLD,
  GITHUB_STAR_COUNT_DIVISOR,
  GITHUB_STAR_COUNT_REVALIDATION_SECONDS,
} from "@/constants";

export const getGitHubStarCount = async (): Promise<string | undefined> => {
  try {
    const response = await fetch(BENCHMARK_REPOSITORY_API_URL, {
      next: { revalidate: GITHUB_STAR_COUNT_REVALIDATION_SECONDS },
    });
    if (!response.ok) return undefined;

    const repository = await response.json();
    if (
      typeof repository !== "object" ||
      repository === null ||
      !("stargazers_count" in repository) ||
      typeof repository.stargazers_count !== "number"
    ) {
      return undefined;
    }

    return repository.stargazers_count >= GITHUB_STAR_COUNT_ABBREVIATION_THRESHOLD
      ? `${Math.round(repository.stargazers_count / GITHUB_STAR_COUNT_DIVISOR)}k`
      : repository.stargazers_count.toLocaleString();
  } catch {
    return undefined;
  }
};
