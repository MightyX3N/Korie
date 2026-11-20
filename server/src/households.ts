// Households: the people who belong together. "home" is the one at home; others are friends and
// family elsewhere (an admin makes them, or they sign up when the admin allows it). Inside the home
// nothing changes. From outside (a public address, or the outside port playit.gg's tunnel uses) a
// device first signs in to its household once, with the household's name and password; after that
// it sees that household's people, and their PINs work as at home.
import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { db, json, now } from "./db.ts";
import * as people from "./people.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT, created INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'active', data TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS household_grants (
  token TEXT PRIMARY KEY, household TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  device TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, seen INTEGER NOT NULL);
`);
if (!db.prepare("SELECT 1 FROM households WHERE id = 'home'").get()) {
  db.prepare("INSERT INTO households(id, name, created) VALUES('home', 'Home', ?)").run(now());
}

/** active: may sign in; pending: waiting for an admin (sign-up with approval); blocked: an admin stopped it */
export type State = "active" | "pending" | "blocked";
export interface Household { id: string; name: string; hasPassword: boolean; created: number; state: State; people: number; home: boolean }

interface Row { id: string; name: string; password: string | null; created: number; state: State; data: string }

function view(r: Row): Household {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM people WHERE household = ?").get(r.id) as { n: number }).n;
  return { id: r.id, name: r.name, hasPassword: !!r.password, created: r.created, state: r.state, people: n, home: r.id === "home" };
}

export function list(): Household[] {
  return (db.prepare("SELECT * FROM households ORDER BY id = 'home' DESC, created").all() as Row[]).map(view);
}

export function get(id: string): Household | null {
  const r = db.prepare("SELECT * FROM households WHERE id = ?").get(id) as Row | undefined;
  return r ? view(r) : null;
}

export function byName(name: string): Household | null {
  const r = db.prepare("SELECT * FROM households WHERE lower(name) = lower(?)").get(name.trim()) as Row | undefined;
  return r ? view(r) : null;
}

const norm = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 40);

export function add(name: string, password: string | null, state: State = "active"): Household {
  const n = norm(name);
  if (!n) throw new Error("A household needs a name.");
  if (byName(n)) throw new Error(`There's already a household called ${n}.`);
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare("INSERT INTO households(id, name, password, created, state) VALUES(?, ?, ?, ?, ?)").run(id, n, password ? hash(password) : null, now(), state);
  return get(id)!;
}

export function rename(id: string, name: string): void {
  const n = norm(name);
  const other = byName(n);
  if (!n || (other && other.id !== id)) throw new Error(n ? `There's already a household called ${n}.` : "A household needs a name.");
  db.prepare("UPDATE households SET name = ? WHERE id = ?").run(n, id);
}

/** Its password (null: no signing in from outside). At least 6 characters. */
export function setPassword(id: string, password: string | null): void {
  if (password !== null && password.length < 6) throw new Error("The password needs at least 6 characters.");
  db.prepare("UPDATE households SET password = ? WHERE id = ?").run(password ? hash(password) : null, id);
  // devices that were signed in with the old one sign in again
  db.prepare("DELETE FROM household_grants WHERE household = ?").run(id);
}

export function setState(id: string, state: State): void {
  if (id === "home") return;
  db.prepare("UPDATE households SET state = ? WHERE id = ?").run(state, id);
  if (state !== "active") db.prepare("DELETE FROM household_grants WHERE household = ?").run(id);
}

/** Removes a household; its people go to the home household (they aren't deleted with it). */
export function remove(id: string): void {
  if (id === "home") throw new Error("The home household stays.");
  db.prepare("UPDATE people SET household = 'home' WHERE household = ?").run(id);
  db.prepare("DELETE FROM households WHERE id = ?").run(id);
}

function hash(pw: string, salt = crypto.randomBytes(16).toString("hex")): string {
  return salt + ":" + crypto.scryptSync(pw, salt, 32).toString("hex");
}

export function checkPassword(id: string, pw: string): boolean {
  const r = db.prepare("SELECT password FROM households WHERE id = ?").get(id) as { password: string | null } | undefined;
  if (!r?.password || !pw) return false;
  const [salt, h] = r.password.split(":");
  return crypto.timingSafeEqual(crypto.scryptSync(pw, salt, 32), Buffer.from(h, "hex"));
}

// --- a device signed in to a household (from outside) ------------------------------------------

export function grant(household: string, device: string): string {
  const token = crypto.randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO household_grants(token, household, device, created, seen) VALUES(?, ?, ?, ?, ?)").run(token, household, device.slice(0, 80), now(), now());
  return token;
}

/** The household a device signed in to (the X-Korie-Household header, or ?h= for the web app's pictures). */
export function fromGrant(req: FastifyRequest): Household | null {
  const t = String(req.headers["x-korie-household"] ?? (req.query as Record<string, string> | undefined)?.h ?? "");
  if (!t) return null;
  const r = db.prepare("SELECT household FROM household_grants WHERE token = ?").get(t) as { household: string } | undefined;
  if (!r) return null;
  const h = get(r.household);
  if (!h || h.state !== "active") return null;
  db.prepare("UPDATE household_grants SET seen = ? WHERE token = ?").run(now(), t);
  return h;
}

export function endGrant(req: FastifyRequest): void {
  const t = String(req.headers["x-korie-household"] ?? "");
  if (t) db.prepare("DELETE FROM household_grants WHERE token = ?").run(t);
}

// --- inside the home, or outside ---------------------------------------------------------------

/** the port playit.gg's tunnel (or anything else from outside) is pointed at */
export const OUTSIDE_PORT = Number(process.env.KORIE_OUTSIDE_PORT || 8101);

/** Addresses that are inside the home (and Tailscale's, which only the house's own devices have). */
export function privateAddress(ip: string): boolean {
  const a = ip.replace(/^::ffff:/i, "").toLowerCase();
  if (a === "::1" || a.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(a)) return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
}

/** Is this request from outside the home? (it came in on the outside port, or from a public address) */
export function outside(req: FastifyRequest): boolean {
  if ((req.raw as { korieOutside?: boolean }).korieOutside) return true;
  return !privateAddress(req.socket.remoteAddress ?? "");
}

/** The people someone may pick in Who's watching: from outside, their household's; at home, the home household's (or, signed in to another household, that one's). */
export function peopleFor(req: FastifyRequest): people.Person[] | null {
  const h = fromGrant(req);
  if (outside(req) && !h) return null;
  const id = h?.id ?? "home";
  return people.list().filter((p) => p.household === id);
}

// --- what add-ons may keep about a household (their own data, e.g. until when it has paid) -------

export function addonData(household: string, addon: string): Record<string, unknown> {
  const r = db.prepare("SELECT data FROM households WHERE id = ?").get(household) as { data: string } | undefined;
  return json<Record<string, Record<string, unknown>>>(r?.data, {})[addon] ?? {};
}

export function setAddonData(household: string, addon: string, data: Record<string, unknown>): void {
  const r = db.prepare("SELECT data FROM households WHERE id = ?").get(household) as { data: string } | undefined;
  if (!r) return;
  const all = json<Record<string, unknown>>(r.data, {});
  all[addon] = data;
  db.prepare("UPDATE households SET data = ? WHERE id = ?").run(JSON.stringify(all), household);
}
