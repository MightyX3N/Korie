// The local library: folders, scanning them, details from TMDb, and the
// shapes the clients get. Scans run in the background; clients are told when
// something changed (events.ts).
import fs from "node:fs";
import path from "node:path";
import { DATA, log } from "./config.ts";
import { db, json, now } from "./db.ts";
import { img } from "./images.ts";
import * as tmdb from "./tmdb.ts";
import { scanFilms, scanMusic, scanSeries, type FoundAlbum, type FoundFilm, type FoundSeries } from "./scanner.ts";
import { emit } from "./events.ts";

export type Kind = "film" | "series" | "episode" | "album" | "track";

export interface Row {
  id: string; kind: Kind; folder: number | null; parent: string | null; file: string | null;
  title: string; sort: string; year: string; added: number; data: string;
}

export interface Folder { id: number; path: string; kind: "films" | "series" | "music"; scanned: number; error: string }

export const status = { scanning: false, text: "", done: 0, total: 0 };

// --- folders --------------------------------------------------------------------------

export function folders(): Folder[] {
  return db.prepare("SELECT * FROM folders ORDER BY id").all() as Folder[];
}

export function addFolder(p: string, kind: Folder["kind"]): Folder | string {
  const full = path.resolve(p);
  try {
    if (!fs.statSync(full).isDirectory()) return "That isn't a folder.";
  } catch {
    return "The server can't open that folder.";
  }
  if (folders().some((f) => f.path === full)) return "That folder is in the library already.";
  db.prepare("INSERT INTO folders(path, kind) VALUES(?, ?)").run(full, kind);
  const f = folders().find((x) => x.path === full)!;
  void scan([f.id]);
  return f;
}

export function removeFolder(id: number): void {
  db.prepare("DELETE FROM items WHERE folder = ?").run(id);
  db.prepare("DELETE FROM folders WHERE id = ?").run(id);
  emit("library");
}

/** Folders the server can see, for picking one from a client. */
export function browseDir(dir: string): { path: string; parent: string | null; dirs: string[] } {
  // in Docker the media is usually mapped to /media: start there
  const full = path.resolve(dir || (fs.existsSync("/media") ? "/media" : "/"));
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name)
      .sort(new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare);
  } catch {
    dirs = [];
  }
  const parent = path.dirname(full);
  return { path: full, parent: parent === full ? null : parent, dirs };
}

// --- scanning -------------------------------------------------------------------------

function sortTitle(t: string): string {
  return t.toLowerCase().replace(/^(the|a|an|den|det|de|en|et)\s+/, "").trim();
}

const upsert = db.prepare(`INSERT INTO items(id, kind, folder, parent, file, title, sort, year, added, data, seen)
  VALUES(@id, @kind, @folder, @parent, @file, @title, @sort, @year, @added, @data, 1)
  ON CONFLICT(id) DO UPDATE SET folder = excluded.folder, parent = excluded.parent, file = excluded.file,
  title = CASE WHEN json_extract(items.data, '$.fixed') OR json_extract(items.data, '$.titled') THEN items.title ELSE excluded.title END,
  sort = CASE WHEN json_extract(items.data, '$.fixed') OR json_extract(items.data, '$.titled') THEN items.sort ELSE excluded.sort END,
  year = CASE WHEN json_extract(items.data, '$.fixed') OR json_extract(items.data, '$.titled') THEN items.year ELSE excluded.year END,
  data = json_patch(items.data, excluded.data), seen = 1`);

function existing(id: string): Record<string, any> | null {
  const r = db.prepare("SELECT data FROM items WHERE id = ?").get(id) as { data: string } | undefined;
  return r ? json(r.data, {}) : null;
}

function saveFilms(f: Folder, found: FoundFilm[]): void {
  for (const x of found) {
    upsert.run({
      id: x.id, kind: "film", folder: f.id, parent: null, file: x.file, title: x.title, sort: sortTitle(x.title), year: x.year, added: now(),
      data: JSON.stringify({ subs: x.subs, disc: x.disc ?? null, localPoster: x.poster, localBackdrop: x.backdrop, nfo: x.nfo }),
    });
  }
}

