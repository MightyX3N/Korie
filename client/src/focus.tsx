// Moving around with a remote: built on Norigin Spatial Navigation (made for TV
// apps). Every area is a focus group with its own rules: the menu is one column
// that stops at the top and bottom, rows move left and right in order, and
// groups remember where you were. Focusing something scrolls it into view
// with room around it; near the top of a page the page scrolls all the way up.
import { createContext, useContext, useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import {
  init, useFocusable, FocusContext, setFocus, getCurrentFocusKey, doesFocusableExist, type FocusableComponentLayout,
} from "@noriginmedia/norigin-spatial-navigation";

export { setFocus, getCurrentFocusKey, doesFocusableExist };

export function startFocus(): void {
  init({ debug: false, visualDebug: false, throttle: 70, throttleKeypresses: true, shouldFocusDOMNode: false, distanceCalculationMethod: "center" });
}

/** True while the mouse is in use (hover focuses, no scrolling jumps). */
export const pointer = { active: false };

function scrollParent(el: HTMLElement, axis: "x" | "y"): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    if (axis === "y" && p.classList.contains("scroll")) return p;
    if (axis === "x" && p.classList.contains("strip")) return p;
    p = p.parentElement;
  }
  return null;
}

export function ensureVisible(el: HTMLElement | null): void {
  if (!el || pointer.active) return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const v = scrollParent(el, "y");
  if (v) {
    const r = el.getBoundingClientRect();
    const pr = v.getBoundingClientRect();
    const top = r.top - pr.top + v.scrollTop; // position inside the scrolled content
    const margin = 4 * rem;
    if (top < pr.height * 0.55) v.scrollTo({ top: 0, behavior: "smooth" });
    else if (r.top < pr.top + margin) v.scrollTo({ top: top - margin, behavior: "smooth" });
    else if (r.bottom > pr.bottom - margin) v.scrollTo({ top: top + r.height - pr.height + margin, behavior: "smooth" });
  }
  const h = scrollParent(el, "x");
  if (h) {
    const r = el.getBoundingClientRect();
    const pr = h.getBoundingClientRect();
    const margin = 1.5 * rem;
    if (r.left < pr.left + margin) h.scrollLeft -= pr.left + margin - r.left;
    else if (r.right > pr.right - margin) h.scrollLeft += r.right - (pr.right - margin);
  }
}

interface FProps {
  fk?: string;
  onEnter?: () => void;
  onFocus?: (layout: FocusableComponentLayout) => void;
  onArrow?: (dir: string) => boolean;
  onLong?: () => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
}

/** Something you can move to and press. Click and tap work too. */
export function F({ fk, onEnter, onFocus, onArrow, onLong, className, style, children, disabled, title }: FProps) {
  const holdTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const { ref, focused, focusSelf } = useFocusable({
    focusKey: fk,
    onEnterPress: (_p, details) => {
      // holding OK for a moment opens the options (like a long press)
      if (onLong && details?.pressedKeys && (details.pressedKeys.enter ?? 0) > 1) {
        if (!longFired.current) {
          longFired.current = true;
          onLong();
        }
        return;
      }
      if (!disabled) onEnter?.();
    },
    onEnterRelease: () => {
      longFired.current = false;
    },
    onFocus: (layout) => {
      ensureVisible(ref.current);
      onFocus?.(layout);
    },
    onArrowPress: (dir) => (onArrow ? onArrow(dir) : true),
  });
  return (
    <div
      ref={ref}
      className={(className ?? "") + (focused ? " focused" : "")}
      style={style}
      role="button"
      title={title}
      aria-disabled={disabled ? "true" : undefined}
      onMouseEnter={() => pointer.active && focusSelf()}
      onClick={() => {
        if (longFired.current) return;
        focusSelf();
        if (!disabled) onEnter?.();
      }}
      onContextMenu={(e) => {
        if (onLong) {
          e.preventDefault();
          onLong();
        }
      }}
      onTouchStart={() => {
        if (!onLong) return;
        holdTimer.current = window.setTimeout(() => {
          longFired.current = true;
          onLong();
        }, 550);
      }}
      onTouchEnd={() => {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        window.setTimeout(() => (longFired.current = false), 50);
      }}
    >
      {children}
    </div>
  );
}

interface GProps {
  fk?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** keep focus inside in these directions (the menu stops at its top and bottom) */
  stop?: ("up" | "down" | "left" | "right")[];
  preferred?: string;
  remember?: boolean;
  onArrow?: (dir: string) => boolean;
}

/** A group of focusable things that remembers where you were in it. */
export function G({ fk, className, style, children, stop, preferred, remember = true, onArrow }: GProps) {
  const { ref, focusKey } = useFocusable({
    focusKey: fk,
    focusable: true,
    trackChildren: false,
    saveLastFocusedChild: remember,
    isFocusBoundary: !!stop?.length,
    focusBoundaryDirections: stop,
    preferredChildFocusKey: preferred,
    onArrowPress: (dir) => (onArrow ? onArrow(dir) : true),
  });
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={className} style={style}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}

/** Focus this key once it exists (after a screen has drawn). */
export function useFocusOnMount(key: string | null, deps: unknown[] = []): void {
  useEffect(() => {
    if (!key) return;
    let tries = 0;
    const t = window.setInterval(() => {
      if (doesFocusableExist(key)) {
        setFocus(key);
        clearInterval(t);
      } else if (++tries > 40) clearInterval(t);
    }, 25);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const ScreenKey = createContext("screen");
export function useScreenKey(): string {
  return useContext(ScreenKey);
}
