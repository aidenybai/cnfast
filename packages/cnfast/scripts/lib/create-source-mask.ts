const canStartRegularExpression = (source: string, index: number): boolean => {
  let previousIndex = index - 1;
  while (/\s/.test(source[previousIndex] ?? "")) previousIndex--;
  if (previousIndex < 0) return true;
  if ("=(:,[!&|?{};".includes(source[previousIndex]!)) return true;

  const precedingSource = source.slice(0, previousIndex + 1);
  return /\b(?:case|delete|return|throw|typeof|void|yield)$/.test(precedingSource);
};

const markExecutableCode = (
  source: string,
  sourceMask: Uint8Array,
  startIndex: number,
  stopsAtBrace: boolean,
): number => {
  let braceDepth = 0;
  let index = startIndex;

  while (index < source.length) {
    const character = source[index]!;
    const nextCharacter = source[index + 1];

    if (source.startsWith("<!--", index)) {
      const commentEnd = source.indexOf("-->", index + 4);
      index = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }

    if (stopsAtBrace && character === "}" && braceDepth === 0) {
      sourceMask[index] = 1;
      return index + 1;
    }

    if (character === "/" && nextCharacter === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index++;
      }
      index += 2;
      continue;
    }

    if (character === "/" && canStartRegularExpression(source, index)) {
      index++;
      let isInCharacterClass = false;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index] === "[") {
          isInCharacterClass = true;
          index++;
        } else if (source[index] === "]") {
          isInCharacterClass = false;
          index++;
        } else if (source[index] === "/" && !isInCharacterClass) {
          index++;
          while (/[a-z]/i.test(source[index] ?? "")) index++;
          break;
        } else if (source[index] === "\n") {
          break;
        } else {
          index++;
        }
      }
      continue;
    }

    if (character === '"' || character === "'") {
      sourceMask[index] = 1;
      const quote = character;
      index++;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index] === quote) {
          index++;
          break;
        } else {
          index++;
        }
      }
      continue;
    }

    if (character === "`") {
      sourceMask[index] = 1;
      index++;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index] === "`") {
          index++;
          break;
        } else if (source[index] === "$" && source[index + 1] === "{") {
          index = markExecutableCode(source, sourceMask, index + 2, true);
        } else {
          index++;
        }
      }
      continue;
    }

    sourceMask[index] = 1;
    if (character === "{") braceDepth++;
    else if (character === "}") braceDepth--;
    index++;
  }

  return index;
};

export const createSourceMask = (source: string): Uint8Array => {
  const sourceMask = new Uint8Array(source.length);
  markExecutableCode(source, sourceMask, 0, false);
  return sourceMask;
};
