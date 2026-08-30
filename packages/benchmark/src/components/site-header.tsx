import { GitHubLink } from "@/components/github-link";
import { ModeSwitcher } from "@/components/mode-switcher";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BENCHMARK_REPOSITORY_URL } from "@/constants";

export const SiteHeader = ({ isDark, onDarkModeChange }: SiteHeaderProps) => (
  <header className="sticky top-0 z-50 w-full bg-background">
    <div className="container-wrapper px-6">
      <div className="flex h-14 items-center lg:h-16 [&_[data-slot=separator]]:h-4 [&_[data-slot=separator]]:self-center!">
        <nav className="hidden items-center gap-0 lg:flex">
          <Button
            className="px-2.5"
            nativeButton={false}
            render={<a href={BENCHMARK_REPOSITORY_URL}>cnfast</a>}
            size="sm"
            variant="ghost"
          />
          <Button className="px-2.5" size="sm" variant="ghost">
            Benchmark
          </Button>
        </nav>
        <Button className="px-0 text-base lg:hidden" size="sm" variant="ghost">
          cnfast
        </Button>
        <div className="ml-auto flex items-center gap-2 md:flex-1 md:justify-end">
          <Separator className="ml-2 hidden lg:block" orientation="vertical" />
          <GitHubLink />
          <Separator orientation="vertical" />
          <ModeSwitcher isDark={isDark} onDarkModeChange={onDarkModeChange} />
        </div>
      </div>
    </div>
  </header>
);