function saveSeries(f: Folder, found: FoundSeries[]): void {
  for (const s of found) {
    upsert.run({
      id: s.id, kind: "series", folder: f.id, parent: null, file: s.dir, title: s.title, sort: sortTitle(s.title), year: s.year, added: now(),
      data: JSON.stringify({ localPoster: s.poster, localBackdrop: s.backdrop, nfo: s.nfo }),
    });
    for (const e of s.episodes) {
      upsert.run({
        id: e.id, kind: "episode", folder: f.id, parent: s.id, file: e.file, title: e.title, sort: String(e.season * 10000 + e.episode).padStart(8, "0"), year: "", added: now(),
        data: JSON.stringify({ season: e.season, episode: e.episode, episodeEnd: e.episodeEnd ?? null, subs: e.subs, localThumb: e.thumb, fileTitle: e.title }),
      });
    }
  }
}

function saveMusic(f: Folder, found: FoundAlbum[]): void {
  for (const a of found) {
    upsert.run({
      id: a.id, kind: "album", folder: f.id, parent: null, file: null, title: a.title, sort: sortTitle(a.title), year: a.year, added: now(),
      data: JSON.stringify({ artist: a.artist, cover: a.cover }),
    });
    for (const t of a.tracks) {
      upsert.run({
        id: t.id, kind: "track", folder: f.id, parent: a.id, file: t.file, title: t.title, sort: String(t.disc * 1000 + t.track).padStart(6, "0"), year: "", added: now(),
        data: JSON.stringify({ artist: t.artist, track: t.track, disc: t.disc, duration: t.duration }),
      });
    }
  }
}

let queued: number[] | null = null;

/** Looks through folders (all when ids is empty) and then fetches details for new things. */
export async function scan(ids: number[] = []): Promise<void> {
  if (status.scanning) {
    queued = [...new Set([...(queued ?? []), ...ids])];
    return;
  }
  status.scanning = true;
  const list = folders().filter((f) => !ids.length || ids.includes(f.id));
  const coverDir = path.join(DATA, "cache/covers");
  fs.mkdirSync(coverDir, { recursive: true });
  try {
    for (const f of list) {
      status.text = `Looking through ${f.path}`;
      emit("status");
      const t0 = Date.now();
      let error = "";
      if (!fs.existsSync(f.path)) {
        error = "The server can't open this folder right now.";
      } else {
        db.prepare("UPDATE items SET seen = 0 WHERE folder = ?").run(f.id);
        try {
          if (f.kind === "films") {
            const found = scanFilms(f.path);
            db.transaction(() => saveFilms(f, found))();
          } else if (f.kind === "series") {
            const found = scanSeries(f.path);
            db.transaction(() => saveSeries(f, found))();
          } else {
            const found = await scanMusic(f.path, coverDir);
            db.transaction(() => saveMusic(f, found))();
          }
          // gone from the folder: gone from the library (what people watched stays in progress)
          db.prepare("DELETE FROM items WHERE folder = ? AND seen = 0").run(f.id);
        } catch (e) {
          error = "Couldn't look through this folder: " + (e instanceof Error ? e.message : String(e));
        }
      }
      db.prepare("UPDATE folders SET scanned = ?, error = ? WHERE id = ?").run(now(), error, f.id);
      log("library", `${f.path}: ${error || "done"} in ${Date.now() - t0} ms`);
      emit("library");
    }
    await enrich();
  } finally {
    status.scanning = false;
    status.text = "";
    emit("status");
  }
  if (queued) {
    const q = queued;
    queued = null;
    await scan(q);
  }
}

// --- details from TMDb ----------------------------------------------------------------

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function enrich(force = false): Promise<void> {
  if (!tmdb.key()) return;
  const todo = db.prepare(`SELECT id, kind, title, year, data FROM items WHERE kind IN ('film','series')
    ${force ? "" : "AND json_extract(data, '$.checked') IS NULL"}`).all() as Row[];
  if (!todo.length) return;
  status.total = todo.length;
  status.done = 0;
  await pool(todo, 4, async (r) => {
    const d = json<Record<string, any>>(r.data, {});
    try {
      if (r.kind === "film") await fillFilm(r.id, d.nfo?.tmdb ?? d.tmdb ?? (await tmdb.find("film", r.title, r.year)));
      else await fillSeries(r.id, d.nfo?.tmdb ?? d.tmdb ?? (await tmdb.find("series", r.title, r.year)));
    } catch (e) {
      log("tmdb", `${r.title}: ${e instanceof Error ? e.message : e}`);
    }
    status.done++;
    status.text = `Getting details ${status.done}/${status.total}`;
    if (status.done % 10 === 0) emit("library");
  });
  emit("library");
}

const patch = db.prepare("UPDATE items SET data = json_patch(data, ?) WHERE id = ?");

