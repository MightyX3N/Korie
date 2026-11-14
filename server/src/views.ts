// The shapes clients get: cards for rows and grids, and full details for a
// film, series, album or add-on item, with this person's progress mixed in.
import { db, json, now } from "./db.ts";
import { img } from "./images.ts";
import * as lib from "./library.ts";
import * as browse from "./addons/browse.ts";
import * as addons from "./addons/manager.ts";
import type { Person } from "./people.ts";

export interface Card {
  id: string; kind: string; title: string; subtitle: string; year: string; poster: string; thumb: string; backdrop: string;
  progress: number; watched: boolean; source: string;
}

interface Prog { position: number; duration: number; watched: number; updated: number; snapshot: string | null }

export function progressOf(person: string, id: string): Prog | null {
  return (db.prepare("SELECT position, duration, watched, updated, snapshot FROM progress WHERE person = ? AND item = ?").get(person, id) as Prog | undefined) ?? null;
}

function frac(p: Prog | null): number {
  return p && p.duration > 0 && !p.watched ? Math.min(1, p.position / p.duration) : 0;
}

export function card(person: Person, id: string): Card | null {
  const r = lib.getRow(id);
  if (r) return rowCard(person, r);
  const a = browse.get(id);
  if (a) return addonCard(person, a);
  return null;
}

