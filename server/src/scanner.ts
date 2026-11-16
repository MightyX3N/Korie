// Walks library folders and works out what's in them. Only reads files: no
// internet here. Names follow Kodi and Jellyfin:
//   Films/Alien (1979)/Alien (1979).mkv       Films/Alien.1979.1080p.mkv
//   Series/Arcane/Season 01/Arcane S01E03.mkv  Series/Arcane/1x03 - Name.mkv
//   Music/Artist/Album/01 Title.flac           (tags win over folder names)
// Kodi .nfo files and pictures next to the files (poster.jpg, fanart.jpg,
// folder.jpg, <name>-poster.jpg) are used first.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { filenameParse } from "@ctrl/video-filename-parser";
import { parseFile } from "music-metadata";

export const VIDEO = new Set(["mkv", "mp4", "m4v", "avi", "mov", "wmv", "ts", "m2ts", "webm", "mpg", "mpeg", "iso", "vob", "flv", "ogv", "3gp"]);
export const AUDIO = new Set(["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma", "alac", "ape", "oga"]);
const SUBS = new Set(["srt", "vtt", "ass", "ssa"]);
const SKIP_DIRS = new Set(["extras", "featurettes", "behind the scenes", "deleted scenes", "interviews", "scenes", "shorts", "trailers", "samples", "sample", "@eadir", ".actors", "$recycle.bin", "system volume information", "#recycle", "lost+found"]);

export function idFor(prefix: string, key: string): string {
  return prefix + crypto.createHash("sha1").update(key).digest("hex").slice(0, 14);
}

function ext(f: string): string {
  return path.extname(f).slice(1).toLowerCase();
}

interface Listing { files: string[]; dirs: string[] }

function list(dir: string): Listing {
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { files: [], dirs: [] };
  }
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const files = ents.filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name).sort(coll.compare);
  const dirs = ents.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name.toLowerCase())).map((e) => e.name).sort(coll.compare);
  return { files, dirs };
}

function art(dir: string, files: string[], base: string, names: string[]): string {
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  for (const n of names) {
    for (const e of ["jpg", "jpeg", "png", "webp"]) {
      for (const cand of [`${base.toLowerCase()}-${n}.${e}`, `${n}.${e}`]) {
        const hit = lower.get(cand);
        if (hit) return path.join(dir, hit);
      }
    }
  }
  return "";
}

// --- Kodi .nfo (only the fields Korie uses) ---------------------------------------------

export interface Nfo {
  root?: string; title?: string; year?: string; plot?: string; tmdb?: number; imdb?: string; genres?: string[]; rating?: number; director?: string; mpaa?: string;
  runtime?: number; poster?: string; fanart?: string; season?: number; episode?: number; aired?: string;
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return undefined;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

export function readNfo(file: string): Nfo {
  let xml: string;
  try {
    xml = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return {};
  }
  const out: Nfo = {};
  out.root = xml.match(/<(movie|tvshow|episodedetails|musicvideo)[\s>]/i)?.[1].toLowerCase();
  out.title = tag(xml, "title") || undefined;
  out.year = (tag(xml, "year") || tag(xml, "premiered") || tag(xml, "aired") || "").slice(0, 4) || undefined;
  out.plot = tag(xml, "plot") || tag(xml, "outline") || undefined;
  out.director = tag(xml, "director") || undefined;
  out.aired = tag(xml, "aired") || tag(xml, "premiered") || undefined;
  const uid = (type: string) => xml.match(new RegExp(`<uniqueid[^>]*type="${type}"[^>]*>\\s*([^<\\s]+)\\s*</uniqueid>`, "i"))?.[1];
  const tm = uid("tmdb") ?? tag(xml, "tmdbid") ?? tag(xml, "tmdb");
  if (tm && /^\d+$/.test(tm)) out.tmdb = Number(tm);
  const im = uid("imdb") ?? tag(xml, "imdbid") ?? tag(xml, "imdb") ?? tag(xml, "id");
  if (im && /^tt\d+$/.test(im)) out.imdb = im;
  // Kodi also writes a bare IMDb link or <id>tt...</id>
  if (!out.imdb) out.imdb = xml.match(/imdb\.com\/title\/(tt\d+)/i)?.[1];
  const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/gi)].map((m) => m[1].trim()).filter(Boolean);
  if (genres.length) out.genres = genres;
  const r = Number(tag(xml, "rating") ?? xml.match(/<rating[^>]*>[\s\S]*?<value>([\d.]+)<\/value>/i)?.[1]);
  if (r) out.rating = r;
  const mpaa = tag(xml, "mpaa") || tag(xml, "certification");
  if (mpaa) out.mpaa = mpaa;
  const rt = Number(tag(xml, "runtime"));
  if (rt) out.runtime = rt;
  const sn = Number(tag(xml, "season"));
  const ep = Number(tag(xml, "episode"));
  if (tag(xml, "season") !== undefined && Number.isFinite(sn)) out.season = sn;
  if (ep) out.episode = ep;
  // pictures: <thumb aspect="poster">, and <fanart><thumb>; not the actors' photos
  const noActors = xml.replace(/<actor>[\s\S]*?<\/actor>/gi, "");
  const thumbs = [...noActors.matchAll(/<thumb([^>]*)>\s*(https?:[^<\s]+)\s*<\/thumb>/gi)];
  const fan = noActors.match(/<fanart>([\s\S]*?)<\/fanart>/i)?.[1] ?? "";
  const fanUrl = fan.match(/<thumb[^>]*>\s*(https?:[^<\s]+)\s*<\/thumb>/i)?.[1];
  const posterThumb = thumbs.find((t) => /aspect="poster"/i.test(t[1])) ?? thumbs.find((t) => !/aspect=/i.test(t[1]) && !fan.includes(t[2]));
  if (posterThumb) out.poster = posterThumb[2];
  if (fanUrl) out.fanart = fanUrl;
  return out;
}

