import { expectTypeOf } from "vitest";

import { cva, type CvaProps, type VariantProps, type VariantSchema } from "../src";

const button = cva("button", {
  variants: {
    intent: { primary: "button--primary", secondary: "button--secondary" },
    size: { small: "button--small", medium: "button--medium" },
    disabled: { true: "button--disabled", false: "button--enabled" },
    m: { 0: "m-0", 1: "m-1" },
  },
  defaultVariants: { intent: "primary", disabled: false },
});

type ButtonVariantProps = VariantProps<typeof button>;

expectTypeOf<keyof ButtonVariantProps>().toEqualTypeOf<"intent" | "size" | "disabled" | "m">();
expectTypeOf<ButtonVariantProps["intent"]>().toEqualTypeOf<
  "primary" | "secondary" | null | undefined
>();
expectTypeOf<ButtonVariantProps["size"]>().toEqualTypeOf<"small" | "medium" | null | undefined>();
expectTypeOf<ButtonVariantProps["disabled"]>().toEqualTypeOf<boolean | null | undefined>();
expectTypeOf<ButtonVariantProps["m"]>().toEqualTypeOf<0 | 1 | null | undefined>();

button({ disabled: true });
button({ disabled: false });
button({ intent: "secondary", size: null });
button({ intent: undefined, m: 0 });
button({ size: "small", class: "adhoc-class" });
button({ size: "small", className: "adhoc-classname" });
button();
button({});

// @ts-expect-error -- class and className are mutually exclusive
button({ class: "adhoc-class", className: "adhoc-classname" });

// @ts-expect-error -- outside the variant's declared values
button({ intent: "bogus" });

// @ts-expect-error -- unknown props are rejected
button({ aCheekyInvalidProp: "lol" });

interface SchemaOfButton extends VariantSchema {
  intent: { primary: string; secondary: string };
}

expectTypeOf<CvaProps<SchemaOfButton>["intent"]>().toEqualTypeOf<
  "primary" | "secondary" | null | undefined
>();
