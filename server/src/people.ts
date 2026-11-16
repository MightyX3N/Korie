// The people in the household: who's watching, their PIN, what they may do.
// The first person is an admin. Each device keeps a session token per person.
import crypto from "node:crypto";
import { db, json, now } from "./db.ts";
import { LIMITS } from "./ages.ts";

export const COLORS = ["#e8a33d", "#2fb0ea", "#6cc28a", "#d96fa5", "#9b8cf0", "#e86a5c"];

export interface Person {
  id: string;
  name: string;
  color: string;
  hasPin: boolean;
  admin: boolean;
  canSettings: boolean;
  addons: "all" | string[];
  /** audio language to pick first (ISO 639-2, "" = the film's own); subtitles shown when the audio
   *  isn't in this language ("off" = none, "" = as the file says) */
  audio: string;
  subs: string;
  /** an episode's intro: a Skip button while it plays, skipped by itself, or neither */
  skipIntro: "button" | "auto" | "off";
  /** may see Music; may install and turn add-ons and themes on and off; may remove things from the library */
  music: boolean;
  canInstall: boolean;
  canDelete: boolean;
  /** the Android apps they may open on the TVs (package names) */
  apps: "all" | string[];
  /** only films and series rated up to this age (null = anything) */
  maxAge: number | null;
  /** the device (its id) that signs in as this person by itself, without Who's watching */
  autoDevice: string | null;
}

interface Perms { music?: boolean; canInstall?: boolean; canDelete?: boolean; apps?: "all" | string[]; maxAge?: number | null; autoDevice?: string | null }

/** The languages a person can choose for audio and subtitles (ISO 639-2 codes, as ffprobe and Kodi
 *  report them; matched by name, so ger/deu and the like are the same). */
export const LANGUAGES: [string, string][] = [
  ["eng", "English"], ["dan", "Danish"], ["swe", "Swedish"], ["nor", "Norwegian"], ["fin", "Finnish"],
  ["ger", "German"], ["dut", "Dutch"], ["fre", "French"], ["spa", "Spanish"], ["ita", "Italian"],
  ["por", "Portuguese"], ["pol", "Polish"], ["jpn", "Japanese"], ["kor", "Korean"], ["chi", "Chinese"],
];

interface Row {
  id: string; name: string; color: string; pin: string | null;
  admin: number; can_settings: number; addons: string; playback: string | null; perms: string | null;
}

function view(r: Row): Person {
  const pb = json<{ audio?: string; subs?: string; skipIntro?: string }>(r.playback, {});
  const pm = json<Perms>(r.perms, {});
  return {
    id: r.id, name: r.name, color: r.color, hasPin: !!r.pin, admin: !!r.admin,
    canSettings: !!r.admin || !!r.can_settings, addons: json(r.addons, "all"),
    audio: pb.audio ?? "", subs: pb.subs ?? "",
    skipIntro: pb.skipIntro === "auto" || pb.skipIntro === "off" ? pb.skipIntro : "button",
    music: pm.music ?? true,
    canInstall: !!r.admin || !!pm.canInstall,
    canDelete: !!r.admin || (pm.canDelete ?? !!r.can_settings),
    apps: r.admin ? "all" : pm.apps ?? "all",
    maxAge: r.admin ? null : pm.maxAge ?? null,
    autoDevice: pm.autoDevice ?? null,
  };
}

/** A person's audio and subtitle languages ("" = the film's own audio / no subtitles). */
export function setPlayback(id: string, change: { audio?: string; subs?: string; skipIntro?: string }): Person | null {
  const p = get(id);
  if (!p) return null;
  const ok = (c: unknown) => c === "" || LANGUAGES.some(([code]) => code === c);
  const next = { audio: p.audio, subs: p.subs, skipIntro: p.skipIntro as string };
  if (change.skipIntro !== undefined && ["button", "auto", "off"].includes(change.skipIntro)) next.skipIntro = change.skipIntro;
  if (change.audio !== undefined && ok(change.audio)) next.audio = change.audio;
  if (change.subs !== undefined && (ok(change.subs) || change.subs === "off")) next.subs = change.subs;
  db.prepare("UPDATE people SET playback = ? WHERE id = ?").run(JSON.stringify(next), id);
  return get(id);
}

