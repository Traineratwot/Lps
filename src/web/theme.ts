/** Theme switching (light/dark) via a swapable theme stylesheet. */

export type ThemeName = "light" | "dark";

const STORAGE_KEY = "lps-theme";
const THEME_LINK_ID = "app-theme";

export function currentTheme(): ThemeName {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "dark" ? "dark" : "light";
}

export function themeHref(name: ThemeName): string {
  return name === "dark" ? "/theme-dark.css" : "/theme-light.css";
}

/** Points the theme <link> at the requested theme and remembers the choice. */
export function applyTheme(name: ThemeName): void {
  const link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;
  if (link && link.href !== new URL(themeHref(name), location.href).href) {
    link.href = themeHref(name);
  }
  document.documentElement.dataset.theme = name;
  localStorage.setItem(STORAGE_KEY, name);
}
