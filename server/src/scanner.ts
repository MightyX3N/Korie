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

export interface Nfo { title?: string; year?: string; plot?: string; tmdb?: number; genres?: string[]; rating?: number; director?: string }

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return undefined;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

export function readNfo(file: string): Nfo {
  let xml: string;
  try {
    xml = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const out: Nfo = {};
  out.title = tag(xml, "title");
  out.year = tag(xml, "year") ?? tag(xml, "premiered")?.slice(0, 4);
  out.plot = tag(xml, "plot");
  out.director = tag(xml, "director");
  const uid = xml.match(/<uniqueid[^>]*type="tmdb"[^>]*>(\d+)<\/uniqueid>/i)?.[1] ?? tag(xml, "tmdbid");
  if (uid && /^\d+$/.test(uid)) out.tmdb = Number(uid);
  const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/gi)].map((m) => m[1].trim());
  if (genres.length) out.genres = genres;
  const r = Number(tag(xml, "rating"));
  if (r) out.rating = r;
  return out;
}

// --- names ----------------------------------------------------------------------------

export function titleYear(raw: string): { title: string; year: string } {
  const r = filenameParse(raw, false);
  const title = (r.title || raw).trim();
  return { title, year: r.year ?? "" };
}

const SEASON_DIR = /^(?:season|series|staffel|sæson|saison|s)[\s._-]*(\d{1,3})$/i;

