import { cn as cnfastCn, cva } from "../../src/index.js";
import {
  type CvaDataRecord,
  type CvaComponent,
  type CvaSiteDefinition,
} from "../cva/cva-benchmark-types";
import cvaSites from "../cva/cva-sites.json";

const cvaInstances: CvaComponent[] = (cvaSites as CvaSiteDefinition[]).map(
  (siteDefinition) =>
    cva(
      siteDefinition.base as never,
      (siteDefinition.config ?? undefined) as never,
    ) as CvaComponent,
);

const shouldComposeWithCn = process.env.CVA_AB_COMPOSITE === "1";

export const cn = (shouldComposeWithCn
  ? (siteIndex: number, props?: CvaDataRecord): string => cnfastCn(cvaInstances[siteIndex]!(props))
  : (siteIndex: number, props?: CvaDataRecord): string =>
      cvaInstances[siteIndex]!(props)) as unknown as (...classValues: unknown[]) => string;
