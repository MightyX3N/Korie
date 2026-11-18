// Addresses under /web: /web/films, /web/item/<id>, /web/admin/people ... Back and Forward in the
// browser work, and every page can be bookmarked or opened in a new tab.
import { useEffect, useState } from "react";

export const BASE = "/web";

export interface Route { path: string; parts: string[]; query: URLSearchParams }

function read(): Route {
  let p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
  if (!p.startsWith("/")) p = "/" + p;
  return { path: p, parts: p.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(location.search) };
}

const subs = new Set<() => void>();

export function go(to: string, replace = false): void {
  const url = BASE + (to.startsWith("/") ? to : "/" + to);
  if (url === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.scrollTo(0, 0);
  for (const s of subs) s();
}

let moved = 0;
window.addEventListener("popstate", () => (moved = Math.max(0, moved - 1)));

/** Back to the page before (or to fallback when this page was opened directly). */
export function back(fallback = "/"): void {
  if (moved > 0) history.back();
  else go(fallback, true);
}

const push = history.pushState.bind(history);
history.pushState = (...a: Parameters<History["pushState"]>) => {
  moved++;
  push(...a);
};

export function useRoute(): Route {
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    subs.add(on);
    window.addEventListener("popstate", on);
    return () => {
      subs.delete(on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return r;
}

/** An address for a link (so middle-click and Ctrl-click open a new tab). */
export function href(to: string): string {
  return BASE + (to.startsWith("/") ? to : "/" + to);
}

/** A link's click: our own navigation, unless the person asked for a new tab. */
export function follow(e: React.MouseEvent, to: string): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go(to);
}

export function itemPath(id: string): string {
  return `/item/${encodeURIComponent(id)}`;
}
