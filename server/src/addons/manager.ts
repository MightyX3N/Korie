// Add-ons: finding them, turning them on and off, their settings, and calling
// them. An add-on's function either answers, or asks Korie to fetch something
// and call it back:
//   { fetch = "https://..." | { ... }, as = "json" | "text", next = "fn", state = ...,
//     method, headers, body (a table is sent as JSON), cache = seconds }
// Korie only fetches from the add-on's own hosts (and with hosts_from_settings,
// the addresses an admin typed into its settings), and only once an admin let
// it use the internet.
import fs from "node:fs";
import path from "node:path";
import { DATA, log } from "../config.ts";
import { db, json, now } from "../db.ts";
import { fetchText, hostOf } from "../net.ts";
import { emit } from "../events.ts";
import { Sandbox } from "./sandbox.ts";

export const BUILTIN_DIR = path.join(import.meta.dirname, "../../builtin");
export const USER_DIR = path.join(DATA, "addons");
const MAX_STEPS = 24;

export interface Setting { key: string; label: string; type: "text" | "password" | "list"; help?: string; default?: unknown }

export interface Manifest {
  id: string; name: string; type: string; version: string; author: string; description: string; main: string;
  access: string; permissions: string[]; hosts: string[]; hosts_from_settings: boolean; games: boolean;
  settings: Setting[]; builtin: boolean; dir: string; error?: string;
}

export const manifests = new Map<string, Manifest>();
const running = new Map<string, Sandbox>();
const loading = new Map<string, Promise<Sandbox | null>>();
export const logs = new Map<string, string[]>();

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}

function readManifest(dir: string, builtin: boolean): Manifest | null {
  let m: any;
  try {
    m = JSON.parse(fs.readFileSync(path.join(dir, "addon.json"), "utf8"));
  } catch {
    return null;
  }
  if (!m || typeof m.id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(m.id)) return null;
  const settings: Setting[] = Array.isArray(m.settings)
    ? m.settings.filter((s: any) => s && typeof s.key === "string").map((s: any) => ({
      key: s.key, label: str(s.label, s.key), type: ["text", "password", "list"].includes(s.type) ? s.type : "text", help: str(s.help), default: s.default,
    }))
    : [];
  const out: Manifest = {
    id: m.id, name: str(m.name, m.id), type: str(m.type, "content"), version: str(m.version, "0"), author: str(m.author, "unknown"),
    description: str(m.description), main: str(m.main, "main.lua"), access: str(m.access, "sandbox"),
    permissions: Array.isArray(m.permissions) ? m.permissions.filter((x: unknown) => typeof x === "string") : [],
    hosts: Array.isArray(m.hosts) ? m.hosts.filter((x: unknown) => typeof x === "string").map((x: string) => x.toLowerCase()) : [],
    hosts_from_settings: m.hosts_from_settings === true, games: m.games === true, settings, builtin, dir,
  };
  if (out.type !== "content") out.error = "This kind of add-on isn't supported by this Korie.";
  else if (out.access !== "sandbox") out.error = "Add-ons with full access can't run on the server.";
  return out;
}

export function scan(): void {
  const before = new Map([...manifests].map(([id, m]) => [id, m.version + "|" + m.dir]));
  manifests.clear();
  for (const [root, builtin] of [[BUILTIN_DIR, true], [USER_DIR, false]] as const) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(root).filter((n) => !n.startsWith("."));
    } catch {
      continue;
    }
    for (const n of names) {
      const m = readManifest(path.join(root, n), builtin);
      if (m && !(manifests.get(m.id)?.builtin)) manifests.set(m.id, m);
    }
  }
  // built-in add-ons are on from the start
  for (const m of manifests.values()) {
    if (m.builtin && !db.prepare("SELECT 1 FROM addons WHERE id = ?").get(m.id)) {
      db.prepare("INSERT INTO addons(id, enabled, internet, changed) VALUES(?, 1, 1, ?)").run(m.id, now());
    }
  }
  // add-ons that changed (or went) start again; the rest keep running
  for (const [id, sb] of [...running]) {
    const m = manifests.get(id);
    if (!m || before.get(id) !== m.version + "|" + m.dir) {
      sb.close();
      running.delete(id);
      loading.delete(id);
    }
  }
  log("addons", `found ${manifests.size}: ${[...manifests.keys()].join(", ")}`);
  emit("addons");
}

