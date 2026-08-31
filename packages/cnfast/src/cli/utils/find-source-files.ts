import { glob } from "tinyglobby";
import { IGNORED_GLOBS, SOURCE_FILE_GLOBS } from "../constants.js";

export const findSourceFiles = (workingDirectory: string): Promise<string[]> =>
  glob(SOURCE_FILE_GLOBS, {
    cwd: workingDirectory,
    ignore: IGNORED_GLOBS,
    absolute: true,
    dot: false,
  });
