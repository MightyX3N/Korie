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

export interface Setting {
  key: string; label: string; type: "text" | "password" | "list" | "toggle" | "choice"; help?: string; default?: unknown;
  /** choice: the options, [value, label] */
  options?: [string, string][];
}

/** An add-on with accounts: one for the house (DRTV: one DR login, a DR profile per person) or one
 *  per person (Stremio). The fields are what the sign-in asks; Korie keeps what login() returns,
 *  never the password. */
export interface Accounts { who: "house" | "person"; label: string; fields: Setting[]; profiles: boolean; help: string }

export interface Manifest {
  id: string; name: string; type: string; version: string; author: string; description: string; main: string;
  access: string; permissions: string[]; hosts: string[]; hosts_from_settings: boolean; hosts_from_account: boolean; games: boolean;
  settings: Setting[]; accounts: Accounts | null; builtin: boolean; dir: string; error?: string;
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
  const readSettings = (v: unknown): Setting[] => Array.isArray(v)
    ? v.filter((s: any) => s && typeof s.key === "string").map((s: any) => {
      const type = ["text", "password", "list", "toggle", "choice"].includes(s.type) ? s.type : "text";
      const options = Array.isArray(s.options) ? s.options.map((o: any) => Array.isArray(o) ? [str(o[0]), str(o[1], str(o[0]))] : [str(o), str(o)]).filter((o: string[]) => o[0]) : [];
      return { key: s.key, label: str(s.label, s.key), type: type === "choice" && !options.length ? "text" : type, help: str(s.help), default: s.default, ...(type === "choice" ? { options } : {}) };
    })
    : [];
  const settings = readSettings(m.settings);
  const a = m.accounts;
  const accounts: Accounts | null = a && typeof a === "object" ? {
    who: a.who === "person" ? "person" : "house", label: str(a.label, "Account"), fields: readSettings(a.fields).filter((f) => f.type === "text" || f.type === "password"),
    profiles: a.profiles === true, help: str(a.help),
  } : null;
  const out: Manifest = {
    id: m.id, name: str(m.name, m.id), type: str(m.type, "content"), version: str(m.version, "0"), author: str(m.author, "unknown"),
    description: str(m.description), main: str(m.main, "main.lua"), access: str(m.access, "sandbox"),
    permissions: Array.isArray(m.permissions) ? m.permissions.filter((x: unknown) => typeof x === "string") : [],
    hosts: Array.isArray(m.hosts) ? m.hosts.filter((x: unknown) => typeof x === "string").map((x: string) => x.toLowerCase()) : [],
    hosts_from_settings: m.hosts_from_settings === true, hosts_from_account: m.hosts_from_account === true, games: m.games === true, settings, accounts, builtin, dir,
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

// where an add-on's films and series show in Jellyfin's apps: among the library's own ("mixed"),
// or on a tile of their own ("own")
try {
  db.exec("ALTER TABLE addons ADD COLUMN place TEXT NOT NULL DEFAULT 'mixed'");
} catch {
  /* there already */
}

export function place(id: string): "mixed" | "own" {
  const r = db.prepare("SELECT place FROM addons WHERE id = ?").get(id) as { place: string } | undefined;
  return r?.place === "own" ? "own" : "mixed";
}

export function setPlace(id: string, where: string): boolean {
  if (where !== "mixed" && where !== "own") return false;
  return db.prepare("UPDATE addons SET place = ? WHERE id = ?").run(where, id).changes > 0;
}

// --- accounts ----------------------------------------------------------------------------
// owner: "house" (one for everyone) or a person's id. data is what the add-on's login() returned
// (tokens, a sign-in key), kept for its calls; never a password.

db.exec(`CREATE TABLE IF NOT EXISTS addon_accounts (
  addon TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}',
  profiles TEXT NOT NULL DEFAULT '[]', mapping TEXT NOT NULL DEFAULT '{}', at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (addon, owner))`);
// what an admin hid (live channels, and rows: one person's Stremio catalogues), and the channels' order
for (const col of ["hidden TEXT NOT NULL DEFAULT '[]'", "chorder TEXT NOT NULL DEFAULT '[]'"]) {
  try {
    db.exec(`ALTER TABLE addons ADD COLUMN ${col}`);
  } catch {
    /* there already */
  }
}

export interface Account { name: string; data: Record<string, unknown>; profiles: { id: string; name: string; kid: boolean }[]; mapping: Record<string, string>; at: number }

export function account(aid: string, owner: string): Account | null {
  const r = db.prepare("SELECT * FROM addon_accounts WHERE addon = ? AND owner = ?").get(aid, owner) as { name: string; data: string; profiles: string; mapping: string; at: number } | undefined;
  if (!r) return null;
  return { name: r.name, data: json(r.data, {}), profiles: json(r.profiles, []), mapping: json(r.mapping, {}), at: r.at };
}

export function saveAccount(aid: string, owner: string, a: { name?: string; data?: Record<string, unknown>; profiles?: Account["profiles"] }): void {
  const old = account(aid, owner);
  db.prepare(`INSERT INTO addon_accounts(addon, owner, name, data, profiles, mapping, at) VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(addon, owner) DO UPDATE SET name = excluded.name, data = excluded.data, profiles = excluded.profiles, at = excluded.at`).run(
    aid, owner, a.name ?? old?.name ?? "", JSON.stringify(a.data ?? old?.data ?? {}), JSON.stringify(a.profiles ?? old?.profiles ?? []), JSON.stringify(old?.mapping ?? {}), now());
}

export function removeAccount(aid: string, owner: string): void {
  db.prepare("DELETE FROM addon_accounts WHERE addon = ? AND owner = ?").run(aid, owner);
}

/** Which of the house account's profiles a person uses ("" = none chosen: the account's own). */
export function setProfile(aid: string, person: string, profile: string): boolean {
  const a = account(aid, "house");
  if (!a) return false;
  if (profile && !a.profiles.some((p) => p.id === profile)) return false;
  const mapping = { ...a.mapping };
  if (profile) mapping[person] = profile;
  else delete mapping[person];
  db.prepare("UPDATE addon_accounts SET mapping = ? WHERE addon = ? AND owner = 'house'").run(JSON.stringify(mapping), aid);
  return true;
}

/** Who signed in to an add-on with accounts for each person (the person ids with an account of their own). */
export function signedIn(aid: string): string[] {
  return (db.prepare("SELECT owner FROM addon_accounts WHERE addon = ? AND owner != 'house'").all(aid) as { owner: string }[]).map((r) => r.owner);
}

// hidden is kept per source: the add-on ("korie.drtv") or one person's view of it ("korie.stremio@p1")
function hiddenMap(aid: string): Record<string, string[]> {
  const r = db.prepare("SELECT hidden FROM addons WHERE id = ?").get(aid) as { hidden: string } | undefined;
  const v = json<unknown>(r?.hidden, {});
  if (Array.isArray(v)) return { [aid]: v.map(String) }; // as it was kept before: the add-on's channels
  return v && typeof v === "object" ? (v as Record<string, string[]>) : {};
}

/** What an admin hid of a source (channel and row ids). */
export function hidden(src: string): string[] {
  const aid = src.split("@")[0];
  return hiddenMap(aid)[src] ?? [];
}

export function setHidden(src: string, ids: string[]): void {
  const aid = src.split("@")[0];
  const m = hiddenMap(aid);
  if (ids.length) m[src] = ids;
  else delete m[src];
  db.prepare(`INSERT INTO addons(id, hidden, changed) VALUES(?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET hidden = excluded.hidden`).run(aid, JSON.stringify(m), now());
}

/** The live channels' order an admin chose (channel ids; ones not in it come after, as the add-on has them). */
export function channelOrder(aid: string): string[] {
  const r = db.prepare("SELECT chorder FROM addons WHERE id = ?").get(aid) as { chorder: string } | undefined;
  return json(r?.chorder, []);
}

export function setChannelOrder(aid: string, ids: string[]): void {
  db.prepare(`INSERT INTO addons(id, chorder, changed) VALUES(?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET chorder = excluded.chorder`).run(aid, JSON.stringify(ids), now());
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
  for (const s of m?.settings ?? []) out[s.key] = saved[s.key] ?? s.default ?? (s.type === "list" ? [] : s.type === "toggle" ? false : s.type === "choice" ? s.options?.[0]?.[0] ?? "" : "");
  return out;
}

export function setSetting(id: string, key: string, value: unknown): boolean {
  const m = manifests.get(id);
  const s = m?.settings.find((x) => x.key === key);
  if (!m || !s) return false;
  if (s.type === "list" && !(Array.isArray(value) && value.every((v) => typeof v === "string"))) return false;
  if (s.type === "toggle" && typeof value !== "boolean") return false;
  if (s.type === "choice" && !(typeof value === "string" && s.options?.some((o) => o[0] === value))) return false;
  if ((s.type === "text" || s.type === "password") && typeof value !== "string") return false;
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
    if (s.type !== "text" && s.type !== "list") continue;
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

/** Hosts an add-on's accounts listed (data.hosts): a Stremio account's own add-ons. */
export function accountHosts(id: string): string[] {
  const out = new Set<string>();
  for (const r of db.prepare("SELECT data FROM addon_accounts WHERE addon = ?").all(id) as { data: string }[]) {
    const d = json<Record<string, unknown>>(r.data, {});
    for (const h of Array.isArray(d.hosts) ? d.hosts : []) if (typeof h === "string" && /^[a-z0-9.-]+(:\d+)?$/i.test(h)) out.add(h.toLowerCase().replace(/:\d+$/, ""));
  }
  return [...out];
}

export function mayFetch(id: string, url: string): boolean {
  const m = manifests.get(id);
  if (!m || !m.permissions.includes("internet") || !state(id).internet) return false;
  const h = hostOf(url);
  if (url.startsWith("https://") && hostMatches(h, m.hosts)) return true;
  // an admin typed these addresses: a server at home often has no https
  if (m.hosts_from_settings && /^https?:\/\//.test(url) && hostMatches(h, settingsHosts(id))) return true;
  // the add-ons in someone's Stremio account
  return m.hosts_from_account && /^https?:\/\//.test(url) && accountHosts(id).includes(h);
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

// cookie jars for a sign-in that goes through several pages (DR's login), per add-on
const jars = new Map<string, Map<string, Map<string, string>>>();

/** Forgets an add-on's cookies: every sign-in starts as a new browser would (no half-finished one before it). */
export function forgetCookies(id: string): void {
  jars.delete(id);
}

function jarOf(id: string, name: string): Map<string, string> {
  const all = jars.get(id) ?? new Map<string, Map<string, string>>();
  jars.set(id, all);
  const j = all.get(name) ?? new Map<string, string>();
  all.set(name, j);
  return j;
}

/** A fetch with cookies kept in a jar, following redirects itself: it stops at an address the
 *  add-on may not fetch (a sign-in's way back to the website) and gives that address as url. */
async function fetchWithJar(id: string, url: string, init: { method: string; headers: Record<string, string>; body?: string }, jar: Map<string, string>) {
  let at = url;
  let method = init.method;
  let body = init.body;
  for (let hop = 0; hop < 12; hop++) {
    const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0 (Korie)", ...init.headers };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let res: Response;
    try {
      res = await fetch(at, { method, headers, body: method === "GET" ? undefined : body, redirect: "manual", signal: AbortSignal.timeout(20000) });
    } catch (e) {
      return { ok: false, status: 0, url: at, text: "", error: e instanceof Error ? e.message : String(e) };
    }
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, at).toString();
      if (!mayFetch(id, next)) return { ok: true, status: res.status, url: next, text: "" };
      at = next;
      if (res.status !== 307 && res.status !== 308) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return { ok: res.ok, status: res.status, url: at, text: await res.text() };
  }
  return { ok: false, status: 0, url: at, text: "", error: "too many redirects" };
}

/** Calls an add-on function and follows its fetch requests to the answer. owner: whose account
 *  the call was made with ("house" or a person's id): an answer with save_account = { ... } keeps
 *  the add-on's fresh tokens for it. */
export async function call(id: string, fn: string, args: unknown[], owner?: string): Promise<any> {
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
  let saved: Record<string, unknown> | null = null;
  for (let step = 0; res && typeof res === "object" && res.fetch !== undefined && res.next; step++) {
    if (res.save_account && typeof res.save_account === "object") saved = { ...(saved ?? {}), ...res.save_account };
    delete res.save_account;
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
      const form = job.form ?? res.form;
      if (form && typeof form === "object") {
        body = new URLSearchParams(Object.entries(form).map(([k, v]) => [k, String(v)])).toString();
        headers["Content-Type"] ??= "application/x-www-form-urlencoded";
      } else if (body && typeof body === "object") {
        body = JSON.stringify(body);
        headers["Content-Type"] ??= "application/json";
      }
      const as = job.as ?? res.as ?? "json";
      const jarName = job.cookies ?? res.cookies;
      const method = String(job.method ?? res.method ?? (body ? "POST" : "GET")).toUpperCase();
      const r = typeof jarName === "string"
        ? await fetchWithJar(id, url, { method, headers, body: body ?? undefined }, jarOf(id, jarName))
        : { ...(await fetchText(url, { method, headers, body: body ?? undefined, cache: Number(job.cache ?? res.cache ?? 0) || 0 })), url };
      // "full": the add-on reads the answer itself, whatever its status
      if (as === "full") {
        let parsed: unknown = null;
        try {
          parsed = r.text ? JSON.parse(r.text) : null;
        } catch {
          /* not JSON */
        }
        return { status: r.status, ok: r.ok, url: r.url, text: r.text.slice(0, 2_000_000), json: parsed };
      }
      if (!r.ok) {
        failed ||= r.status === 401 || r.status === 403 ? `${hostOf(url)} refused (${r.status}): the sign-in may have run out, or the service only works in its own country` : `couldn't get ${hostOf(url)} (${r.status || (r as any).error})`;
        return null;
      }
      if (as === "text") return r.text;
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
  // fresh tokens for the account the call was made with
  if (res && typeof res === "object" && res.save_account && typeof res.save_account === "object") saved = { ...(saved ?? {}), ...res.save_account };
  if (owner && saved) {
    const old = account(id, owner);
    if (old) {
      // one level deep: a token for one DR profile joins the others
      const data: Record<string, unknown> = { ...old.data };
      for (const [k, v] of Object.entries(saved)) {
        const was = data[k];
        data[k] = v && typeof v === "object" && !Array.isArray(v) && was && typeof was === "object" && !Array.isArray(was) && Object.keys(v).length ? { ...was, ...v } : v;
      }
      saveAccount(id, owner, { data });
    }
  }
  return res;
}

/** What every call gets. person: whose behalf it's made on (their id and name); account: the
 *  account's data (the person's own, or the house's); profile: the house account's profile the
 *  person uses. owner tells call() where fresh tokens go. */
export function ctx(id: string, person?: { id: string; name: string } | null): { ctx: Record<string, unknown>; owner?: string } {
  const c: Record<string, unknown> = { now: now(), language: "da", settings: settingsOf(id) };
  const m = manifests.get(id);
  let owner: string | undefined;
  if (person) c.person = { id: person.id, name: person.name };
  if (m?.accounts?.who === "person" && person) {
    const a = account(id, person.id);
    if (a) {
      c.account = a.data;
      owner = person.id;
    }
  } else if (m?.accounts) {
    const a = account(id, "house");
    if (a) {
      c.account = a.data;
      owner = "house";
      const pid = person ? a.mapping[person.id] : undefined;
      const prof = a.profiles.find((p) => p.id === pid);
      if (prof) c.profile = prof;
    }
  }
  return { ctx: c, owner };
}
