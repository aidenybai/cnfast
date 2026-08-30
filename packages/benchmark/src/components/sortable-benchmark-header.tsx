import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

export const SortableBenchmarkHeader = ({
  alignEnd = false,
  column,
  label,
  onSort,
  sortState,
}: SortableBenchmarkHeaderProps) => {
  const isActive = sortState.column === column;

  return (
    <button
      className={cn(
        "group flex w-full items-center gap-1.5 px-2 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        alignEnd && "justify-end",
        isActive && "text-foreground",
      )}
      onClick={() => onSort(column)}
      type="button"
    >
      {label}
      {isActive ? (
        sortState.direction === "ascending" ? (
          <ArrowUp aria-hidden className="size-3.5" />
        ) : (
          <ArrowDown aria-hidden className="size-3.5" />
        )
      ) : (
        <ArrowUpDown
          aria-hidden
          className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60"
        />
      )}
    </button>
  );
};