/** The .nfo to use: the first of these names that exists (any case). */
function nfoIn(dir: string, files: string[], names: string[]): Nfo | null {
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  for (const n of names) {
    const hit = lower.get(n.toLowerCase());
    if (hit) return readNfo(path.join(dir, hit));
  }
  return null;
}

/** A folder with just one film in it: whatever .nfo is there describes it (unless it's a show's or an episode's). */
function onlyNfo(dir: string, files: string[]): Nfo | null {
  const nfos = files.filter((f) => ext(f) === "nfo");
  for (const f of nfos) {
    const n = readNfo(path.join(dir, f));
    if (n.root === "movie" || (!n.root && (n.title || n.tmdb || n.imdb))) return n;
  }
  return null;
}

// --- names ----------------------------------------------------------------------------

export function titleYear(raw: string): { title: string; year: string } {
  const r = filenameParse(raw, false);
  const title = (r.title || raw).trim();
  return { title, year: r.year ?? "" };
}

const SEASON_DIR = /^(?:season|series|staffel|sæson|saeson|saison|sezon|temporada|s)[\s._-]*(\d{1,3})(?:[^\d].*)?$/i;

function episodeOf(name: string, seasonFromDir: number | null): { season: number; episode: number; episodeEnd?: number; title: string } | null {
  const base = name.replace(/\.[^.]+$/, "");
  const r = filenameParse(base, true) as any;
  if (r.episodeNumbers?.length) {
    const season = r.seasons?.[0] ?? seasonFromDir ?? 1;
    const eps = r.episodeNumbers;
    // an episode title after the code: "Show - S01E02 - The Title"
    // (a second episode number, as in S01E01E02 or S01E01-02, but not the 1080 of 1080p)
    const after = base.split(/s\d{1,3}[\s._-]*e\d{1,3}(?:[\s._-]*e?\d{1,3}(?![\dpi]))*|\d{1,2}x\d{2,3}/i)[1] ?? "";
    const words: string[] = [];
    for (const w of after.replace(/[._]/g, " ").split(/\s+/).filter(Boolean)) {
      if (/^(\d{3,4}p|4k|uhd|web(-?dl|rip)?|blu-?ray|bdrip|brrip|hdtv|dvdrip|x26[45]|h\.?26[45]|hevc|avc|aac|ac3|dts|hdr\d*|remux|proper|repack|10bit|multi|nordic|danish|dansk)$/i.test(w)) break;
      words.push(w);
    }
    const title = words.join(" ").replace(/^[\s-]+|[\s-]+$/g, "").trim();
    return { season, episode: eps[0], episodeEnd: eps.length > 1 ? eps[eps.length - 1] : undefined, title };
  }
  // "03 - Name" or "E03" inside a Season folder
  const m = base.match(/^(?:e|ep|episode)?[\s._-]*(\d{1,3})(?:[\s._-]+(.*))?$/i);
  if (m && seasonFromDir !== null) return { season: seasonFromDir, episode: Number(m[1]), title: (m[2] ?? "").replace(/[._]/g, " ").trim() };
  return null;
}