function episodeOf(name: string, seasonFromDir: number | null): { season: number; episode: number; episodeEnd?: number; title: string } | null {
  const base = name.replace(/\.[^.]+$/, "");
  const r = filenameParse(base, true) as any;
  if (r.episodeNumbers?.length) {
    const season = r.seasons?.[0] ?? seasonFromDir ?? 1;
    const eps = r.episodeNumbers;
    // an episode title after the code: "Show - S01E02 - The Title"
    const after = base.split(/s\d{1,3}[\s._-]*e\d{1,3}(?:[\s._-]*e?\d{1,3})*|\d{1,2}x\d{2,3}/i)[1] ?? "";
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
  id: string; file: string; title: string; year: string; nfo: Nfo; poster: string; backdrop: string; subs: string[]; disc?: "dvd" | "bluray" | "iso";
}
export interface FoundEpisode { id: string; file: string; season: number; episode: number; episodeEnd?: number; title: string; thumb: string; subs: string[] }
export interface FoundSeries { id: string; dir: string; title: string; year: string; nfo: Nfo; poster: string; backdrop: string; episodes: FoundEpisode[] }
export interface FoundTrack { id: string; file: string; title: string; artist: string; track: number; disc: number; duration: number }
export interface FoundAlbum { id: string; title: string; artist: string; year: string; cover: string; tracks: FoundTrack[] }

function subsFor(dir: string, files: string[], base: string): string[] {
  const b = base.toLowerCase();
  return files.filter((f) => SUBS.has(ext(f)) && f.toLowerCase().startsWith(b)).map((f) => path.join(dir, f));
}

export function scanFilms(root: string): FoundFilm[] {
  const out: FoundFilm[] = [];
  const walk = (dir: string, depth: number): void => {
    const { files, dirs } = list(dir);
    // a DVD or Blu-ray folder is one film
    if (dirs.some((d) => d.toUpperCase() === "VIDEO_TS") || files.some((f) => f.toUpperCase() === "VIDEO_TS.IFO")) {
      const name = path.basename(dir);
      const ty = titleYear(name);
      out.push({ id: idFor("f", dir), file: dir, ...ty, nfo: {}, poster: art(dir, files, name, ["poster", "folder", "cover"]), backdrop: art(dir, files, name, ["fanart", "backdrop"]), subs: [], disc: "dvd" });
      return;
    }
    if (dirs.some((d) => d.toUpperCase() === "BDMV")) {
      const name = path.basename(dir);
      out.push({ id: idFor("f", dir), file: dir, ...titleYear(name), nfo: {}, poster: art(dir, files, name, ["poster", "folder", "cover"]), backdrop: art(dir, files, name, ["fanart", "backdrop"]), subs: [], disc: "bluray" });
      return;
    }
    const videos = files.filter((f) => VIDEO.has(ext(f)) && !/(^|[\s._-])(sample|trailer)([\s._-]|$)/i.test(f));
    for (const f of videos) {
      const base = f.replace(/\.[^.]+$/, "");
      const parent = path.basename(dir);
      // a film in its own folder: the folder name is usually the cleanest
      let ty = titleYear(base);
      if (depth > 0 && videos.length === 1) {
        const fy = titleYear(parent);
        if (fy.year || !ty.year) ty = { title: fy.title || ty.title, year: fy.year || ty.year };
      }
      const nfoFile = [base + ".nfo", "movie.nfo"].map((n) => path.join(dir, n)).find((p) => fs.existsSync(p));
      const nfo = nfoFile ? readNfo(nfoFile) : {};
      out.push({
        id: idFor("f", path.join(dir, f)), file: path.join(dir, f), title: nfo.title || ty.title, year: nfo.year || ty.year, nfo,
        poster: art(dir, files, base, videos.length === 1 ? ["poster", "folder", "cover"] : ["poster"]),
        backdrop: art(dir, files, base, videos.length === 1 ? ["fanart", "backdrop", "landscape"] : ["fanart"]),
        subs: subsFor(dir, files, base), disc: ext(f) === "iso" ? "iso" : undefined,
      });
    }
    if (depth < 6) for (const d of dirs) walk(path.join(dir, d), depth + 1);
  };
  walk(root, 0);
  return out;
}

export function scanSeries(root: string): FoundSeries[] {
  const out: FoundSeries[] = [];
  const top = list(root);
  // each folder is a show
  for (const showDir of top.dirs) {
    const dir = path.join(root, showDir);
    const showFiles = list(dir).files;
    const nfo = fs.existsSync(path.join(dir, "tvshow.nfo")) ? readNfo(path.join(dir, "tvshow.nfo")) : {};
    const ty = titleYear(showDir);
    const s: FoundSeries = {
      id: idFor("s", dir), dir, title: nfo.title || ty.title, year: nfo.year || ty.year, nfo,
      poster: art(dir, showFiles, "", ["poster", "folder", "cover"]), backdrop: art(dir, showFiles, "", ["fanart", "backdrop", "landscape"]), episodes: [],
    };
    const walk = (d: string, season: number | null, depth: number): void => {
      const { files, dirs } = list(d);
      for (const f of files.filter((x) => VIDEO.has(ext(x)))) {
        const e = episodeOf(f, season);
        if (!e) continue;
        const base = f.replace(/\.[^.]+$/, "");
        s.episodes.push({ id: idFor("e", path.join(d, f)), file: path.join(d, f), ...e, thumb: art(d, files, base, ["thumb"]), subs: subsFor(d, files, base) });
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
    if (s.episodes.length) {
      s.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
      out.push(s);
    }
  }
  // loose episode files straight in the series folder: grouped by show name
  const loose = new Map<string, FoundSeries>();
  for (const f of top.files.filter((x) => VIDEO.has(ext(x)))) {
    const e = episodeOf(f, null);
    if (!e) continue;
    const show = filenameParse(f.replace(/\.[^.]+$/, ""), true).title || "Unknown";
    let s = loose.get(show.toLowerCase());
    if (!s) {
      s = { id: idFor("s", path.join(root, "#" + show.toLowerCase())), dir: root, title: show, year: "", nfo: {}, poster: "", backdrop: "", episodes: [] };
      loose.set(show.toLowerCase(), s);
      out.push(s);
    }
    s.episodes.push({ id: idFor("e", path.join(root, f)), file: path.join(root, f), ...e, thumb: "", subs: subsFor(root, top.files, f.replace(/\.[^.]+$/, "")) });
  }
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
        a = { id: idFor("a", root + "|" + key), title: albumTitle, artist, year: common.year ? String(common.year) : "", cover: folderCover || common._cover || "", tracks: [] };
        albums.set(key, a);
      }
      if (!a.cover && common._cover) a.cover = common._cover;
      const tm = f.match(/^(\d{1,3})[\s._-]+(.+)\.[^.]+$/);
      a.tracks.push({
        id: idFor("t", file), file, title: common.title || (tm ? tm[2] : f.replace(/\.[^.]+$/, "")).trim(),
        artist: common.artist || artist, track: common.track?.no ?? (tm ? Number(tm[1]) : 0), disc: common.disk?.no ?? 1, duration,
      });
    }
    if (depth < 6) for (const d of dirs) await walk(path.join(dir, d), depth + 1);
  };
  await walk(root, 0);
  for (const a of albums.values()) a.tracks.sort((x, y) => x.disc - y.disc || x.track - y.track || x.title.localeCompare(y.title));
  return [...albums.values()];
}
