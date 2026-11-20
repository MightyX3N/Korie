// The calendar: episodes of the series people watch, just out and coming. The series in the
// library, and the add-on series someone has in My list (found on TMDb by their IMDb number), are
// looked up on TMDb about twice a day while they're running; an ended series isn't asked again.
import { db, json, now } from "./db.ts";
import { log } from "./config.ts";
import * as lib from "./library.ts";
import * as tmdb from "./tmdb.ts";
import { emit } from "./events.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS calendar_series (tmdb INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT '', checked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS calendar_eps (
  tmdb INTEGER NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
  overview TEXT NOT NULL DEFAULT '', still TEXT NOT NULL DEFAULT '', aired TEXT NOT NULL, PRIMARY KEY (tmdb, season, episode));
CREATE INDEX IF NOT EXISTS calendar_eps_aired ON calendar_eps(aired);
CREATE TABLE IF NOT EXISTS calendar_imdb (imdb TEXT PRIMARY KEY, tmdb INTEGER);
`);

const DAY = 86400;
/** a running series is asked again after this long */
const AGAIN = 20 * 3600;

/** An add-on series' TMDb number, by the IMDb number in its id (Stremio's "tt0944947"). */
async function tmdbOfImdb(imdb: string): Promise<number | null> {
  const known = db.prepare("SELECT tmdb FROM calendar_imdb WHERE imdb = ?").get(imdb) as { tmdb: number | null } | undefined;
  if (known) return known.tmdb;
  const id = await tmdb.byImdb("series", imdb);
  // (only a match is kept: no answer now may be one later)
  if (id) db.prepare("INSERT OR REPLACE INTO calendar_imdb(imdb, tmdb) VALUES(?, ?)").run(imdb, id);
  return id;
}

export const imdbOf = (s: string): string | null => s.match(/\btt\d{5,}\b/)?.[0] ?? null;

/** Add-on series in anyone's My list: their item id, snapshot and IMDb number. */
function favouriteSeries(person?: string): { item: string; snap: Record<string, any>; imdb: string }[] {
  const rows = db.prepare(`SELECT item, snapshot FROM favourites WHERE snapshot IS NOT NULL ${person ? "AND person = ?" : ""}`).all(...(person ? [person] : [])) as { item: string; snapshot: string }[];
  const out: { item: string; snap: Record<string, any>; imdb: string }[] = [];
  for (const r of rows) {
    const snap = json<Record<string, any>>(r.snapshot, {});
    if (snap.kind !== "series") continue;
    const imdb = imdbOf(String(snap.sourceId ?? "")) ?? imdbOf(r.item);
    if (imdb) out.push({ item: r.item, snap, imdb });
  }
  return out;
}

let busy = false;

/** Asks TMDb about every running series that's due. */
export async function refresh(force = false): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const ids = new Set<number>();
    for (const r of lib.rows("series")) {
      const t = Number(lib.data(r).tmdb);
      if (t) ids.add(t);
    }
    for (const f of favouriteSeries()) {
      const t = await tmdbOfImdb(f.imdb);
      if (t) ids.add(t);
    }
    let n = 0;
    for (const id of ids) {
      const s = db.prepare("SELECT * FROM calendar_series WHERE tmdb = ?").get(id) as { status: string; checked: number } | undefined;
      // an ended series is asked once more a month, in case it comes back
      const ended = s && /ended|canceled|cancelled/i.test(s.status);
      if (!force && s && now() - s.checked < (ended ? 30 * DAY : AGAIN)) continue;
      const a = await tmdb.airing(id);
      if (!a) continue;
      const put = db.prepare(`INSERT INTO calendar_eps(tmdb, season, episode, title, overview, still, aired) VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tmdb, season, episode) DO UPDATE SET title = excluded.title, overview = excluded.overview, still = excluded.still, aired = excluded.aired`);
      db.transaction(() => {
        for (const se of a.seasons) for (const e of se.episodes) if (e.aired) put.run(id, se.n, e.n, e.title, e.overview, e.still, e.aired);
        db.prepare("INSERT OR REPLACE INTO calendar_series(tmdb, status, checked) VALUES(?, ?, ?)").run(id, a.status, now());
      })();
      n++;
    }
    if (n) {
      log("calendar", `${n} ${n === 1 ? "series" : "series"} looked up`);
      emit("calendar");
    }
  } catch (e) {
    log("calendar", `couldn't look up the series: ${e instanceof Error ? e.message : e}`);
  } finally {
    busy = false;
  }
}

export function start(): void {
  setTimeout(() => void refresh(), 60_000);
  setInterval(() => void refresh(), 6 * 3600_000);
}

export interface Entry {
  /** the day it's out (YYYY-MM-DD) */
  date: string;
  series: string; seriesTitle: string; poster: string; backdrop: string;
  season: number; episode: number; title: string; overview: string; still: string;
  /** the episode in the library (played from there), or null */
  item: string | null;
  /** can be watched now: in the library, or out on the add-on */
  ready: boolean;
  source: string;
}

/** What's on between two days for a person: their library's series (within their age limit) and their My list. */
export function entries(person: { id: string }, may: (r: lib.Row) => boolean, mayAddon: (snap: Record<string, any>) => boolean, from: string, to: string): Entry[] {
  const today = new Date().toISOString().slice(0, 10);
  const out: Entry[] = [];
  const at = db.prepare("SELECT * FROM calendar_eps WHERE tmdb = ? AND aired >= ? AND aired <= ? ORDER BY aired, season, episode");
  const seen = new Set<number>();
  for (const r of lib.rows("series")) {
    const t = Number(lib.data(r).tmdb);
    if (!t || seen.has(t) || !may(r)) continue;
    seen.add(t);
    const pics = lib.pictures(r);
    // the episodes it has, by season and number
    const have = new Map<string, string>();
    for (const e of lib.rows("episode", r.id)) {
      const d = lib.data(e);
      have.set(`${d.season}:${d.episode}`, e.id);
      if (d.episodeEnd) for (let k = Number(d.episode) + 1; k <= Number(d.episodeEnd); k++) have.set(`${d.season}:${k}`, e.id);
    }
    for (const e of at.all(t, from, to) as { season: number; episode: number; title: string; overview: string; still: string; aired: string }[]) {
      const item = have.get(`${e.season}:${e.episode}`) ?? null;
      out.push({
        date: e.aired, series: r.id, seriesTitle: r.title, poster: pics.poster, backdrop: pics.backdrop, season: e.season, episode: e.episode,
        title: e.title, overview: e.overview, still: e.still, item, ready: !!item, source: "",
      });
    }
  }
  for (const f of favouriteSeries(person.id)) {
    if (!mayAddon(f.snap)) continue;
    const t = db.prepare("SELECT tmdb FROM calendar_imdb WHERE imdb = ?").get(f.imdb) as { tmdb: number | null } | undefined;
    if (!t?.tmdb || seen.has(t.tmdb)) continue;
    seen.add(t.tmdb);
    for (const e of at.all(t.tmdb, from, to) as { season: number; episode: number; title: string; overview: string; still: string; aired: string }[]) {
      out.push({
        date: e.aired, series: f.item, seriesTitle: String(f.snap.title ?? ""), poster: String(f.snap.poster ?? ""), backdrop: String(f.snap.backdrop ?? ""),
        season: e.season, episode: e.episode, title: e.title, overview: e.overview, still: e.still, item: null,
        // on the add-on from the day it's out
        ready: e.aired <= today, source: String(f.snap.source ?? ""),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.seriesTitle.localeCompare(b.seriesTitle) || a.season - b.season || a.episode - b.episode);
}
