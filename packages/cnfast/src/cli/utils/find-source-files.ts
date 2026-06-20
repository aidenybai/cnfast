import { glob } from "tinyglobby";
import { IGNORED_GLOBS, SOURCE_FILE_GLOBS } from "../constants.js";

export const findSourceFiles = (cwd: string): Promise<string[]> =>
  glob(SOURCE_FILE_GLOBS, {
    cwd,
    ignore: IGNORED_GLOBS,
    absolute: true,
    dot: false,
  });