export async function fillFilm(id: string, tmdbId: number | null): Promise<void> {
  if (!tmdbId) {
    patch.run(JSON.stringify({ checked: now(), tmdb: null }), id);
    return;
  }
  const f = await tmdb.film(tmdbId);
  if (!f) return;
  patch.run(JSON.stringify({
    checked: now(), tmdb: f.tmdb, tmdbTitle: f.title, overview: f.overview, genres: f.genres, runtime: f.runtime, rating: f.rating,
    director: f.director, cast: f.cast, poster: f.poster, backdrop: f.backdrop,
  }), id);
  // TMDb's name and year are tidier than a file name's (unless someone fixed it by hand)
  db.prepare("UPDATE items SET title = ?, sort = ?, year = ?, data = json_set(data, '$.titled', 1) WHERE id = ?").run(f.title, sortTitle(f.title), f.year, id);
}

export async function fillSeries(id: string, tmdbId: number | null): Promise<void> {
  if (!tmdbId) {
    patch.run(JSON.stringify({ checked: now(), tmdb: null }), id);
    return;
  }
  const s = await tmdb.series(tmdbId);
  if (!s) return;
  patch.run(JSON.stringify({
    checked: now(), tmdb: s.tmdb, overview: s.overview, genres: s.genres, rating: s.rating, cast: s.cast, poster: s.poster, backdrop: s.backdrop,
    seasonInfo: Object.fromEntries(Object.entries(s.seasons).map(([n, x]) => [n, { title: x.title, poster: x.poster }])),
  }), id);
  db.prepare("UPDATE items SET title = ?, sort = ?, year = ?, data = json_set(data, '$.titled', 1) WHERE id = ?").run(s.title, sortTitle(s.title), s.year, id);
  const eps = db.prepare("SELECT id, data FROM items WHERE parent = ?").all(id) as Row[];
  db.transaction(() => {
    for (const e of eps) {
      const d = json<Record<string, any>>(e.data, {});
      const info = s.seasons[d.season]?.episodes[d.episode];
      if (!info) continue;
      patch.run(JSON.stringify({ overview: info.overview, runtime: info.runtime, still: info.still, aired: info.aired }), e.id);
      db.prepare("UPDATE items SET title = ?, data = json_set(data, '$.titled', 1) WHERE id = ?").run(info.title || d.fileTitle || `Episode ${d.episode}`, e.id);
    }
  })();
}

/** "Not this film?": the person picked the right one. */
export async function fixMatch(id: string, tmdbId: number): Promise<boolean> {
  const r = getRow(id);
  if (!r || (r.kind !== "film" && r.kind !== "series")) return false;
  patch.run(JSON.stringify({ fixed: false }), id);
  if (r.kind === "film") await fillFilm(id, tmdbId);
  else await fillSeries(id, tmdbId);
  patch.run(JSON.stringify({ fixed: true }), id);
  emit("library");
  return true;
}

// --- reading --------------------------------------------------------------------------

export function getRow(id: string): Row | null {
  return (db.prepare("SELECT * FROM items WHERE id = ?").get(id) as Row | undefined) ?? null;
}

export function rows(kind: Kind, parent?: string): Row[] {
  if (parent) return db.prepare("SELECT * FROM items WHERE kind = ? AND parent = ? ORDER BY sort").all(kind, parent) as Row[];
  return db.prepare("SELECT * FROM items WHERE kind = ? ORDER BY sort").all(kind) as Row[];
}

export function recent(kind: Kind, limit: number): Row[] {
  return db.prepare("SELECT * FROM items WHERE kind = ? ORDER BY added DESC, sort LIMIT ?").all(kind, limit) as Row[];
}

export function counts(): Record<string, number> {
  const out: Record<string, number> = { film: 0, series: 0, album: 0 };
  for (const r of db.prepare("SELECT kind, COUNT(*) AS n FROM items GROUP BY kind").all() as { kind: string; n: number }[]) out[r.kind] = r.n;
  return out;
}

export function data(r: Row): Record<string, any> {
  return json<Record<string, any>>(r.data, {});
}

/** The picture to show: the person's own file next to the media first, then TMDb. */
export function pictures(r: Row): { poster: string; backdrop: string; thumb: string } {
  const d = data(r);
  const local = (p: string) => (p ? "file:" + p : "");
  const poster = local(d.localPoster) || d.poster || (r.kind === "album" ? local(d.cover) : "");
  const backdrop = local(d.localBackdrop) || d.backdrop || "";
  const thumb = local(d.localThumb) || d.still || backdrop || "";
  return { poster: img(poster), backdrop: img(backdrop), thumb: img(thumb) };
}
