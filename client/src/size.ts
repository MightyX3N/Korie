// Sizes follow the real screen: the root font size (1rem) is worked out from
// the window, so every layout scales with it. A phone (narrow screen) gets the
// one-column layout with tabs at the bottom; a TV gets the 10-foot look.
import { isTv } from "./host.ts";

export type Form = "tv" | "desktop" | "phone";
let form: Form = "desktop";
const listeners = new Set<(f: Form) => void>();

export function currentForm(): Form {
  return form;
}

export function onForm(fn: (f: Form) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function update(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const tv = isTv();
  const phone = !tv && Math.min(w, h) < 600 && w < 900;
  // 20px at 1920x1080 (a TV or a big window), never smaller than 13px or larger than 44px
  let base = Math.min(w / 96, h / 54);
  if (!tv) base = Math.min(base, 22);
  base = phone ? 15 : Math.max(13, Math.min(44, base));
  document.documentElement.style.fontSize = base.toFixed(2) + "px";
  const next: Form = tv ? "tv" : phone ? "phone" : "desktop";
  document.body.classList.toggle("phone", next === "phone");
  document.body.classList.toggle("tv", next === "tv");
  if (next !== form) {
    form = next;
    for (const l of listeners) l(form);
  }
}

export function startSizing(): void {
  update();
  window.addEventListener("resize", update);
}
