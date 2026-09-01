import { cn as cnfastCn, cva } from "../../src/index.js";
import cvaSites from "../cva/cva-sites.json";

type AnyProps = Record<string, unknown>;

interface CvaComponent {
  (props?: AnyProps): string;
}

interface CvaSiteDefinition {
  base: unknown;
  config: AnyProps | null;
}

const instances: CvaComponent[] = (cvaSites as CvaSiteDefinition[]).map(
  (site) => cva(site.base as never, (site.config ?? undefined) as never) as CvaComponent,
);

// Rows in bench/cva/cva-calls.json are [siteIndex, props?]; CVA_AB_COMPOSITE=1
// additionally routes the result through cnfast's cn on BOTH shims so the
// composite lane isolates the cva difference.
const isComposite = process.env.CVA_AB_COMPOSITE === "1";

export const cn = (isComposite
  ? (siteIndex: number, props?: AnyProps): string => cnfastCn(instances[siteIndex]!(props))
  : (siteIndex: number, props?: AnyProps): string => instances[siteIndex]!(props)) as unknown as (
  ...classValues: unknown[]
) => string;
