// The shapes clients get: cards for rows and grids, and full details for a
// film, series, album or add-on item, with this person's progress mixed in.
import { db, json, now } from "./db.ts";
import { img } from "./images.ts";
import * as lib from "./library.ts";
import * as browse from "./addons/browse.ts";
import * as addons from "./addons/manager.ts";
import type { Person } from "./people.ts";
import * as ages from "./ages.ts";
import * as playlists from "./playlists.ts";

export interface Card {
  id: string; kind: string; title: string; subtitle: string; year: string; poster: string; thumb: string; backdrop: string;
  progress: number; watched: boolean; source: string;
  // what a film's page needs, so a client can show it without asking again (Kodi's info screen reads only the card)
  overview?: string; genres?: string[]; rating?: number; runtime?: number; director?: string;
  cast?: { name: string; role: string; photo: string }[]; position?: number; duration?: number;
  // for a client's options menu: in this person's favourites; in the library (so its details can be fixed)
  favourite?: boolean; local?: boolean;
  /** an episode: its series (what a client opens from Continue watching) */
  series?: string;
  /** a category opened from Films or Series: only that kind in it */
  only?: "film" | "series";
  // a song: its length in seconds, its album, and its number on the album
  length?: number; album?: string; n?: number;
  /** a film that's a disc folder or image: "dvd", "bluray" or "iso" */
  disc?: string;
  /** its age rating, as it was given ("DK 11", "PG-13") */
  cert?: string;
}

interface Prog { position: number; duration: number; watched: number; updated: number; snapshot: string | null }

export function progressOf(person: string, id: string): Prog | null {
  return (db.prepare("SELECT position, duration, watched, updated, snapshot FROM progress WHERE person = ? AND item = ?").get(person, id) as Prog | undefined) ?? null;
}

function frac(p: Prog | null): number {
  return p && p.duration > 0 && !p.watched ? Math.min(1, p.position / p.duration) : 0;
}

/** Whether this person may see a library thing: their age limit for films and series (an episode
 *  goes by its series), Music for albums and songs. */
export function may(person: Person, r: lib.Row): boolean {
  if (r.kind === "album" || r.kind === "track") return person.music;
  if (person.maxAge === null || person.maxAge === undefined) return true;
  const top = r.kind === "episode" ? lib.getRow(r.parent ?? "") : r;
  return !!top && ages.allows(person.maxAge, lib.data(top).age);
}

/** An add-on's film or series: one it gave an age rating goes by the person's age limit (episodes
 *  by their series); one without a rating is shown, as the add-ons each person may use are chosen
 *  by an admin. */
export function mayItem(person: Person, a: browse.AItem): boolean {
  if (person.maxAge === null || person.maxAge === undefined) return true;
  const top = a.kind === "episode" && a.series ? browse.get(a.series) ?? a : a;
  return top.age === null || top.age === undefined || ages.allows(person.maxAge, top.age);
}

/** A playlist as a card: the cover of its first song's album. */
export function playlistCard(person: Person, pl: playlists.Playlist): Card {
  const songs = playlists.songs(pl);
  const album = songs.length ? lib.getRow(songs[0].parent ?? "") : null;
  const pics = album ? lib.pictures(album) : { poster: "", backdrop: "", thumb: "" };
  return {
    id: "playlist:" + pl.id, kind: "playlist", title: pl.name, subtitle: songs.length === 1 ? "1 song" : `${songs.length} songs`, year: "",
    poster: pics.poster, thumb: pics.thumb, backdrop: pics.backdrop, progress: 0, watched: false, source: "", local: true,
  };
}

/** A playlist's page: like an album's, its songs from several albums. */
export function playlistDetails(person: Person, pl: playlists.Playlist): Record<string, unknown> {
  const c = playlistCard(person, pl);
  const tracks = playlists.songs(pl).map((t, i) => {
    const td = lib.data(t);
    const al = lib.getRow(t.parent ?? "");
    return { id: t.id, n: i + 1, title: t.title, artist: td.artist || (al ? lib.data(al).artist : ""), duration: td.duration, album: t.parent, albumTitle: al?.title ?? "", poster: al ? lib.pictures(al).poster : "" };
  });
  return { ...c, overview: "", genres: [], rating: 0, runtime: Math.round(tracks.reduce((n, t) => n + (Number(t.duration) || 0), 0) / 60), cast: [], favourite: false, matched: true, artist: "", tracks };
}

export function card(person: Person, id: string): Card | null {
  const r = lib.getRow(id);
  if (r) return lib.isHidden(r) || !may(person, r) ? null : rowCard(person, r);
  const a = browse.get(id);
  if (a) return mayItem(person, a) ? addonCard(person, a) : null;
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
    // an episode on a row (Continue watching, Next up) says what series it is: the series is the title
    const s = lib.getRow(r.parent ?? "");
    if (s?.title) {
      subtitle = epLabel(d.season, d.episode, r.title);
      return { ...rowCardBase(person, r, subtitle, watched), title: s.title };
    }
    subtitle = epLabel(d.season, d.episode, "");
  } else if (r.kind === "track") {
    const al = lib.getRow(r.parent ?? "");
    subtitle = [d.artist || (al ? lib.data(al).artist : ""), al?.title].filter(Boolean).join(" · ");
  }
  return rowCardBase(person, r, subtitle, watched);
}

/** "S1 E3 · Who's Your Daddy?" */
function epLabel(season: unknown, episode: unknown, title: string): string {
  const sn = Number(season), en = Number(episode);
  const at = en ? (sn || sn === 0 ? `S${sn} E${en}` : `E${en}`) : "";
  return [at, title].filter(Boolean).join(" · ");
}

