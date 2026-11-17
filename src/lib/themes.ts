/**
 * Portal colour themes, chosen per agent from the avatar menu.
 *
 * To add one: list it here, then give it a `[data-theme="<id>"]` block of
 * colour variables in src/app/globals.css. `dark: true` also sets the `dark`
 * class, which switches on the `dark:` Tailwind variants and dark charts.
 */
export const THEMES = [
  { id: "simple", label: "Simple", dark: false, swatch: ["#ffffff", "#2b4f8a"] },
  { id: "simple-dark", label: "Simple Dark", dark: true, swatch: ["#1b1d24", "#86a8e6"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "simple";

export function isTheme(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function themeById(id: string | null | undefined) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
