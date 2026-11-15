// Film and series details from The Movie Database (themoviedb.org).
// "This product uses the TMDB API but is not endorsed or certified by TMDB."
// Answers are kept for 30 days, so rescans don't ask again.
import { builtInTmdbKey } from "./config.ts";
import { setting } from "./db.ts";
import { fetchJson } from "./net.ts";

const API = "https://api.themoviedb.org/3/";
const IMG = "https://image.tmdb.org/t/p/";
const CACHE = 30 * 86400;

let builtIn: string | null = null;

export function key(): string {
  const own = String(setting("tmdb_key") ?? "").trim();
  if (own) return own;
  builtIn ??= builtInTmdbKey();
  return builtIn;
}

export function image(p: unknown, size = "original"): string {
  return typeof p === "string" && p ? IMG + size + p : "";
}

async function get<T = any>(p: string, params: Record<string, string | number> = {}): Promise<T | null> {
  const k = key();
  if (!k) return null;
  const q = new URLSearchParams({ language: String(setting("language") || "en-US") });
  for (const [a, b] of Object.entries(params)) q.set(a, String(b));
  q.set("api_key", k);
  return fetchJson<T>(API + p + "?" + q.toString(), { cache: CACHE });
}

export interface Cast { name: string; role: string; photo: string }

export interface FilmDetails {
  tmdb: number; title: string; original: string; year: string; runtime: number; genres: string[];
  overview: string; rating: number; director: string; cast: Cast[]; poster: string; backdrop: string; logo?: string;
}

function cast(d: any): Cast[] {
  return (d?.credits?.cast ?? []).slice(0, 12).map((c: any) => ({ name: c.name, role: c.character ?? "", photo: image(c.profile_path, "w185") }));
}

export async function film(id: number): Promise<FilmDetails | null> {
  const d = await get(`movie/${id}`, { append_to_response: "credits" });
  if (!d?.id) return null;
  const directors = (d.credits?.crew ?? []).filter((c: any) => c.job === "Director").map((c: any) => c.name);
  return {
    tmdb: d.id, title: d.title ?? "", original: d.original_title ?? "", year: String(d.release_date ?? "").slice(0, 4),
    runtime: d.runtime ?? 0, genres: (d.genres ?? []).map((g: any) => g.name), overview: d.overview ?? "",
    rating: Math.round((d.vote_average ?? 0) * 10) / 10, director: directors.join(", "), cast: cast(d),
    poster: image(d.poster_path), backdrop: image(d.backdrop_path),
  };
}

export interface Found { id: number; title: string; original: string; year: string; votes: number; popularity: number; poster: string }

export async function search(kind: "film" | "series", query: string, year = ""): Promise<Found[]> {
  const params: Record<string, string> = { query };
  if (year) params[kind === "film" ? "year" : "first_air_date_year"] = year;
  const r = await get(kind === "film" ? "search/movie" : "search/tv", params);
  return (r?.results ?? []).slice(0, 10).map((x: any) => ({
    id: x.id, title: x.title ?? x.name ?? "", original: x.original_title ?? x.original_name ?? "",
    year: String(x.release_date ?? x.first_air_date ?? "").slice(0, 4), votes: x.vote_count ?? 0,
    popularity: x.popularity ?? 0, poster: image(x.poster_path, "w342"),
  }));
}

/** The best match for a title from a file name; tries without the year too (it's sometimes off by one). */
export async function find(kind: "film" | "series", title: string, year: string): Promise<number | null> {
  let r = await search(kind, title, year);
  if (!r.length && year) r = await search(kind, title);
  if (!r.length) return null;
  const want = norm(title);
  // an exact title match (or original title) wins over popularity
  const exact = r.find((x) => norm(x.title) === want || norm(x.original) === want);
  if (exact) return exact.id;
  // otherwise only something that's clearly the same name, not whatever TMDb lists first
  // (or the top hit when the year from the file agrees)
  const close = r.find((x) => similar(title, x.title) || similar(title, x.original));
  if (close) return close.id;
  return year && r[0].year === year ? r[0].id : null;
}

/** Most of the words in common (either way round). */
function similar(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1));
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size) >= 0.6 && both / Math.max(x.size, y.size) >= 0.4;
}

/** The TMDb id for an IMDb id (from a .nfo). */
export async function byImdb(kind: "film" | "series", imdb: string): Promise<number | null> {
  const r = await get(`find/${imdb}`, { external_source: "imdb_id" });
  const hit = (kind === "film" ? r?.movie_results : r?.tv_results)?.[0];
  return hit?.id ?? null;
}

export function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

export interface EpisodeInfo { title: string; overview: string; runtime: number; still: string; aired: string }

export interface SeriesDetails {
  tmdb: number; title: string; year: string; genres: string[]; overview: string; rating: number;
  cast: Cast[]; poster: string; backdrop: string; seasons: Record<number, { title: string; poster: string; episodes: Record<number, EpisodeInfo> }>;
}

export async function series(id: number): Promise<SeriesDetails | null> {
  const d = await get(`tv/${id}`, { append_to_response: "credits" });
  if (!d?.id) return null;
  const v: SeriesDetails = {
    tmdb: d.id, title: d.name ?? "", year: String(d.first_air_date ?? "").slice(0, 4), genres: (d.genres ?? []).map((g: any) => g.name),
    overview: d.overview ?? "", rating: Math.round((d.vote_average ?? 0) * 10) / 10, cast: cast(d),
    poster: image(d.poster_path), backdrop: image(d.backdrop_path), seasons: {},
  };
  await Promise.all((d.seasons ?? []).map(async (s: any) => {
    const sn = Number(s.season_number ?? 0);
    const sd = await get(`tv/${id}/season/${sn}`);
    const eps: Record<number, EpisodeInfo> = {};
    for (const e of sd?.episodes ?? []) {
      eps[e.episode_number] = { title: e.name ?? "", overview: e.overview ?? "", runtime: e.runtime ?? 0, still: image(e.still_path, "w780"), aired: e.air_date ?? "" };
    }
    v.seasons[sn] = { title: s.name ?? "", poster: image(s.poster_path), episodes: eps };
  }));
  return v;
}