// --- what a scan finds ----------------------------------------------------------------

export interface FoundFilm {
  id: string; file: string; title: string; year: string; nfo: Nfo; poster: string; backdrop: string; subs: string[]; disc?: "dvd" | "bluray" | "iso"; parts?: string[];
}
export interface FoundEpisode { id: string; file: string; season: number; episode: number; episodeEnd?: number; title: string; thumb: string; subs: string[]; nfo?: Nfo }
export interface FoundSeries { id: string; dir: string; title: string; year: string; nfo: Nfo; poster: string; backdrop: string; episodes: FoundEpisode[] }
/** A song's genre tag, tidied ("electronic; dance" → "Electronic"; ID3's "(17)" numbers are left out). */
function genreOf(g: unknown): string {
  const first = (Array.isArray(g) ? g : [g]).map((x) => String(x ?? "").split(/[;/,]/)[0].trim()).find((x) => x && !/^\(?\d+\)?$/.test(x));
  return first ? first.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40) : "";
}

export interface FoundTrack { id: string; file: string; title: string; artist: string; track: number; disc: number; duration: number; genre: string }
export interface FoundAlbum { id: string; title: string; artist: string; year: string; cover: string; tracks: FoundTrack[]; genres: string[] }

function subsFor(dir: string, files: string[], base: string): string[] {
  const b = base.toLowerCase();
  return files.filter((f) => SUBS.has(ext(f)) && f.toLowerCase().startsWith(b)).map((f) => path.join(dir, f));
}

// one film in several files: "Film CD1.avi", "Film - Part 2.mkv", "CD 1.avi" (Kodi's stacking names)
const STACK = /^(.*?)([\s._-]*(?:cd|dvd|part|pt|disc|disk)[\s._-]*([0-9]{1,2}|[a-d]))(.*?)$/i;

function stacks(videos: string[]): string[][] {
  const groups = new Map<string, { n: string; f: string }[]>();
  const out: string[][] = [];
  for (const f of videos) {
    const base = f.replace(/\.[^.]+$/, "");
    const m = base.match(STACK);
    if (!m) {
      out.push([f]);
      continue;
    }
    const k = (m[1] + "\u0000" + m[4] + "\u0000" + ext(f)).toLowerCase();
    const g = groups.get(k) ?? [];
    g.push({ n: m[3].toLowerCase(), f });
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    if (g.length < 2) out.push(...g.map((x) => [x.f]));
    else out.push(g.sort((a, b) => a.n.localeCompare(b.n, undefined, { numeric: true })).map((x) => x.f));
  }
  return out;
}

export function scanFilms(root: string): FoundFilm[] {
  const out: FoundFilm[] = [];
  const disc = (dir: string, files: string[], kind: "dvd" | "bluray"): void => {
    const name = path.basename(dir);
    const ty = titleYear(name);
    const inner = kind === "dvd" ? path.join(dir, "VIDEO_TS") : path.join(dir, "BDMV");
    const nfo = nfoIn(dir, files, ["movie.nfo", name + ".nfo", "VIDEO_TS.nfo", "index.nfo"]) ?? nfoIn(inner, list(inner).files, ["VIDEO_TS.nfo", "index.nfo", "movie.nfo"]) ?? onlyNfo(dir, files) ?? {};
    out.push({
      id: idFor("f", dir), file: dir, title: nfo.title || ty.title, year: nfo.year || ty.year, nfo,
      poster: art(dir, files, name, ["poster", "folder", "cover"]), backdrop: art(dir, files, name, ["fanart", "backdrop", "landscape"]), subs: [], disc: kind,
    });
  };
  const walk = (dir: string, depth: number): void => {
    const { files, dirs } = list(dir);
    // a DVD or Blu-ray folder is one film
    if (dirs.some((d) => d.toUpperCase() === "VIDEO_TS") || files.some((f) => f.toUpperCase() === "VIDEO_TS.IFO")) return disc(dir, files, "dvd");
    if (dirs.some((d) => d.toUpperCase() === "BDMV")) return disc(dir, files, "bluray");
    const videos = files.filter((f) => VIDEO.has(ext(f)) && !/(^|[\s._-])(sample|trailer)([\s._-]|$)/i.test(f));
    const films = stacks(videos);
    const parent = path.basename(dir);
    for (const parts of films) {
      const f = parts[0];
      const base = f.replace(/\.[^.]+$/, "");
      const stem = parts.length > 1 ? (base.match(STACK)?.[1] ?? "").replace(/[\s._-]+$/, "") : base;
      const alone = films.length === 1;
      // a film in its own folder: the folder name is usually the cleanest
      let ty = titleYear(stem || parent);
      if (depth > 0 && (alone || !stem)) {
        const fy = titleYear(parent);
        if (fy.year || !ty.year || !stem) ty = { title: fy.title || ty.title, year: fy.year || ty.year };
      }
      const names = [base + ".nfo", ...(stem ? [stem + ".nfo"] : []), ...parts.slice(1).map((p) => p.replace(/\.[^.]+$/, "") + ".nfo")];
      if (alone) names.push("movie.nfo", parent + ".nfo");
      const nfo = nfoIn(dir, files, names) ?? (alone ? onlyNfo(dir, files) : null) ?? {};
      const artBase = stem || base;
      out.push({
        id: idFor("f", path.join(dir, f)), file: path.join(dir, f), title: nfo.title || ty.title, year: nfo.year || ty.year, nfo,
        poster: art(dir, files, artBase, alone ? ["poster", "folder", "cover"] : ["poster"]) || (artBase !== base ? art(dir, files, base, ["poster"]) : ""),
        backdrop: art(dir, files, artBase, alone ? ["fanart", "backdrop", "landscape"] : ["fanart"]),
        subs: subsFor(dir, files, base), disc: ext(f) === "iso" ? "iso" : undefined,
        parts: parts.length > 1 ? parts.map((p) => path.join(dir, p)) : undefined,
      });
    }
    if (depth < 8) for (const d of dirs) walk(path.join(dir, d), depth + 1);
  };
  walk(root, 0);
  return out;
}

