import pc from "picocolors";

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
}

export const generateDiff = (originalContent: string, newContent: string): DiffLine[] => {
  const originalLines = originalContent.split("\n");
  const newLines = newContent.split("\n");
  const diff: DiffLine[] = [];

  let originalIndex = 0;
  let newIndex = 0;

  while (originalIndex < originalLines.length || newIndex < newLines.length) {
    const originalLine = originalLines[originalIndex];
    const newLine = newLines[newIndex];

    if (originalLine === newLine) {
      diff.push({ type: "unchanged", content: originalLine });
      originalIndex++;
      newIndex++;
    } else if (originalLine === undefined) {
      diff.push({ type: "added", content: newLine });
      newIndex++;
    } else if (newLine === undefined) {
      diff.push({ type: "removed", content: originalLine });
      originalIndex++;
    } else {
      const originalInNew = newLines.indexOf(originalLine, newIndex);
      const newInOriginal = originalLines.indexOf(newLine, originalIndex);

      if (
        originalInNew !== -1 &&
        (newInOriginal === -1 || originalInNew - newIndex < newInOriginal - originalIndex)
      ) {
        while (newIndex < originalInNew) {
          diff.push({ type: "added", content: newLines[newIndex] });
          newIndex++;
        }
      } else if (newInOriginal !== -1) {
        while (originalIndex < newInOriginal) {
          diff.push({ type: "removed", content: originalLines[originalIndex] });
          originalIndex++;
        }
      } else {
        diff.push({ type: "removed", content: originalLine });
        diff.push({ type: "added", content: newLine });
        originalIndex++;
        newIndex++;
      }
    }
  }

  return diff;
};

export const formatDiff = (diff: DiffLine[], contextLines: number = 2): string => {
  const lines: string[] = [];
  let lastPrintedIndex = -1;

  const changedIndices = diff
    .map((line, index) => (line.type !== "unchanged" ? index : -1))
    .filter((index) => index !== -1);

  if (changedIndices.length === 0) return pc.dim("No changes");

  for (const changedIndex of changedIndices) {
    const startContext = Math.max(0, changedIndex - contextLines);
    const endContext = Math.min(diff.length - 1, changedIndex + contextLines);

    if (startContext > lastPrintedIndex + 1 && lastPrintedIndex !== -1) {
      lines.push(pc.dim("  …"));
    }

    for (
      let lineIndex = Math.max(startContext, lastPrintedIndex + 1);
      lineIndex <= endContext;
      lineIndex++
    ) {
      const diffLine = diff[lineIndex];

      if (diffLine.type === "added") {
        lines.push(pc.green(`+ ${diffLine.content}`));
      } else if (diffLine.type === "removed") {
        lines.push(pc.red(`- ${diffLine.content}`));
      } else {
        lines.push(pc.dim(`  ${diffLine.content}`));
      }

      lastPrintedIndex = lineIndex;
    }
  }

  return lines.join("\n");
};

export const printDiff = (filePath: string, originalContent: string, newContent: string): void => {
  console.log(pc.bold(filePath));
  console.log(formatDiff(generateDiff(originalContent, newContent)));
  console.log("");
};
