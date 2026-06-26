import { logger } from "./logger.js";

export const handleError = (error: unknown) => {
  logger.break();
  logger.error("An unexpected error occurred. Please review the details below to troubleshoot the issue.");
  logger.error("If the problem persists, please open an issue on GitHub.");
  logger.error("");
  if (error instanceof Error) {
    logger.error(error.message);
  }
  logger.break();
  process.exit(1);
};
