export interface CvaDataRecord {
  [propName: string]: unknown;
}

export interface CvaSiteDefinition {
  base: unknown;
  config: CvaDataRecord | null;
}

export interface CvaComponent {
  (props?: CvaDataRecord): string;
}

export type CvaCallRow = [siteIndex: number] | [siteIndex: number, props: CvaDataRecord];
