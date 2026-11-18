// TV channels made from the library: one per genre, plus Classics and Kids. Each channel's week is
// worked out once (Monday 00:00 to Monday 00:00, the server's time) and kept, so playing one is just
// looking up what's on now and starting that file at the right point. Films are shuffled; a series'
// episodes come in order, carrying on where the week before stopped. Something added during the week
// joins the next week (or straight away with Make the schedules again).
import crypto from "node:crypto";
import { db, json, now } from "./db.ts";
import { log } from "./config.ts";
import * as lib from "./library.ts";
import * as playback from "./playback.ts";
import { emit } from "./events.ts";

const WEEK = 7 * 86400;
/** a genre needs this many films and series before it gets a channel */
const MIN_TITLES = 3;
const KIDS_GENRES = ["family", "animation", "kids", "children"];

db.exec(`
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, rule TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS channel_programmes (
  channel TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, item TEXT NOT NULL,
  PRIMARY KEY (channel, start));
CREATE INDEX IF NOT EXISTS channel_programmes_end ON channel_programmes(channel, end);
`);

export interface Channel { id: string; name: string; kind: "genre" | "classics" | "kids"; rule: string; enabled: boolean; sort: number; titles: number }
export interface Programme { channel: string; start: number; end: number; item: string }

interface ChRow { id: string; name: string; kind: Channel["kind"]; rule: string; enabled: number; sort: number; data: string }

/** Monday 00:00 of the week t is in (the server's own time zone). */
export function weekStart(t = now()): number {
  const d = new Date(t * 1000);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Math.floor(d.getTime() / 1000);
}

const genresOf = (r: lib.Row): string[] => (lib.data(r).genres ?? []).map((g: unknown) => String(g));
const ratingOf = (r: lib.Row): number => Number(lib.data(r).rating) || 0;
const ageOf = (r: lib.Row): number | null => (lib.data(r).age === null || lib.data(r).age === undefined ? null : Number(lib.data(r).age));

/** What a channel's rule lets on: the films and series it plays. */
function pool(kind: Channel["kind"], rule: string): lib.Row[] {
  const all = [...lib.rows("film"), ...lib.rows("series")];
  const year = new Date().getFullYear();
  if (kind === "genre") return all.filter((r) => genresOf(r).some((g) => g.toLowerCase() === rule.toLowerCase()));
  // Classics: films at least 30 years old that TMDb's viewers rate 7 or more
  if (kind === "classics") return all.filter((r) => r.kind === "film" && Number(r.year) > 0 && Number(r.year) <= year - 30 && ratingOf(r) >= 7);
  // Kids: family and animation rated for 11 and under, and anything rated for 7 and under
  return all.filter((r) => {
    const age = ageOf(r);
    if (age === null) return false;
    return age <= 7 || (age <= 11 && genresOf(r).some((g) => KIDS_GENRES.includes(g.toLowerCase())));
  });
}

/** Brings the list of channels up to date with the library: new genres get a channel (on), ones with
 *  nothing left go (unless an admin turned them off, so the choice is kept). */
export function sync(): void {
  const want = new Map<string, { name: string; kind: Channel["kind"]; rule: string }>();
  want.set("kids", { name: "Kids", kind: "kids", rule: "" });
  want.set("classics", { name: "Classics", kind: "classics", rule: "" });
  const genres = new Map<string, string>();
  for (const r of [...lib.rows("film"), ...lib.rows("series")]) for (const g of genresOf(r)) genres.set(g.toLowerCase(), g);
  for (const [k, g] of genres) want.set("g-" + k.replace(/[^a-z0-9]+/g, "-"), { name: g, kind: "genre", rule: g });
  const have = new Map((db.prepare("SELECT * FROM channels").all() as ChRow[]).map((c) => [c.id, c]));
  const put = db.prepare("INSERT INTO channels(id, name, kind, rule, enabled, sort) VALUES(?, ?, ?, ?, 1, ?)");
  let n = have.size;
  for (const [id, c] of want) {
    if (pool(c.kind, c.rule).length < (c.kind === "genre" ? MIN_TITLES : 1)) continue;
    if (!have.has(id)) put.run(id, c.name, c.kind, c.rule, c.kind === "kids" ? -2 : c.kind === "classics" ? -1 : n++);
  }
  for (const c of have.values()) {
    if (c.enabled && pool(c.kind, c.rule).length < (c.kind === "genre" ? MIN_TITLES : 1)) {
      db.prepare("DELETE FROM channels WHERE id = ?").run(c.id);
      db.prepare("DELETE FROM channel_programmes WHERE channel = ?").run(c.id);
    }
  }
}

export function list(all = false): Channel[] {
  return (db.prepare(`SELECT * FROM channels ${all ? "" : "WHERE enabled = 1"} ORDER BY sort, name`).all() as ChRow[])
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind, rule: c.rule, enabled: !!c.enabled, sort: c.sort, titles: pool(c.kind, c.rule).length }));
}

export function get(id: string): Channel | null {
  return list(true).find((c) => c.id === id) ?? null;
}

export function setEnabled(id: string, on: boolean): boolean {
  const ok = db.prepare("UPDATE channels SET enabled = ? WHERE id = ?").run(on ? 1 : 0, id).changes > 0;
  if (ok) emit("channels");
  return ok;
}

// --- the week's schedule ---------------------------------------------------------------------

