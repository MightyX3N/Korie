// Playlists: each person's own lists of songs from the library, in their order.
import crypto from "node:crypto";
import { db, json, now } from "./db.ts";
import * as lib from "./library.ts";

export interface Playlist { id: string; name: string; items: string[]; updated: number }

interface Row { id: string; person: string; name: string; items: string; updated: number }

function view(r: Row): Playlist {
  return { id: r.id, name: r.name, items: json<string[]>(r.items, []), updated: r.updated };
}

export function list(person: string): Playlist[] {
  return (db.prepare("SELECT * FROM playlists WHERE person = ? ORDER BY name COLLATE NOCASE").all(person) as Row[]).map(view);
}

export function get(person: string, id: string): Playlist | null {
  const r = db.prepare("SELECT * FROM playlists WHERE id = ? AND person = ?").get(id, person) as Row | undefined;
  return r ? view(r) : null;
}

export function create(person: string, name: string): Playlist {
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare("INSERT INTO playlists(id, person, name, created, updated) VALUES(?, ?, ?, ?, ?)").run(id, person, name.trim().slice(0, 60) || "Playlist", now(), now());
  return get(person, id)!;
}

export function rename(person: string, id: string, name: string): boolean {
  return db.prepare("UPDATE playlists SET name = ?, updated = ? WHERE id = ? AND person = ?").run(name.trim().slice(0, 60), now(), id, person).changes > 0;
}

export function remove(person: string, id: string): boolean {
  return db.prepare("DELETE FROM playlists WHERE id = ? AND person = ?").run(id, person).changes > 0;
}

/** Adds songs: a song itself, or every song of an album. Songs already on it stay where they are. */
export function add(person: string, id: string, item: string): number {
  const p = get(person, id);
  const r = lib.getRow(item);
  if (!p || !r) return -1;
  const songs = r.kind === "track" ? [r.id] : r.kind === "album" ? lib.rows("track", r.id).map((t) => t.id) : [];
  const fresh = songs.filter((s) => !p.items.includes(s));
  db.prepare("UPDATE playlists SET items = ?, updated = ? WHERE id = ?").run(JSON.stringify([...p.items, ...fresh]), now(), id);
  return fresh.length;
}

export function take(person: string, id: string, item: string): boolean {
  const p = get(person, id);
  if (!p) return false;
  db.prepare("UPDATE playlists SET items = ?, updated = ? WHERE id = ?").run(JSON.stringify(p.items.filter((x) => x !== item)), now(), id);
  return true;
}

/** Its songs that are still in the library. */
export function songs(p: Playlist): lib.Row[] {
  return p.items.map((i) => lib.getRow(i)).filter((r): r is lib.Row => !!r && r.kind === "track");
}
