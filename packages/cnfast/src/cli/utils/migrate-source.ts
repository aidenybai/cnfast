import MagicString from "magic-string";
import { DEFAULT_EXPORT_NAME, MIGRATABLE_SOURCES, TARGET_PACKAGE } from "../constants.js";

export interface MigrationResult {
  code: string;
  changeCount: number;
}

const STATIC_IMPORT_REGEX = /^[ \t]*(import|export)\s+([^;'"()]*?)\s+from\s*(['"])([^'"]+)\3/gm;
const DYNAMIC_IMPORT_REGEX = /\b(import|require)\s*\(\s*(['"])([^'"]+)\2\s*\)/g;
const SIDE_EFFECT_IMPORT_REGEX = /(^|\n)([ \t]*import\s+)(['"])([^'"]+)\3/g;

const isMigratableSource = (source: string): boolean =>
  (MIGRATABLE_SOURCES as readonly string[]).includes(source);

const rewriteImportClause = (rawClause: string, source: string): string | null => {
  const clause = rawClause.trim();

  if (/^\*\s+as\s+/.test(clause)) return null;

  const bracesMatch = clause.match(/\{([\s\S]*)\}/);
  const defaultPart = (bracesMatch ? clause.slice(0, bracesMatch.index) : clause)
    .replace(/,\s*$/, "")
    .trim();

  if (defaultPart === "" || /\s/.test(defaultPart)) return null;

  const namedExport = DEFAULT_EXPORT_NAME[source];
  const namedSpecifier =
    defaultPart === namedExport ? namedExport : `${namedExport} as ${defaultPart}`;
  const namedBody = bracesMatch ? bracesMatch[1].trim() : "";

  return namedBody ? `{ ${namedSpecifier}, ${namedBody} }` : `{ ${namedSpecifier} }`;
};

export const migrateSource = (code: string): MigrationResult => {
  const magic = new MagicString(code);
  let changeCount = 0;

  for (const match of code.matchAll(STATIC_IMPORT_REGEX)) {
    const [statement, keyword, clause, quote, source] = match;
    if (match.index === undefined || !isMigratableSource(source)) continue;

    const statementStart = match.index;
    const sourceTokenStart = statementStart + statement.length - (source.length + 2);
    const newClause = keyword === "import" ? rewriteImportClause(clause, source) : null;

    if (newClause === null) {
      magic.overwrite(
        sourceTokenStart,
        statementStart + statement.length,
        `${quote}${TARGET_PACKAGE}${quote}`,
      );
    } else {
      magic.overwrite(
        statementStart,
        statementStart + statement.length,
        `${keyword} ${newClause} from ${quote}${TARGET_PACKAGE}${quote}`,
      );
    }
    changeCount++;
  }

  for (const match of code.matchAll(DYNAMIC_IMPORT_REGEX)) {
    const [, , quote, source] = match;
    if (match.index === undefined || !isMigratableSource(source)) continue;

    const sourceTokenStart = match.index + match[0].indexOf(`${quote}${source}${quote}`);
    magic.overwrite(
      sourceTokenStart,
      sourceTokenStart + source.length + 2,
      `${quote}${TARGET_PACKAGE}${quote}`,
    );
    changeCount++;
  }

  for (const match of code.matchAll(SIDE_EFFECT_IMPORT_REGEX)) {
    const [, leading, importKeyword, quote, source] = match;
    if (match.index === undefined || !isMigratableSource(source)) continue;

    const sourceTokenStart = match.index + leading.length + importKeyword.length;
    magic.overwrite(
      sourceTokenStart,
      sourceTokenStart + source.length + 2,
      `${quote}${TARGET_PACKAGE}${quote}`,
    );
    changeCount++;
  }

  return { code: magic.toString(), changeCount };
};