function rowCardBase(person: Person, r: lib.Row, subtitle: string, watched: boolean): Card {
  const d = lib.data(r);
  const pics = lib.pictures(r);
  const p = progressOf(person.id, r.id);
  return {
    id: r.id, kind: r.kind, title: r.title, subtitle, year: r.year, poster: pics.poster, thumb: pics.thumb, backdrop: pics.backdrop, progress: frac(p), watched, source: "",
    overview: d.overview ?? d.nfo?.plot ?? "", genres: d.genres ?? d.nfo?.genres ?? [], rating: d.rating ?? d.nfo?.rating ?? 0,
    runtime: d.runtime ?? 0, director: d.director ?? d.nfo?.director ?? "", cast: castView(d.cast).slice(0, 10),
    position: p && !p.watched ? p.position : 0, duration: p?.duration ?? 0, favourite: isFavourite(person, r.id), local: true,
    ...(d.cert ? { cert: String(d.cert) } : {}),
    ...(r.kind === "track" ? { length: Number(d.duration) || 0, album: r.parent ?? "", n: Number(d.track) || 0 } : {}),
    ...(r.kind !== "track" && typeof d.disc === "string" ? { disc: d.disc } : {}),
    ...(r.kind === "episode" && r.parent ? { series: r.parent } : {}),
  };
}

export function addonCard(person: Person, a: browse.AItem): Card {
  const p = progressOf(person.id, a.id);
  return {
    id: a.id, kind: a.kind, title: a.title, subtitle: a.subtitle || a.year, year: a.year, poster: img(a.poster), thumb: img(a.thumb || a.backdrop || a.poster),
    backdrop: img(a.backdrop), progress: frac(p), watched: !!p?.watched, source: addons.manifests.get(browse.aidOf(a.source))?.name ?? a.source,
    overview: a.overview ?? "", genres: a.genres ?? [], rating: a.rating ?? 0, runtime: a.runtime ?? 0, director: a.director ?? "",
    cast: (a.cast ?? []).slice(0, 10).map((c) => ({ name: c.name, role: c.role, photo: img(c.photo) })),
    position: p && !p.watched ? p.position : 0, duration: p?.duration ?? 0, favourite: isFavourite(person, a.id), local: false,
    ...(a.kind === "episode" && a.series ? { series: a.series } : {}),
    // an episode says what series it is: the series is the title, the episode under it
    ...(a.kind === "episode" && (browse.get(a.series ?? "")?.title || a.seriesTitle)
      ? { title: (browse.get(a.series ?? "")?.title || a.seriesTitle)!, subtitle: epLabel(a.season, a.episode, a.title) }
      : {}),
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
    if (next && !progressOf(person.id, next.id)?.position && may(person, next)) out.push(rowCard(person, next));
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
  // an add-on's series: its episodes too (the ones known)
  const a = r ? null : browse.get(id);
  if (a?.kind === "series") for (const sn of a.seasons ?? []) ids.push(...sn.episodes.map((e) => e.id));
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
  if (r && (lib.isHidden(r) || !may(person, r))) return null;
  if (r) {
    const d = lib.data(r);
    const pics = lib.pictures(r);
    const p = progressOf(person.id, id);
    const base = {
      id, kind: r.kind, title: r.title, year: r.year, overview: d.overview ?? d.nfo?.plot ?? "", genres: d.genres ?? d.nfo?.genres ?? [],
      rating: d.rating ?? d.nfo?.rating ?? 0, runtime: d.runtime ?? 0, director: d.director ?? d.nfo?.director ?? "", cast: castView(d.cast),
      ...pics, favourite: isFavourite(person, id), source: "", local: true, matched: !!d.tmdb, cert: d.cert ?? "", age: d.age ?? null,
      position: p && !p.watched ? p.position : 0, duration: p?.duration ?? 0, watched: !!p?.watched,
    };
    if (r.kind === "series") {
      const eps = lib.rows("episode", id);
      const seasons = new Map<number, Record<string, unknown>[]>();
      for (const e of eps) {
        const ed = lib.data(e);
        const ep = progressOf(person.id, e.id);
        const list = seasons.get(ed.season) ?? [];
        list.push({ id: e.id, n: ed.episode, title: e.title, overview: ed.overview ?? "", runtime: ed.runtime ?? 0, thumb: lib.pictures(e).thumb, progress: frac(ep), watched: !!ep?.watched, position: ep && !ep.watched ? ep.position : 0, duration: ep?.duration ?? 0 });
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
  if (!a || !mayItem(person, a)) return null;
  const p = progressOf(person.id, id);
  return {
    id, kind: a.kind, title: a.title, year: a.year, overview: a.overview, genres: a.genres, rating: a.rating, runtime: a.runtime, director: a.director,
    cast: castView(a.cast), poster: img(a.poster), backdrop: img(a.backdrop), thumb: img(a.thumb || a.backdrop), favourite: isFavourite(person, id),
    source: addons.manifests.get(browse.aidOf(a.source))?.name ?? a.source, subtitle: a.subtitle, local: false, matched: true,
    position: p && !p.watched ? p.position : 0, duration: p?.duration ?? 0, watched: !!p?.watched,
    seasons: a.seasons?.map((s) => ({
      n: s.n, title: s.title || (s.n === 0 ? "Extras" : `Season ${s.n}`),
      episodes: s.episodes.map((e: any) => {
        const ep = progressOf(person.id, e.id);
        return { id: e.id, n: e.episode ?? 0, title: e.title, overview: e.overview, runtime: e.runtime, thumb: img(e.thumb || e.backdrop), progress: frac(ep), watched: !!ep?.watched, position: ep && !ep.watched ? ep.position : 0, duration: ep?.duration ?? 0 };
      }),
    })),
  };
}