const isSeasonDir = (d: string) => SEASON_DIR.test(d) || /^specials?$/i.test(d);

/** Is this folder one show? It has a tvshow.nfo, season folders, or episode files of its own. */
function looksLikeShow(dir: string, l: Listing): boolean {
  if (l.files.some((f) => f.toLowerCase() === "tvshow.nfo")) return true;
  if (l.dirs.some(isSeasonDir)) return true;
  if (!l.files.some((f) => VIDEO.has(ext(f)) && episodeOf(f, null) !== null)) return false;
  // episodes of its own, but also show folders inside: it's a group with some loose episodes
  return !l.dirs.some((d) => {
    const sub = list(path.join(dir, d));
    return sub.files.some((f) => f.toLowerCase() === "tvshow.nfo") || sub.dirs.some(isSeasonDir);
  });
}

function showFrom(dir: string, l: Listing): FoundSeries {
  const nfo = nfoIn(dir, l.files, ["tvshow.nfo"]) ?? {};
  const ty = titleYear(path.basename(dir));
  const s: FoundSeries = {
    id: idFor("s", dir), dir, title: nfo.title || ty.title, year: nfo.year || ty.year, nfo,
    poster: art(dir, l.files, "", ["poster", "folder", "cover"]), backdrop: art(dir, l.files, "", ["fanart", "backdrop", "landscape"]), episodes: [],
  };
  const walk = (d: string, season: number | null, depth: number): void => {
    const { files, dirs } = list(d);
    for (const f of files.filter((x) => VIDEO.has(ext(x)))) {
      const base = f.replace(/\.[^.]+$/, "");
      const enfo = nfoIn(d, files, [base + ".nfo"]);
      let e = episodeOf(f, season);
      // an episode .nfo knows its own season and number
      if (enfo?.episode) e = { season: enfo.season ?? e?.season ?? season ?? 1, episode: enfo.episode, episodeEnd: e?.episodeEnd, title: e?.title ?? "" };
      if (!e) continue;
      if (enfo?.title) e.title = enfo.title;
      s.episodes.push({ id: idFor("e", path.join(d, f)), file: path.join(d, f), ...e, thumb: art(d, files, base, ["thumb"]), subs: subsFor(d, files, base), nfo: enfo ?? undefined });
    }
    if (depth < 4) {
      for (const sub of dirs) {
        const m = sub.match(SEASON_DIR);
        const sn = m ? Number(m[1]) : /^specials?$/i.test(sub) ? 0 : season;
        walk(path.join(d, sub), sn, depth + 1);
      }
    }
  };
  walk(dir, null, 0);
  s.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  return s;
}

