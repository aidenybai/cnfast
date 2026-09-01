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

interface MigrateOptions {
  cwd: string;
  dryRun: boolean;
  yes: boolean;
}

export const migrate = new Command()
  .name("migrate")
  .description("rewrite clsx / classnames / tailwind-merge imports to cnfast")
  .option("-c, --cwd <cwd>", "working directory (defaults to current directory)", process.cwd())
  .option("-d, --dry-run", "preview changes without writing files", false)
  .option("-y, --yes", "apply changes without confirmation", false)
  .action(async (options: MigrateOptions) => {
    console.log(`${pc.magenta("✿")} ${pc.bold("cnfast")} ${pc.gray(VERSION)}`);
    console.log();

    try {
      const workingDirectory = resolve(options.cwd);

      const scanSpinner = spinner("Scanning files.").start();
      const sourceFilePaths = await findSourceFiles(workingDirectory);

      const pendingMigrations: PendingMigration[] = [];
      for (const filePath of sourceFilePaths) {
        const originalContent = readFileSync(filePath, "utf-8");
        const { code, changeCount } = migrateSource(originalContent);
        if (changeCount > 0 && code !== originalContent) {
          pendingMigrations.push({ filePath, originalContent, newContent: code, changeCount });
        }
      }

      if (pendingMigrations.length === 0) {
        scanSpinner.succeed("No clsx / classnames / tailwind-merge imports found.");
        return;
      }

      const totalChanges = pendingMigrations.reduce(
        (total, pendingMigration) => total + pendingMigration.changeCount,
        0,
      );
      scanSpinner.succeed(
        `Found ${highlighter.info(String(totalChanges))} import(s) across ${highlighter.info(String(pendingMigrations.length))} file(s).`,
      );
      logger.break();

      for (const pendingMigration of pendingMigrations) {
        printDiff(
          relative(workingDirectory, pendingMigration.filePath),
          pendingMigration.originalContent,
          pendingMigration.newContent,
        );
      }

      if (options.dryRun) {
        logger.info("Dry run: no files were changed.");
        return;
      }

      if (!options.yes) {
        const { confirm } = await prompts({
          type: "confirm",
          name: "confirm",
          message: `Migrate ${pendingMigrations.length} file(s) to cnfast?`,
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
      for (const pendingMigration of pendingMigrations) {
        writeFileSync(pendingMigration.filePath, pendingMigration.newContent);
      }
      writeSpinner.succeed(`Migrated ${pendingMigrations.length} file(s) to cnfast.`);
      logger.break();
      logger.log(
        `Next: install cnfast and remove unused deps with ${highlighter.info("npm i cnfast")}.`,
      );
    } catch (error) {
      handleError(error);
    }
  });