interface State { enabled: boolean; internet: boolean; settings: Record<string, unknown> }

export function state(id: string): State {
  const r = db.prepare("SELECT * FROM addons WHERE id = ?").get(id) as { enabled: number; internet: number; settings: string } | undefined;
  return { enabled: !!r?.enabled, internet: !!r?.internet, settings: json(r?.settings, {}) };
}

export function enabledIds(): string[] {
  return [...manifests.values()].filter((m) => !m.error && state(m.id).enabled).map((m) => m.id);
}

export function needsInternet(id: string): boolean {
  const m = manifests.get(id);
  return !!m && m.permissions.includes("internet") && !state(id).internet;
}

/** Turns an add-on on; internet: the admin said yes to its internet question. */
export function enable(id: string, internet: boolean): string {
  const m = manifests.get(id);
  if (!m) return "There's no such add-on.";
  if (m.error) return m.error;
  if (m.permissions.includes("internet") && !internet && !state(id).internet) return "needs_internet";
  db.prepare(`INSERT INTO addons(id, enabled, internet, changed) VALUES(?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled = 1, internet = MAX(internet, excluded.internet), changed = excluded.changed`).run(id, internet ? 1 : 0, now());
  emit("addons");
  return "";
}

export function disable(id: string): void {
  db.prepare("UPDATE addons SET enabled = 0, changed = ? WHERE id = ?").run(now(), id);
  running.get(id)?.close();
  running.delete(id);
  loading.delete(id);
  emit("addons");
}

export function settingsOf(id: string): Record<string, unknown> {
  const m = manifests.get(id);
  const saved = state(id).settings;
  const out: Record<string, unknown> = {};
  for (const s of m?.settings ?? []) out[s.key] = saved[s.key] ?? s.default ?? (s.type === "list" ? [] : "");
  return out;
}

export function setSetting(id: string, key: string, value: unknown): boolean {
  const m = manifests.get(id);
  const s = m?.settings.find((x) => x.key === key);
  if (!m || !s) return false;
  if (s.type === "list" && !(Array.isArray(value) && value.every((v) => typeof v === "string"))) return false;
  if (s.type !== "list" && typeof value !== "string") return false;
  const saved = state(id).settings;
  saved[key] = value;
  db.prepare(`INSERT INTO addons(id, settings, changed) VALUES(?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, changed = excluded.changed`).run(id, JSON.stringify(saved), now());
  return true;
}

