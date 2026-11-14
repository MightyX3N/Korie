// What Korie runs inside: a browser, Korie's Android TV app (window.KorieAndroid,
// added by the app) or Korie's desktop app (window.__TAURI__).

declare global {
  interface Window {
    KorieAndroid?: { isTv(): boolean; apps(): string; launch(pkg: string): void; forgetServer(): void; version(): string };
    __TAURI__?: unknown;
    korieBack?: () => boolean;
  }
}

export const android = typeof window !== "undefined" && !!window.KorieAndroid;
export const desktopApp = typeof navigator !== "undefined" && /KorieDesktop/.test(navigator.userAgent);

export function isTv(): boolean {
  const q = new URLSearchParams(location.search).get("form");
  if (q) return q === "tv";
  try {
    if (window.KorieAndroid?.isTv()) return true;
  } catch {
    /* old app */
  }
  return /\b(TV|AFT\w*|BRAVIA|SHIELD|GoogleTV|SmartTV|Tizen|Web0S)\b/i.test(navigator.userAgent);
}

export interface App { pkg: string; label: string; icon: string }

export function androidApps(): App[] {
  try {
    return JSON.parse(window.KorieAndroid?.apps() ?? "[]");
  } catch {
    return [];
  }
}
