import { Command } from "commander";
import { migrate } from "./commands/migrate.js";

const VERSION = process.env.VERSION ?? "0.0.1";

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

const program = new Command()
  .name("cnfast")
  .description("CLI for cnfast")
  .version(VERSION, "-v, --version", "display the version number");

program.addCommand(migrate);

const main = async () => {
  await program.parseAsync();
};

main();
