// The Korie Store: add-ons from the Korie-Store repository on GitHub. Its
// index.json lists every add-on with its files and their sha256; installing
// downloads them into the server's add-ons folder, checking each file.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { STORE_URL, log } from "../config.ts";
import { fetchText } from "../net.ts";
import { emit } from "../events.ts";
import * as addons from "./manager.ts";

const FRESH = 5 * 60 * 1000;

export interface StoreEntry {
  id: string; name: string; type: string; version: string; author: string; description: string;
  permissions?: string[]; hosts?: string[]; hosts_from_settings?: boolean; games?: boolean;
  path: string; files: { name: string; size: number; sha256: string }[];
}

export const store = { entries: [] as StoreEntry[], at: 0, loading: false, error: "", busy: new Set<string>() };

export async function refresh(force = false): Promise<void> {
  if (store.loading || (!force && Date.now() - store.at < FRESH && store.entries.length)) return;
  store.loading = true;
  const r = await fetchText(STORE_URL + "index.json?t=" + Math.floor(Date.now() / 300000));
  store.loading = false;
  try {
    const v = JSON.parse(r.text);
    if (!Array.isArray(v?.addons)) throw new Error("no add-on list");
    store.entries = v.addons.filter((e: any) => e && typeof e.id === "string" && Array.isArray(e.files));
    store.at = Date.now();
    store.error = "";
  } catch {
    store.error = `Couldn't reach the Store (${r.status || r.error || "no answer"}).`;
  }
  emit("store");
}

export function find(id: string): StoreEntry | undefined {
  return store.entries.find((e) => e.id === id);
}

export function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** "" (not installed), "installed", "update" or "builtin" */
export function status(id: string): string {
  const m = addons.manifests.get(id);
  if (!m) return "";
  if (m.builtin) return "builtin";
  const e = find(id);
  return e && newer(e.version, m.version) ? "update" : "installed";
}

export async function install(id: string): Promise<string> {
  const e = find(id);
  if (!e) return "The Store doesn't have this add-on.";
  if (store.busy.has(id)) return "";
  store.busy.add(id);
  emit("store");
  const tmp = path.join(addons.USER_DIR, ".download-" + id);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  let err = "";
  try {
    if (!e.files.length) throw new Error("The Store lists no files for this add-on.");
    await Promise.all(e.files.map(async (f) => {
      const name = String(f.name ?? "");
      if (!name || name.includes("..") || path.isAbsolute(name)) throw new Error(`The Store lists a file Korie won't write (${name}).`);
      const res = await fetch(STORE_URL + (e.path || "addons/" + id) + "/" + name.split("/").map(encodeURIComponent).join("/"), { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Couldn't download ${name} (${res.status}).`);
      const body = Buffer.from(await res.arrayBuffer());
      if (f.sha256 && crypto.createHash("sha256").update(body).digest("hex") !== f.sha256) throw new Error(`${name} didn't arrive as the Store lists it.`);
      fs.mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true });
      fs.writeFileSync(path.join(tmp, name), body);
    }));
    const dest = path.join(addons.USER_DIR, id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
  } catch (x) {
    err = x instanceof Error ? x.message : String(x);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    store.busy.delete(id);
  }
  log("store", `${id} ${e.version}: ${err || "installed"}`);
  addons.scan();
  emit("store");
  return err;
}

export function uninstall(id: string): boolean {
  const m = addons.manifests.get(id);
  if (!m || m.builtin) return false;
  addons.disable(id);
  fs.rmSync(m.dir, { recursive: true, force: true });
  addons.scan();
  emit("store");
  return true;
}