export function scanSeries(root: string): FoundSeries[] {
  const out: FoundSeries[] = [];
  // folders are shows, or groups of shows ("TV/Danish/Show/Season 1"): look down until it's a show
  const visit = (dir: string, l: Listing, depth: number): void => {
    for (const name of l.dirs) {
      const d = path.join(dir, name);
      const sub = list(d);
      if (looksLikeShow(d, sub)) {
        const s = showFrom(d, sub);
        if (s.episodes.length) out.push(s);
      } else if (depth < 5) {
        visit(d, sub, depth + 1);
      }
    }
    loose(dir, l.files);
  };
  // loose episode files in a folder that isn't a show: grouped by the show name in the file name
  const loose = (dir: string, files: string[]): void => {
    const groups = new Map<string, FoundSeries>();
    for (const f of files.filter((x) => VIDEO.has(ext(x)))) {
      const e = episodeOf(f, null);
      if (!e) continue;
      const show = filenameParse(f.replace(/\.[^.]+$/, ""), true).title || "Unknown";
      let s = groups.get(show.toLowerCase());
      if (!s) {
        s = { id: idFor("s", path.join(dir, "#" + show.toLowerCase())), dir, title: show, year: "", nfo: {}, poster: "", backdrop: "", episodes: [] };
        groups.set(show.toLowerCase(), s);
        out.push(s);
      }
      const base = f.replace(/\.[^.]+$/, "");
      const enfo = nfoIn(dir, files, [base + ".nfo"]);
      if (enfo?.title) e.title = enfo.title;
      s.episodes.push({ id: idFor("e", path.join(dir, f)), file: path.join(dir, f), ...e, thumb: art(dir, files, base, ["thumb"]), subs: subsFor(dir, files, base), nfo: enfo ?? undefined });
    }
  };
  const top = list(root);
  // the library folder itself can be one show
  if (top.dirs.some(isSeasonDir) || top.files.some((f) => f.toLowerCase() === "tvshow.nfo")) {
    const s = showFrom(root, top);
    if (s.episodes.length) out.push(s);
    return out;
  }
  visit(root, top, 0);
  return out;
}

export async function scanMusic(root: string, coverDir: string): Promise<FoundAlbum[]> {
  const albums = new Map<string, FoundAlbum>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    const { files, dirs } = list(dir);
    const folderCover = art(dir, files, "", ["cover", "folder", "front", "album"]);
    for (const f of files.filter((x) => AUDIO.has(ext(x)))) {
      const file = path.join(dir, f);
      let common: any = {};
      let duration = 0;
      try {
        const m = await parseFile(file, { duration: false, skipCovers: !!folderCover });
        common = m.common;
        duration = m.format.duration ?? 0;
        if (!folderCover && m.common.picture?.[0]) {
          const p = m.common.picture[0];
          const key = idFor("c", dir + "|" + (common.album ?? ""));
          const out = path.join(coverDir, key + (p.format.includes("png") ? ".png" : ".jpg"));
          if (!fs.existsSync(out)) fs.writeFileSync(out, p.data);
          common._cover = out;
        }
      } catch {
        /* no tags: folder names below */
      }
      const parent = path.basename(dir);
      const grand = depth > 0 ? path.basename(path.dirname(dir)) : "";
      const albumTitle = common.album || (depth > 0 ? parent : "Unknown album");
      const artist = common.albumartist || common.artist || (depth > 1 ? grand : "Unknown artist");
      const key = (artist + "|" + albumTitle).toLowerCase();
      let a = albums.get(key);
      if (!a) {
        a = { id: idFor("a", root + "|" + key), title: albumTitle, artist, year: common.year ? String(common.year) : "", cover: folderCover || common._cover || "", tracks: [], genres: [] };
        albums.set(key, a);
      }
      if (!a.cover && common._cover) a.cover = common._cover;
      const tm = f.match(/^(\d{1,3})[\s._-]+(.+)\.[^.]+$/);
      a.tracks.push({
        id: idFor("t", file), file, title: common.title || (tm ? tm[2] : f.replace(/\.[^.]+$/, "")).trim(),
        artist: common.artist || artist, track: common.track?.no ?? (tm ? Number(tm[1]) : 0), disc: common.disk?.no ?? 1, duration,
        genre: genreOf(common.genre),
      });
      if (a.tracks[a.tracks.length - 1].genre && !a.genres.includes(a.tracks[a.tracks.length - 1].genre)) a.genres.push(a.tracks[a.tracks.length - 1].genre);
    }
    if (depth < 6) for (const d of dirs) await walk(path.join(dir, d), depth + 1);
  };
  await walk(root, 0);
  for (const a of albums.values()) a.tracks.sort((x, y) => x.disc - y.disc || x.track - y.track || x.title.localeCompare(y.title));
  return [...albums.values()];
}