/** Hosts of the addresses an admin typed into the add-on's settings (never passwords). */
export function settingsHosts(id: string): string[] {
  const m = manifests.get(id);
  const vals = settingsOf(id);
  const out = new Set<string>();
  for (const s of m?.settings ?? []) {
    if (s.type === "password") continue;
    for (const raw of ([] as unknown[]).concat(vals[s.key] ?? [])) {
      let a = String(raw).trim().replace(/^stremio:\/\//, "https://");
      if (!a.includes("://") && !a.includes(" ") && /[.:]/.test(a)) a = "http://" + a;
      const h = hostOf(a);
      if (h) out.add(h);
    }
  }
  return [...out];
}

function hostMatches(h: string, patterns: string[]): boolean {
  return patterns.some((p) => p === h || (p.startsWith("*.") && (h.endsWith(p.slice(1)) || h === p.slice(2))));
}

export function mayFetch(id: string, url: string): boolean {
  const m = manifests.get(id);
  if (!m || !m.permissions.includes("internet") || !state(id).internet) return false;
  const h = hostOf(url);
  if (url.startsWith("https://") && hostMatches(h, m.hosts)) return true;
  // an admin typed these addresses: a server at home often has no https
  return m.hosts_from_settings && /^https?:\/\//.test(url) && hostMatches(h, settingsHosts(id));
}

function addLog(id: string, msg: string): void {
  const l = logs.get(id) ?? [];
  l.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (l.length > 200) l.splice(0, l.length - 200);
  logs.set(id, l);
}

async function sandbox(id: string): Promise<Sandbox | null> {
  const r = running.get(id);
  if (r) return r;
  const l = loading.get(id);
  if (l) return l;
  const m = manifests.get(id);
  if (!m || m.error || !state(id).enabled) return null;
  const job = (async () => {
    try {
      const code = fs.readFileSync(path.join(m.dir, m.main), "utf8");
      const sb = await Sandbox.load(id, code, (msg) => addLog(id, msg));
      running.set(id, sb);
      log("addons", `loaded ${id} ${m.version}`);
      return sb;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(id, "failed to load: " + msg);
      log("addons", `${id} failed to load: ${msg}`);
      return null;
    } finally {
      loading.delete(id);
    }
  })();
  loading.set(id, job);
  return job;
}

export async function has(id: string, fn: string): Promise<boolean> {
  return (await sandbox(id))?.has(fn) ?? false;
}

export class AddonError extends Error {}

/** Calls an add-on function and follows its fetch requests to the answer. */
export async function call(id: string, fn: string, args: unknown[]): Promise<any> {
  const sb = await sandbox(id);
  if (!sb) throw new AddonError(`${manifests.get(id)?.name ?? id} isn't running`);
  let res: any;
  try {
    res = await sb.call(fn, args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog(id, `${fn}(): ${msg}`);
    throw new AddonError(msg.includes("timeout") ? "the add-on took too long" : msg);
  }
  for (let step = 0; res && typeof res === "object" && res.fetch !== undefined && res.next; step++) {
    if (step >= MAX_STEPS) throw new AddonError("the add-on asked for too many things in a row");
    const many = Array.isArray(res.fetch);
    const jobs: any[] = many ? res.fetch : [res.fetch];
    let failed = "";
    const answers = await Promise.all(jobs.map(async (j) => {
      const job = typeof j === "string" ? { url: j } : (j ?? {});
      const url = String(job.url ?? "");
      if (!mayFetch(id, url)) {
        failed ||= `not allowed to fetch from ${hostOf(url) || url}`;
        addLog(id, `blocked: ${url}`);
        return null;
      }
      let body = job.body ?? res.body;
      const headers: Record<string, string> = { ...(res.headers ?? {}), ...(job.headers ?? {}) };
      if (body && typeof body === "object") {
        body = JSON.stringify(body);
        headers["Content-Type"] ??= "application/json";
      }
      const r = await fetchText(url, { method: job.method ?? res.method, headers, body: body ?? undefined, cache: Number(job.cache ?? res.cache ?? 0) || 0 });
      if (!r.ok) {
        failed ||= r.status === 401 || r.status === 403 ? `${hostOf(url)} says the user name or password is wrong (${r.status})` : `couldn't get ${hostOf(url)} (${r.status || r.error})`;
        return null;
      }
      if ((job.as ?? res.as ?? "json") === "text") return r.text;
      try {
        return JSON.parse(r.text);
      } catch {
        failed ||= `${hostOf(url)} didn't answer with JSON`;
        return null;
      }
    }));
    if (!many && answers[0] === null) throw new AddonError(failed);
    try {
      res = await sb.call(String(res.next), [many ? answers : answers[0], res.state ?? null]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(id, `${res.next}(): ${msg}`);
      throw new AddonError(msg.includes("timeout") ? "the add-on took too long" : msg);
    }
  }
  return res;
}

export function ctx(id: string): Record<string, unknown> {
  return { now: now(), language: "da", settings: settingsOf(id) };
}
