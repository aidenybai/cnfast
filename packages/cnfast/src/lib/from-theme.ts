import { DefaultThemeGroupIds, NoInfer, ThemeGetter, ThemeObject } from "./types";

const fallbackThemeArray: ThemeObject<DefaultThemeGroupIds>[DefaultThemeGroupIds] = [];

export const fromTheme = <
  AdditionalThemeGroupIds extends string = never,
  DefaultThemeGroupIdsInner extends string = DefaultThemeGroupIds,
>(
  key: NoInfer<DefaultThemeGroupIdsInner | AdditionalThemeGroupIds>,
): ThemeGetter => {
  const themeGetter = (theme: ThemeObject<DefaultThemeGroupIdsInner | AdditionalThemeGroupIds>) =>
    theme[key] || fallbackThemeArray;

  themeGetter.isThemeGetter = true as const;

  return themeGetter;
};
