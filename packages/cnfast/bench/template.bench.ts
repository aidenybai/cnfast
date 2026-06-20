import { cn } from "../src/index.js";
import { benchOne, gitSha, keepAlive, referenceCn } from "./lib/harness";

// Tagged-template identity cache vs the equivalent variadic call and the baseline. Every form
// renders the SAME stable call site repeatedly with a small set of alternating dynamic values --
// the real component re-render pattern. `cn`...`` keys on the template's stable strings-array
// identity, so a repeat skips building and hashing the joined string entirely; `cn(...)` and the
// reference must rebuild + rehash the key on every call. All three return identical output.
const VARIANTS: (string | false)[] = ["bg-blue-500", false, "bg-red-500", false];
const BASE = "rounded-lg border bg-card px-4 py-2 text-sm font-medium shadow-sm";

const renderTemplate = (): number => {
  let sink = 0;
  for (let index = 0; index < VARIANTS.length; index++) {
    const variant = VARIANTS[index]!;
    sink += cn`rounded-lg border bg-card px-4 py-2 text-sm font-medium shadow-sm ${
      variant && variant
    }`.length;
  }
  return sink;
};

const renderVariadic = (): number => {
  let sink = 0;
  for (let index = 0; index < VARIANTS.length; index++) sink += cn(BASE, VARIANTS[index]!).length;
  return sink;
};

const renderReference = (): number => {
  let sink = 0;
  for (let index = 0; index < VARIANTS.length; index++) {
    sink += referenceCn(BASE, VARIANTS[index]!).length;
  }
  return sink;
};

const template = await benchOne(renderTemplate);
const variadic = await benchOne(renderVariadic);
const reference = await benchOne(renderReference);

console.log(
  `\nTagged-template identity cache (stable call site, alternating variant). sha=${gitSha}\n`,
);
console.table([
  {
    form: "cn`...` (template)",
    "ops/s": Math.round(template).toLocaleString("en-US"),
    "vs reference": `${(template / reference).toFixed(2)}x`,
    "vs cn(...)": `${(template / variadic).toFixed(2)}x`,
  },
  {
    form: "cn(...) (variadic)",
    "ops/s": Math.round(variadic).toLocaleString("en-US"),
    "vs reference": `${(variadic / reference).toFixed(2)}x`,
    "vs cn(...)": "1.00x",
  },
  {
    form: "clsx + tailwind-merge",
    "ops/s": Math.round(reference).toLocaleString("en-US"),
    "vs reference": "1.00x",
    "vs cn(...)": `${(reference / variadic).toFixed(2)}x`,
  },
]);

keepAlive();