export function list(): Person[] {
  return (db.prepare("SELECT * FROM people ORDER BY created, rowid").all() as Row[]).map(view);
}

export function get(id: string): Person | null {
  const r = db.prepare("SELECT * FROM people WHERE id = ?").get(id) as Row | undefined;
  return r ? view(r) : null;
}

export function ensureFirst(): void {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number }).n;
  if (n === 0) add("Admin", true);
}

export function add(name: string, admin = false): Person {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number }).n;
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare("INSERT INTO people(id, name, color, admin, created) VALUES(?, ?, ?, ?, ?)")
    .run(id, name.trim().slice(0, 40) || "Person", COLORS[count % COLORS.length], admin ? 1 : 0, now());
  return get(id)!;
}

export function update(id: string, change: Partial<{ name: string; color: string; admin: boolean; canSettings: boolean; addons: "all" | string[] } & Perms>): Person | null {
  const p = get(id);
  if (!p) return null;
  if (change.name !== undefined) db.prepare("UPDATE people SET name = ? WHERE id = ?").run(change.name.trim().slice(0, 40) || p.name, id);
  if (change.color !== undefined && /^#[0-9a-f]{6}$/i.test(change.color)) db.prepare("UPDATE people SET color = ? WHERE id = ?").run(change.color, id);
  if (change.admin !== undefined) {
    // there is always at least one admin
    if (!change.admin && p.admin && list().filter((x) => x.admin).length <= 1) return get(id);
    db.prepare("UPDATE people SET admin = ? WHERE id = ?").run(change.admin ? 1 : 0, id);
  }
  if (change.canSettings !== undefined) db.prepare("UPDATE people SET can_settings = ? WHERE id = ?").run(change.canSettings ? 1 : 0, id);
  if (change.addons !== undefined) db.prepare("UPDATE people SET addons = ? WHERE id = ?").run(JSON.stringify(change.addons), id);
  const r = db.prepare("SELECT perms FROM people WHERE id = ?").get(id) as { perms: string | null };
  const pm = json<Perms>(r.perms, {});
  for (const k of ["music", "canInstall", "canDelete"] as const) if (typeof change[k] === "boolean") pm[k] = change[k];
  if (change.maxAge === null || (LIMITS as readonly unknown[]).includes(change.maxAge)) pm.maxAge = change.maxAge;
  if (change.autoDevice === null || (typeof change.autoDevice === "string" && device(change.autoDevice))) {
    // one person per device: whoever had it before doesn't any more
    if (change.autoDevice) {
      for (const o of list()) if (o.id !== id && o.autoDevice === change.autoDevice) setPerm(o.id, { autoDevice: null });
    }
    pm.autoDevice = change.autoDevice;
  }
  if (change.apps === "all" || (Array.isArray(change.apps) && change.apps.every((a) => typeof a === "string"))) pm.apps = change.apps;
  db.prepare("UPDATE people SET perms = ? WHERE id = ?").run(JSON.stringify(pm), id);
  return get(id);
}

export function remove(id: string): boolean {
  const p = get(id);
  if (!p) return false;
  if (p.admin && list().filter((x) => x.admin).length <= 1) return false;
  db.prepare("DELETE FROM people WHERE id = ?").run(id);
  db.prepare("DELETE FROM playlists WHERE person = ?").run(id);
  return true;
}

function hashPin(pin: string, salt = crypto.randomBytes(16).toString("hex")): string {
  return salt + ":" + crypto.scryptSync(pin, salt, 32).toString("hex");
}

export function setPin(id: string, pin: string | null): boolean {
  if (pin !== null && !/^\d{4}$/.test(pin)) return false;
  db.prepare("UPDATE people SET pin = ? WHERE id = ?").run(pin ? hashPin(pin) : null, id);
  return true;
}

export function checkPin(id: string, pin: string): boolean {
  const r = db.prepare("SELECT pin FROM people WHERE id = ?").get(id) as { pin: string | null } | undefined;
  if (!r) return false;
  if (!r.pin) return true;
  const [salt, hash] = r.pin.split(":");
  const got = crypto.scryptSync(pin, salt, 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, "hex"));
}

