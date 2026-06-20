import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import prompts from "prompts";
import { printDiff } from "../utils/diff.js";
import { findSourceFiles } from "../utils/find-source-files.js";
import { handleError } from "../utils/handle-error.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";
import { migrateSource } from "../utils/migrate-source.js";
import { spinner } from "../utils/spinner.js";

const VERSION = process.env.VERSION ?? "0.0.1";

interface PendingMigration {
  filePath: string;
  originalContent: string;
  newContent: string;
  changeCount: number;
}

export const migrate = new Command()
  .name("migrate")
  .description("rewrite clsx / classnames / tailwind-merge imports to cnfast")
  .option("-c, --cwd <cwd>", "working directory (defaults to current directory)", process.cwd())
  .option("-d, --dry-run", "preview changes without writing files", false)
  .option("-y, --yes", "apply changes without confirmation", false)
  .action(async (opts) => {
    console.log(`${pc.magenta("✿")} ${pc.bold("cnfast")} ${pc.gray(VERSION)}`);
    console.log();

    try {
      const cwd = resolve(opts.cwd);

      const scanSpinner = spinner("Scanning files.").start();
      const files = await findSourceFiles(cwd);

      const pending: PendingMigration[] = [];
      for (const filePath of files) {
        const originalContent = readFileSync(filePath, "utf-8");
        const { code, changeCount } = migrateSource(originalContent);
        if (changeCount > 0 && code !== originalContent) {
          pending.push({ filePath, originalContent, newContent: code, changeCount });
        }
      }

      if (pending.length === 0) {
        scanSpinner.succeed("No clsx / classnames / tailwind-merge imports found.");
        return;
      }

      const totalChanges = pending.reduce((sum, item) => sum + item.changeCount, 0);
      scanSpinner.succeed(
        `Found ${highlighter.info(String(totalChanges))} import(s) across ${highlighter.info(String(pending.length))} file(s).`,
      );
      logger.break();

      for (const item of pending) {
        printDiff(relative(cwd, item.filePath), item.originalContent, item.newContent);
      }

      if (opts.dryRun) {
        logger.info("Dry run — no files were changed.");
        return;
      }

      if (!opts.yes) {
        const { confirm } = await prompts({
          type: "confirm",
          name: "confirm",
          message: `Migrate ${pending.length} file(s) to cnfast?`,
          initial: true,
        });
        if (!confirm) {
          logger.break();
          logger.warn("Aborted. No files were changed.");
          return;
        }
        logger.break();
      }

      const writeSpinner = spinner("Writing files.").start();
      for (const item of pending) {
        writeFileSync(item.filePath, item.newContent);
      }
      writeSpinner.succeed(`Migrated ${pending.length} file(s) to cnfast.`);
      logger.break();
      logger.log(
        `Next: install cnfast and remove unused deps with ${highlighter.info("npm i cnfast")}.`,
      );
    } catch (error) {
      handleError(error);
    }
  });
