import { cn } from "@/lib/utils";
import { createBenchmarkSortUrl } from "@/utils/create-benchmark-sort-url";

export const SortableBenchmarkHeader = ({
  alignEnd = false,
  column,
  label,
  sectionId,
  sortState,
}: SortableBenchmarkHeaderProps) => {
  const isActive = sortState.column === column;
  const sortIcon = isActive ? (sortState.direction === "ascending" ? "↑" : "↓") : "↕";

  return (
    <a
      className={cn(
        "group flex w-full items-center gap-1.5 px-2 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        alignEnd && "justify-end",
        isActive && "text-foreground",
      )}
      href={createBenchmarkSortUrl(sectionId, column, sortState)}
    >
      {label}
      <span
        aria-hidden
        className={cn("text-sm", isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60")}
      >
        {sortIcon}
      </span>
    </a>
  );
};
