// Add-ons that look after households (permission "households" in addon.json): Korie asks them
// whether a household may come in, tells them when one signs up, and passes them requests to
// /api/hook/<add-on>/... (a payment service's page back, or its notices). Korie itself includes
// no such add-on: what one does, and whether it's allowed where it's used, is up to whoever installs it.
import * as addons from "./addons/manager.ts";
import * as households from "./households.ts";
import { log } from "./config.ts";

export interface Verdict { allow: boolean; message: string; url: string }

const OK: Verdict = { allow: true, message: "", url: "" };
/** what the add-ons last said per household, and when (seconds) */
const said = new Map<string, { v: Verdict; at: number }>();
const FRESH = 10 * 60;

export function guards(): string[] {
  return addons.enabledIds().filter((id) => addons.manifests.get(id)?.permissions.includes("households"));
}

function hhFor(h: households.Household, addon: string) {
  return { id: h.id, name: h.name, created: h.created, state: h.state, people: h.people, data: households.addonData(h.id, addon) };
}

/** Keeps what an add-on asked to keep about a household (save_household = { ... }). */
function keep(addon: string, household: string, res: any): void {
  if (res && typeof res === "object" && res.save_household && typeof res.save_household === "object" && !Array.isArray(res.save_household)) {
    households.setAddonData(household, addon, { ...households.addonData(household, addon), ...res.save_household });
  }
}

/** Asks every guarding add-on (the first that refuses decides). The home household always may. */
export async function check(householdId: string): Promise<Verdict> {
  const h = households.get(householdId);
  if (!h || h.home) return OK;
  let v = OK;
  for (const id of guards()) {
    if (!(await addons.has(id, "access"))) continue;
    try {
      const res = await addons.call(id, "access", [addons.ctx(id).ctx, hhFor(h, id)]);
      keep(id, h.id, res);
      if (res && typeof res === "object" && res.allow === false) {
        v = { allow: false, message: String(res.message ?? "This household can't watch right now."), url: /^https:\/\//.test(String(res.url ?? "")) ? String(res.url) : "" };
        break;
      }
    } catch (e) {
      // an add-on that fails doesn't lock people out
      log("access", `${id} access(): ${e instanceof Error ? e.message : e}`);
    }
  }
  said.set(h.id, { v, at: Date.now() / 1000 });
  return v;
}

/** What was last said (checked again in the background once it's 10 minutes old). */
export function cached(householdId: string): Verdict {
  if (householdId === "home" || !guards().length) return OK;
  const s = said.get(householdId);
  if (!s || Date.now() / 1000 - s.at > FRESH) {
    said.set(householdId, { v: s?.v ?? OK, at: Date.now() / 1000 });
    void check(householdId);
  }
  return s?.v ?? OK;
}

export function forget(householdId: string): void {
  said.delete(householdId);
}

/** A household signed up (or an admin made one): the add-ons hear of it. */
export async function registered(householdId: string): Promise<void> {
  const h = households.get(householdId);
  if (!h) return;
  for (const id of guards()) {
    if (!(await addons.has(id, "registered"))) continue;
    try {
      keep(id, h.id, await addons.call(id, "registered", [addons.ctx(id).ctx, hhFor(h, id)]));
    } catch (e) {
      log("access", `${id} registered(): ${e instanceof Error ? e.message : e}`);
    }
  }
  forget(h.id);
}

export interface HookAnswer { status: number; type: string; body: string; redirect: string }

/** A request to /api/hook/<add-on>/<path>: the add-on's web(ctx, request) answers it. */
export async function web(addon: string, req: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: string }): Promise<HookAnswer | null> {
  if (!guards().includes(addon) || !(await addons.has(addon, "web"))) return null;
  const res = await addons.call(addon, "web", [addons.ctx(addon).ctx, req]);
  if (!res || typeof res !== "object") return { status: 204, type: "text/plain", body: "", redirect: "" };
  // { household = id, save_household = { ... } }: the add-on keeps something about that household
  if (typeof res.household === "string" && households.get(res.household)) {
    keep(addon, res.household, res);
    forget(res.household);
  }
  const status = Number(res.status) >= 200 && Number(res.status) < 600 ? Number(res.status) : 200;
  const redirect = /^(https:\/\/|\/)/.test(String(res.redirect ?? "")) ? String(res.redirect) : "";
  if (res.json !== undefined) return { status, type: "application/json", body: JSON.stringify(res.json), redirect };
  if (typeof res.html === "string") return { status, type: "text/html; charset=utf-8", body: res.html, redirect };
  return { status, type: "text/plain; charset=utf-8", body: String(res.text ?? ""), redirect };
}
