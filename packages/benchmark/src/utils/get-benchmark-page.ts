import { DEFAULT_BENCHMARK_PAGE } from "@/constants";
import { getFirstSearchParameter } from "@/utils/get-first-search-parameter";

export const getBenchmarkPage = (
  sectionId: string,
  searchParameters: BenchmarkSearchParams,
): number => {
  const activeSection = getFirstSearchParameter(searchParameters.section);
  if (activeSection !== sectionId) return DEFAULT_BENCHMARK_PAGE;

  const requestedPage = Number(getFirstSearchParameter(searchParameters.page));
  return Number.isInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : DEFAULT_BENCHMARK_PAGE;
};