// --- sessions: a device signed in as a person ---------------------------------------

export function startSession(person: string, device: string): string {
  const token = crypto.randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO sessions(token, person, device, created, seen) VALUES(?, ?, ?, ?, ?)").run(token, person, device.slice(0, 80), now(), now());
  return token;
}

export function fromToken(token: string | undefined): Person | null {
  if (!token) return null;
  const r = db.prepare("SELECT person FROM sessions WHERE token = ?").get(token) as { person: string } | undefined;
  if (!r) return null;
  db.prepare("UPDATE sessions SET seen = ? WHERE token = ?").run(now(), token);
  return get(r.person);
}

export function endSession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function mayUseApp(p: Person, pkg: string): boolean {
  return p.apps === "all" || p.apps.includes(pkg);
}

function setPerm(id: string, change: Perms): void {
  const r = db.prepare("SELECT perms FROM people WHERE id = ?").get(id) as { perms: string | null } | undefined;
  if (!r) return;
  db.prepare("UPDATE people SET perms = ? WHERE id = ?").run(JSON.stringify({ ...json<Perms>(r.perms, {}), ...change }), id);
}

// --- devices: each TV, phone or browser has its own id, so one can sign in as someone by itself ---

export interface Device { id: string; name: string; seen: number }

export function noteDevice(id: unknown, name: unknown): void {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return;
  db.prepare("INSERT INTO devices(id, name, seen) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, seen = excluded.seen")
    .run(id, String(name || "A device").slice(0, 80), now());
}

export function device(id: string): Device | null {
  return (db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as Device | undefined) ?? null;
}

/** The devices seen in the last 90 days, newest first (and any someone signs in on by itself). */
export function devices(): Device[] {
  const kept = new Set(list().map((p) => p.autoDevice).filter(Boolean));
  const old = now() - 90 * 86400;
  const all = db.prepare("SELECT * FROM devices ORDER BY seen DESC").all() as Device[];
  for (const d of all) if (d.seen < old && !kept.has(d.id)) db.prepare("DELETE FROM devices WHERE id = ?").run(d.id);
  return all.filter((d) => d.seen >= old || kept.has(d.id)).slice(0, 50);
}

/** Who this device signs in as by itself (null = it asks Who's watching). */
export function autoFor(deviceId: string): Person | null {
  return list().find((p) => p.autoDevice === deviceId) ?? null;
}

// --- the Android apps on the TVs: each TV says which it has ----------------------------

export function noteApps(apps: { pkg: string; label: string }[]): void {
  const put = db.prepare("INSERT INTO android_apps(pkg, label, seen) VALUES(?, ?, ?) ON CONFLICT(pkg) DO UPDATE SET label = excluded.label, seen = excluded.seen");
  for (const a of apps.slice(0, 500)) {
    if (/^[A-Za-z0-9_.]{1,200}$/.test(a.pkg)) put.run(a.pkg, String(a.label || a.pkg).slice(0, 80), now());
  }
}

export function knownApps(): { pkg: string; label: string }[] {
  return db.prepare("SELECT pkg, label FROM android_apps ORDER BY label COLLATE NOCASE").all() as { pkg: string; label: string }[];
}

export function mayUseAddon(p: Person, addonId: string): boolean {
  return p.admin || p.addons === "all" || p.addons.includes(addonId);
}
