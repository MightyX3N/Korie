// The people in the household: who's watching, their PIN, what they may do.
// The first person is an admin. Each device keeps a session token per person.
import crypto from "node:crypto";
import { db, json, now } from "./db.ts";

export const COLORS = ["#e8a33d", "#2fb0ea", "#6cc28a", "#d96fa5", "#9b8cf0", "#e86a5c"];

export interface Person {
  id: string;
  name: string;
  color: string;
  hasPin: boolean;
  admin: boolean;
  canSettings: boolean;
  addons: "all" | string[];
}

interface Row {
  id: string; name: string; color: string; pin: string | null;
  admin: number; can_settings: number; addons: string;
}

function view(r: Row): Person {
  return {
    id: r.id, name: r.name, color: r.color, hasPin: !!r.pin, admin: !!r.admin,
    canSettings: !!r.admin || !!r.can_settings, addons: json(r.addons, "all"),
  };
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

export function update(id: string, change: Partial<{ name: string; color: string; admin: boolean; canSettings: boolean; addons: "all" | string[] }>): Person | null {
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
  return get(id);
}

export function remove(id: string): boolean {
  const p = get(id);
  if (!p) return false;
  if (p.admin && list().filter((x) => x.admin).length <= 1) return false;
  db.prepare("DELETE FROM people WHERE id = ?").run(id);
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

export function mayUseAddon(p: Person, addonId: string): boolean {
  return p.admin || p.addons === "all" || p.addons.includes(addonId);
}