/** How long an item plays, in seconds: probed once and kept with it (0 = can't be on a channel). */
async function lengthOf(r: lib.Row): Promise<number> {
  const d = lib.data(r);
  if (Number(d.duration) > 60) return Number(d.duration);
  if (!r.file || d.disc || (Array.isArray(d.parts) && d.parts.length > 1)) return 0;
  try {
    const p = await playback.probe({ file: r.file });
    if (p.duration > 0) db.prepare("UPDATE items SET data = json_patch(data, ?) WHERE id = ?").run(JSON.stringify({ duration: p.duration }), r.id);
    return p.duration > 60 ? p.duration : 0;
  } catch {
    return 0;
  }
}

/** A random order that's the same each time for the same seed (so a schedule can be explained). */
function shuffled<T>(xs: T[], seed: string): T[] {
  const out = [...xs];
  let h = crypto.createHash("sha256").update(seed).digest();
  let k = 0;
  const next = () => {
    if (k + 4 > h.length) { h = crypto.createHash("sha256").update(h).digest(); k = 0; }
    const v = h.readUInt32BE(k); k += 4;
    return v / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Works out one channel's week, from Monday 00:00 (or from `from`, keeping what's before it). */
async function planWeek(c: Channel, week: number, from = week): Promise<number> {
  const titles = pool(c.kind, c.rule);
  const row = db.prepare("SELECT data FROM channels WHERE id = ?").get(c.id) as { data: string } | undefined;
  const state = json<{ next?: Record<string, number> }>(row?.data, {});
  const nextEp = state.next ?? {};
  // films and series with what's playable in them (and how long each episode is)
  const units: { row: lib.Row; eps?: { row: lib.Row; len: number }[]; len?: number }[] = [];
  for (const t of titles) {
    if (t.kind === "film") {
      const len = await lengthOf(t);
      if (len) units.push({ row: t, len });
    } else {
      const eps: { row: lib.Row; len: number }[] = [];
      for (const e of lib.rows("episode", t.id)) {
        const len = await lengthOf(e);
        if (len) eps.push({ row: e, len });
      }
      if (eps.length) units.push({ row: t, eps });
    }
  }
  db.prepare("DELETE FROM channel_programmes WHERE channel = ? AND start >= ? AND start < ?").run(c.id, from, week + WEEK);
  if (!units.length) return 0;
  const put = db.prepare("INSERT OR REPLACE INTO channel_programmes(channel, start, end, item) VALUES(?, ?, ?, ?)");
  // carry on from where the last programme before `from` ends
  const before = db.prepare("SELECT end FROM channel_programmes WHERE channel = ? AND start < ? ORDER BY start DESC LIMIT 1").get(c.id, from) as { end: number } | undefined;
  let t = before && before.end > from ? before.end : from;
  let round = 0;
  let last = "";
  let count = 0;
  while (t < week + WEEK) {
    let order = shuffled(units, `${c.id}:${week}:${from}:${round++}`);
    // not the same thing twice in a row where one round meets the next
    if (order.length > 1 && order[0].row.id === last) order = [...order.slice(1), order[0]];
    for (const u of order) {
      if (t >= week + WEEK) break;
      let item: lib.Row;
      let len: number;
      if (u.eps) {
        const i = (nextEp[u.row.id] ?? 0) % u.eps.length;
        item = u.eps[i].row;
        len = u.eps[i].len;
        nextEp[u.row.id] = i + 1;
      } else {
        item = u.row;
        len = u.len!;
      }
      const end = t + Math.ceil(len);
      put.run(c.id, t, end, item.id);
      t = end;
      last = u.row.id;
      count++;
    }
  }
  db.prepare("UPDATE channels SET data = json_patch(data, ?) WHERE id = ?").run(JSON.stringify({ next: nextEp, planned: now() }), c.id);
  return count;
}

let busy: Promise<void> | null = null;

/** Makes sure every channel has this week (and, on its last day, next week) worked out. */
export function ensure(force = false): Promise<void> {
  if (busy) return busy;
  busy = (async () => {
    try {
      sync();
      const w = weekStart();
      for (const c of list()) {
        const has = (s: number) => !!db.prepare("SELECT 1 FROM channel_programmes WHERE channel = ? AND start >= ? AND start < ? LIMIT 1").get(c.id, s, s + WEEK);
        if (force) {
          // again from now: what's on now stays, everything after it is new
          const cur = at(c.id);
          await planWeek(c, w, cur ? cur.end : now());
          log("channels", `${c.name}: schedule made again`);
        } else if (!has(w)) {
          await planWeek(c, w);
          log("channels", `${c.name}: this week's schedule made`);
        }
        if (now() > w + WEEK - 86400 && !has(w + WEEK)) {
          await planWeek(c, w + WEEK);
          log("channels", `${c.name}: next week's schedule made`);
        }
      }
      // weeks gone by aren't needed
      db.prepare("DELETE FROM channel_programmes WHERE end < ?").run(w - 86400);
      emit("channels");
    } catch (e) {
      log("channels", `couldn't make the schedules: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = null;
    }
  })();
  return busy;
}

/** Looks every hour whether a new week needs working out. */
export function start(): void {
  setTimeout(() => void ensure(), 20_000);
  setInterval(() => void ensure(), 3600_000);
}

/** What's on a channel at time t. */
export function at(channel: string, t = now()): Programme | null {
  return (db.prepare("SELECT * FROM channel_programmes WHERE channel = ? AND start <= ? AND end > ?").get(channel, t, t) as Programme | undefined) ?? null;
}

/** A channel's programmes between two times. */
export function between(channel: string, from: number, to: number): Programme[] {
  return db.prepare("SELECT * FROM channel_programmes WHERE channel = ? AND end > ? AND start < ? ORDER BY start").all(channel, from, to) as Programme[];
}