export function rowCard(person: Person, r: lib.Row): Card {
  const d = lib.data(r);
  const pics = lib.pictures(r);
  const p = progressOf(person.id, r.id);
  let subtitle = r.year;
  let watched = !!p?.watched;
  if (r.kind === "series") {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM items WHERE parent = ?").get(r.id) as { n: number }).n;
    const w = (db.prepare("SELECT COUNT(*) AS n FROM items i JOIN progress p ON p.item = i.id AND p.person = ? WHERE i.parent = ? AND p.watched = 1").get(person.id, r.id) as { n: number }).n;
    subtitle = [r.year, `${n} episode${n === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
    watched = n > 0 && w >= n;
  } else if (r.kind === "album") {
    subtitle = [d.artist, r.year].filter(Boolean).join(" · ");
  } else if (r.kind === "episode") {
    const s = lib.getRow(r.parent ?? "");
    subtitle = `${s?.title ?? ""} · S${d.season}E${d.episode}`;
  }
  return { id: r.id, kind: r.kind, title: r.title, subtitle, year: r.year, poster: pics.poster, thumb: pics.thumb, backdrop: pics.backdrop, progress: frac(p), watched, source: "" };
}

export function addonCard(person: Person, a: browse.AItem): Card {
  const p = progressOf(person.id, a.id);
  return {
    id: a.id, kind: a.kind, title: a.title, subtitle: a.subtitle || a.year, year: a.year, poster: img(a.poster), thumb: img(a.thumb || a.backdrop || a.poster),
    backdrop: img(a.backdrop), progress: frac(p), watched: !!p?.watched, source: addons.manifests.get(a.source)?.name ?? a.source,
  };
}

/** A card from a snapshot kept with progress/favourites (for add-on things the server no longer has in memory). */
export function snapshotCard(person: Person, id: string, snap: string | null): Card | null {
  const c = card(person, id);
  if (c) return c;
  const s = json<browse.AItem | null>(snap, null);
  if (!s?.id) return null;
  browse.item(s.source, { ...s, id: s.sourceId }); // known again, so it opens and plays
  return addonCard(person, browse.get(id)!);
}

export function continueWatching(person: Person, allowed: (aid: string) => boolean): Card[] {
  const rows = db.prepare(`SELECT item, snapshot FROM progress WHERE person = ? AND watched = 0 AND position > 30
    ORDER BY updated DESC LIMIT 30`).all(person.id) as { item: string; snapshot: string | null }[];
  const out: Card[] = [];
  for (const r of rows) {
    const src = r.item.includes("/") ? r.item.split("/")[0] : "";
    if (src && !allowed(src)) continue;
    const c = snapshotCard(person, r.item, r.snapshot);
    if (c && c.kind !== "live" && c.kind !== "track") out.push(c);
  }
  return out.slice(0, 20);
}

export function nextUp(person: Person): Card[] {
  // the next episode of series someone is watching
  const last = db.prepare(`SELECT i.parent AS series, MAX(p.updated) AS at FROM progress p JOIN items i ON i.id = p.item
    WHERE p.person = ? AND i.kind = 'episode' AND p.watched = 1 GROUP BY i.parent ORDER BY at DESC LIMIT 12`).all(person.id) as { series: string }[];
  const out: Card[] = [];
  for (const l of last) {
    const eps = lib.rows("episode", l.series);
    const lastWatched = eps.map((e, i) => (progressOf(person.id, e.id)?.watched ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const next = eps[lastWatched + 1];
    if (next && !progressOf(person.id, next.id)?.position) out.push(rowCard(person, next));
  }
  return out;
}

export function favourites(person: Person): Card[] {
  const rows = db.prepare("SELECT item, snapshot FROM favourites WHERE person = ? ORDER BY added DESC").all(person.id) as { item: string; snapshot: string | null }[];
  return rows.map((r) => snapshotCard(person, r.item, r.snapshot)).filter((c): c is Card => !!c);
}

export function isFavourite(person: Person, id: string): boolean {
  return !!db.prepare("SELECT 1 FROM favourites WHERE person = ? AND item = ?").get(person.id, id);
}

export function snapshotOf(id: string): string | null {
  const a = browse.get(id);
  if (!a) return null;
  const { seasons: _s, ...rest } = a;
  return JSON.stringify(rest);
}

export function setProgress(person: Person, id: string, position: number, duration: number, ended: boolean): void {
  const watched = ended || (duration > 0 && position / duration > 0.92) ? 1 : 0;
  db.prepare(`INSERT INTO progress(person, item, position, duration, watched, updated, snapshot) VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(person, item) DO UPDATE SET position = excluded.position, duration = excluded.duration,
    watched = MAX(progress.watched, excluded.watched), updated = excluded.updated, snapshot = COALESCE(excluded.snapshot, progress.snapshot)`)
    .run(person.id, id, watched ? 0 : position, duration, watched, now(), snapshotOf(id));
}

export function setWatched(person: Person, id: string, watched: boolean): void {
  const ids = [id];
  const r = lib.getRow(id);
  if (r?.kind === "series") ids.push(...lib.rows("episode", id).map((e) => e.id));
  for (const x of ids) {
    db.prepare(`INSERT INTO progress(person, item, position, duration, watched, updated, snapshot) VALUES(?, ?, 0, 0, ?, ?, ?)
      ON CONFLICT(person, item) DO UPDATE SET position = 0, watched = excluded.watched, updated = excluded.updated`).run(person.id, x, watched ? 1 : 0, now(), snapshotOf(x));
  }
}

export function toggleFavourite(person: Person, id: string): boolean {
  if (isFavourite(person, id)) {
    db.prepare("DELETE FROM favourites WHERE person = ? AND item = ?").run(person.id, id);
    return false;
  }
  db.prepare("INSERT INTO favourites(person, item, added, snapshot) VALUES(?, ?, ?, ?)").run(person.id, id, now(), snapshotOf(id));
  return true;
}

// --- details ----------------------------------------------------------------------------

function castView(cast: unknown): { name: string; role: string; photo: string }[] {
  return (Array.isArray(cast) ? cast : []).map((c: any) => Array.isArray(c) ? { name: String(c[0] ?? ""), role: String(c[1] ?? ""), photo: "" } : { name: String(c?.name ?? ""), role: String(c?.role ?? ""), photo: img(c?.photo) }).filter((c) => c.name).slice(0, 12);
}

export function details(person: Person, id: string): Record<string, unknown> | null {
  const r = lib.getRow(id);
  if (r) {
    const d = lib.data(r);
    const pics = lib.pictures(r);
    const p = progressOf(person.id, id);
    const base = {
      id, kind: r.kind, title: r.title, year: r.year, overview: d.overview ?? d.nfo?.plot ?? "", genres: d.genres ?? d.nfo?.genres ?? [],
      rating: d.rating ?? d.nfo?.rating ?? 0, runtime: d.runtime ?? 0, director: d.director ?? d.nfo?.director ?? "", cast: castView(d.cast),
      ...pics, favourite: isFavourite(person, id), source: "", local: true, matched: !!d.tmdb,
      position: p && !p.watched ? p.position : 0, duration: p?.duration ?? 0, watched: !!p?.watched,
    };
    if (r.kind === "series") {
      const eps = lib.rows("episode", id);
      const seasons = new Map<number, Record<string, unknown>[]>();
      for (const e of eps) {
        const ed = lib.data(e);
        const ep = progressOf(person.id, e.id);
        const list = seasons.get(ed.season) ?? [];
        list.push({ id: e.id, n: ed.episode, title: e.title, overview: ed.overview ?? "", runtime: ed.runtime ?? 0, thumb: lib.pictures(e).thumb, progress: frac(ep), watched: !!ep?.watched });
        seasons.set(ed.season, list);
      }
      const info = d.seasonInfo ?? {};
      return { ...base, seasons: [...seasons.entries()].sort((a, b) => (a[0] === 0 ? 1 : b[0] === 0 ? -1 : a[0] - b[0])).map(([n, episodes]) => ({ n, title: info[n]?.title || (n === 0 ? "Specials" : `Season ${n}`), episodes })) };
    }
    if (r.kind === "album") {
      const tracks = lib.rows("track", id).map((t) => {
        const td = lib.data(t);
        return { id: t.id, n: td.track, title: t.title, artist: td.artist, duration: td.duration };
      });
      return { ...base, artist: d.artist, tracks };
    }
    if (r.kind === "episode") {
      const s = lib.getRow(r.parent ?? "");
      return { ...base, series: r.parent, seriesTitle: s?.title ?? "", season: d.season, episode: d.episode };
    }
    return base;
  }
  const a = browse.get(id);
  if (!a) return null;
  const p = progressOf(person.id, id);
  return {
    id, kind: a.kind, title: a.title, year: a.year, overview: a.overview, genres: a.genres, rating: a.rating, runtime: a.runtime, director: a.director,
    cast: castView(a.cast), poster: img(a.poster), backdrop: img(a.backdrop), thumb: img(a.thumb || a.backdrop), favourite: isFavourite(person, id),
    source: addons.manifests.get(a.source)?.name ?? a.source, subtitle: a.subtitle, local: false, matched: true,
    position: p && !p.watched ? p.position : 0, duration: p?.duration ?? 0, watched: !!p?.watched,
    seasons: a.seasons?.map((s) => ({
      n: s.n, title: s.title || (s.n === 0 ? "Extras" : `Season ${s.n}`),
      episodes: s.episodes.map((e: any) => {
        const ep = progressOf(person.id, e.id);
        return { id: e.id, n: e.episode ?? 0, title: e.title, overview: e.overview, runtime: e.runtime, thumb: img(e.thumb || e.backdrop), progress: frac(ep), watched: !!ep?.watched };
      }),
    })),
  };
}
