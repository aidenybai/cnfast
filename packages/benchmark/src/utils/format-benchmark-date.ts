const benchmarkDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatBenchmarkDate = (value: string): string =>
  benchmarkDateFormatter.format(new Date(value));
