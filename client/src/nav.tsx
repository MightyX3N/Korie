// Screens on a stack, tied to the browser's history so the browser's and the
// Android remote's Back both step back. Opening a screen remembers what was
// focused; going back puts the focus there again. Dialogs, menus and the
// on-screen keyboard sit on top of it all and take Back first.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentFocusKey, setFocus, doesFocusableExist } from "./focus.tsx";

export interface Screen { name: string; params: Record<string, any>; focus?: string; key: number }

interface Nav {
  stack: Screen[];
  top: Screen;
  push(name: string, params?: Record<string, any>): void;
  go(name: string, params?: Record<string, any>): void;
  back(): void;
  replace(params: Record<string, any>): void;
}

const NavCtx = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(NavCtx);

let seq = 1;
const backHandlers: (() => boolean)[] = [];

/** While mounted, Back calls fn first (dialogs, the player's panels). */
export function useBackHandler(fn: () => boolean, active = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const h = () => ref.current();
    backHandlers.push(h);
    return () => {
      const i = backHandlers.indexOf(h);
      if (i >= 0) backHandlers.splice(i, 1);
    };
  }, [active]);
}

export function NavProvider({ children, home, first }: { children: (top: Screen) => ReactNode; home: string; first?: string }) {
  const [stack, setStack] = useState<Screen[]>([{ name: first ?? home, params: {}, key: seq++ }]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const restore = (s: Screen | undefined) => {
    if (!s?.focus) return;
    const key = s.focus;
    let n = 0;
    const t = window.setInterval(() => {
      if (doesFocusableExist(key)) {
        setFocus(key);
        clearInterval(t);
      } else if (++n > 40) clearInterval(t);
    }, 25);
  };

  const push = useCallback((name: string, params: Record<string, any> = {}) => {
    const cur = stackRef.current;
    const top = { ...cur[cur.length - 1], focus: getCurrentFocusKey() };
    setStack([...cur.slice(0, -1), top, { name, params, key: seq++ }]);
    history.pushState({ korie: cur.length }, "");
  }, []);

  const go = useCallback((name: string, params: Record<string, any> = {}) => {
    // a section from the menu: a fresh stack (history keeps one entry)
    const depth = stackRef.current.length;
    setStack([{ name, params, key: seq++ }]);
    if (depth > 1) history.go(-(depth - 1));
  }, []);

  const pop = useCallback(() => {
    const cur = stackRef.current;
    if (cur.length <= 1) return;
    const next = cur.slice(0, -1);
    setStack(next);
    restore(next[next.length - 1]);
  }, []);

  const back = useCallback(() => {
    if (stackRef.current.length > 1) history.back();
  }, []);

  const replace = useCallback((params: Record<string, any>) => {
    const cur = stackRef.current;
    const top = cur[cur.length - 1];
    setStack([...cur.slice(0, -1), { ...top, params: { ...top.params, ...params } }]);
  }, []);

  useEffect(() => {
    history.replaceState({ korie: 0 }, "");
    const onPop = () => {
      // history moved back: drop screens until it matches
      const depth = (history.state?.korie ?? 0) + 1;
      const cur = stackRef.current;
      if (cur.length > depth) {
        const next = cur.slice(0, depth);
        setStack(next);
        restore(next[next.length - 1]);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const nav: Nav = { stack, top: stack[stack.length - 1], push, go, back, replace };

  // Back from the keyboard (Esc, Backspace, the TV remote's Back), and from Korie's Android app
  useEffect(() => {
    const doBack = (): boolean => {
      for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return true;
      if (stackRef.current.length > 1) {
        history.back();
        return true;
      }
      if (stackRef.current[0].name !== home) {
        go(home);
        return true;
      }
      return false;
    };
    window.korieBack = doBack;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      const isBack = e.key === "Escape" || e.key === "GoBack" || e.key === "BrowserBack" || e.keyCode === 10009 || e.keyCode === 461 || (e.key === "Backspace" && !typing && !document.body.classList.contains("typing"));
      if (isBack) {
        e.preventDefault();
        doBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, home, pop]);

  return <NavCtx.Provider value={nav}>{children(nav.top)}</NavCtx.Provider>;
}
