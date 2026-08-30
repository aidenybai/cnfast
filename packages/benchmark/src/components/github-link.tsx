import { GitHubIcon } from "@/components/github-icon";
import { BENCHMARK_REPOSITORY_URL } from "@/constants";
import { getGitHubStarCount } from "@/utils/get-github-star-count";

const GitHubLinkContent = ({ formattedStarCount }: GitHubLinkContentProps) => (
  <a
    aria-label="View cnfast on GitHub"
    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
    href={BENCHMARK_REPOSITORY_URL}
    rel="noreferrer"
    target="_blank"
  >
    <GitHubIcon aria-hidden className="size-4" />
    {formattedStarCount ? (
      <span className="w-fit text-xs text-muted-foreground tabular-nums">{formattedStarCount}</span>
    ) : null}
  </a>
);

export const GitHubLink = async () => {
  const formattedStarCount = await getGitHubStarCount();

  return <GitHubLinkContent formattedStarCount={formattedStarCount} />;
};

export const GitHubLinkFallback = () => <GitHubLinkContent />;
