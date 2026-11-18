// Downloads: an add-on's film or episode (DRTV, Stremio) saved into a library on the server, with
// its subtitles and a Kodi .nfo, so it plays like the rest of the library. A series' new episodes
// can be followed: they're downloaded as they come out.
//
//   Films:  <films folder>/<Title> (<Year>)/<Title> (<Year>).mkv   + movie.nfo, <name>.da.srt
//   Series: <series folder>/<Series>/Season 01/<Series> - S01E02 - <Title>.mkv   + tvshow.nfo, <name>.nfo
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { db, now, setting, setSetting } from "./db.ts";
import { FFMPEG, log } from "./config.ts";
import { emit } from "./events.ts";
import * as lib from "./library.ts";
import * as people from "./people.ts";
import * as browse from "./addons/browse.ts";
import * as playback from "./playback.ts";

db.exec(`CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, person TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  series TEXT, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, file TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL, finished INTEGER NOT NULL DEFAULT 0)`);
db.exec(`CREATE TABLE IF NOT EXISTS download_follows (series TEXT PRIMARY KEY, person TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL)`);
for (const col of ["snap TEXT NOT NULL DEFAULT ''", "series_snap TEXT NOT NULL DEFAULT ''"]) {
  try {
    db.exec(`ALTER TABLE downloads ADD COLUMN ${col}`);
  } catch {
    /* there already */
  }
}
// a download that was running when Korie stopped starts again
db.exec(`UPDATE downloads SET status = 'queued', progress = 0 WHERE status = 'downloading'`);

export interface Download { id: number; item: string; person: string; kind: string; title: string; series: string | null; status: "queued" | "downloading" | "done" | "failed" | "cancelled"; progress: number; file: string; error: string; created: number; finished: number; snap: string; series_snap: string }

export function list(limit = 300): Download[] {
  return db.prepare("SELECT * FROM downloads ORDER BY CASE status WHEN 'downloading' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, id DESC LIMIT ?").all(limit) as Download[];
}

/** The newest download of each of these items (for the item pages). */
export function stateOf(ids: string[]): Record<string, { status: string; progress: number; error: string }> {
  const out: Record<string, { status: string; progress: number; error: string }> = {};
  const q = db.prepare("SELECT status, progress, error FROM downloads WHERE item = ? ORDER BY id DESC LIMIT 1");
  for (const id of ids) {
    const r = q.get(id) as { status: string; progress: number; error: string } | undefined;
    if (r && r.status !== "cancelled") out[id] = r;
  }
  return out;
}

export function following(series: string): boolean {
  return !!db.prepare("SELECT 1 FROM download_follows WHERE series = ?").get(series);
}

/** Where downloads go: a library folder of the right kind (the one picked in the admin, or the first). */
export function folderFor(kind: "films" | "series"): lib.Folder | null {
  const all = lib.folders().filter((f) => f.kind === kind);
  const want = setting<number | null>(`downloads_${kind}`);
  return all.find((f) => f.id === want) ?? all[0] ?? null;
}

export function setFolder(kind: "films" | "series", id: number): boolean {
  if (!lib.folders().some((f) => f.id === id && f.kind === kind)) return false;
  setSetting(`downloads_${kind}`, id);
  return true;
}

function busy(item: string): boolean {
  return !!db.prepare("SELECT 1 FROM downloads WHERE item = ? AND status IN ('queued', 'downloading', 'done')").get(item);
}

/** Queues a film, an episode, a season (season: its number) or a whole series. How many were queued. */
export async function add(itemId: string, person: string, season?: number | null): Promise<number> {
  let a = browse.get(itemId);
  if (!a) throw new Error("This isn't known any more. Open it again.");
  if (a.kind !== "film" && a.kind !== "episode" && a.kind !== "series") throw new Error("Only films and series can be downloaded.");
  if (!folderFor(a.kind === "film" ? "films" : "series")) throw new Error(`Add a ${a.kind === "film" ? "Films" : "Series"} library first (Admin, Libraries): downloads go into it.`);
  if (a.kind !== "series") {
    if (busy(a.id)) return 0;
    insert(a, person);
    pump();
    return 1;
  }
  if (!a.seasons?.length) a = await browse.open(a.id, person);
  let n = 0;
  for (const s of a.seasons ?? []) {
    if (season != null && s.n !== season) continue;
    for (const e of s.episodes) {
      if (busy(e.id)) continue;
      insert(e, person, a.id);
      n++;
    }
  }
  pump();
  return n;
}

/** What's needed to know an item again after a restart (the add-on's own id and data). */
function snapOf(a: browse.AItem | null | undefined): string {
  if (!a) return "";
  const { seasons: _s, ...rest } = a;
  return JSON.stringify(rest);
}

function known(id: string | null, snap: string): browse.AItem | null {
  if (!id) return null;
  const a = browse.get(id);
  if (a || !snap) return a;
  try {
    const s = JSON.parse(snap) as browse.AItem;
    const at = s.series ? s.series.indexOf("/") : -1;
    return browse.item(s.source, { ...s, id: s.sourceId, series: at > 0 ? s.series!.slice(at + 1) : undefined, series_title: s.seriesTitle }) ?? null;
  } catch {
    return null;
  }
}

function insert(a: browse.AItem, person: string, series?: string): void {
  const sid = series ?? a.series ?? null;
  db.prepare("INSERT INTO downloads(item, person, kind, title, series, status, created, snap, series_snap) VALUES(?, ?, ?, ?, ?, 'queued', ?, ?, ?)")
    .run(a.id, person, a.kind, a.title, sid, now(), snapOf(a), snapOf(sid ? browse.get(sid) : null));
  emit("downloads");
}

export function cancel(id: number): boolean {
  const d = db.prepare("SELECT * FROM downloads WHERE id = ?").get(id) as Download | undefined;
  if (!d || (d.status !== "queued" && d.status !== "downloading")) return false;
  db.prepare("UPDATE downloads SET status = 'cancelled', finished = ? WHERE id = ?").run(now(), id);
  if (running?.id === id) running.proc?.kill("SIGKILL");
  emit("downloads");
  return true;
}

/** Takes failed and cancelled ones off the list (finished ones stay: they're how Korie knows not to download them again). */
export function clear(): void {
  db.prepare("DELETE FROM downloads WHERE status IN ('failed', 'cancelled')").run();
  emit("downloads");
}

/** Follows a series: its new episodes are downloaded as they come out (checked every few hours). */
export async function follow(series: string, person: string, on: boolean): Promise<void> {
  const a = browse.get(series);
  if (on) {
    if (!a || a.kind !== "series") throw new Error("Only a series can be followed.");
    db.prepare("INSERT OR REPLACE INTO download_follows(series, person, title, created) VALUES(?, ?, ?, ?)").run(series, person, a.title, now());
    await add(series, person); // what's out already
  } else {
    db.prepare("DELETE FROM download_follows WHERE series = ?").run(series);
  }
  emit("downloads");
}

export function follows(): { series: string; person: string; title: string; created: number }[] {
  return db.prepare("SELECT * FROM download_follows ORDER BY title").all() as { series: string; person: string; title: string; created: number }[];
}

export async function checkFollows(): Promise<void> {
  for (const f of follows()) {
    let a = browse.get(f.series) ?? browse.seriesById(f.series);
    if (!a) continue;
    try {
      a.seasons = undefined; // ask the add-on again: that's where new episodes show up
      a = await browse.open(a.id, f.person);
      let n = 0;
      for (const s of a.seasons ?? []) for (const e of s.episodes) if (!busy(e.id)) { insert(e, f.person, a.id); n++; }
      if (n) log("downloads", `${a.title}: ${n} new episode${n === 1 ? "" : "s"} to download`);
    } catch (e) {
      log("downloads", `${f.title}: couldn't look for new episodes: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  pump();
}
setInterval(() => void checkFollows(), 6 * 60 * 60 * 1000).unref();
setTimeout(() => void checkFollows(), 2 * 60 * 1000).unref();

// --- the downloading itself, one at a time ----------------------------------------------------

let running: { id: number; proc: ChildProcess | null } | null = null;

export function pump(): void {
  if (running) return;
  const d = db.prepare("SELECT * FROM downloads WHERE status = 'queued' ORDER BY id LIMIT 1").get() as Download | undefined;
  if (!d) return;
  running = { id: d.id, proc: null };
  db.prepare("UPDATE downloads SET status = 'downloading', progress = 0, error = '' WHERE id = ?").run(d.id);
  emit("downloads");
  void run(d).then(
    (file) => {
      const still = db.prepare("SELECT status FROM downloads WHERE id = ?").get(d.id) as { status: string } | undefined;
      if (still?.status === "cancelled") return;
      db.prepare("UPDATE downloads SET status = 'done', progress = 1, file = ?, finished = ? WHERE id = ?").run(file, now(), d.id);
      log("downloads", `${d.title}: downloaded to ${file}`);
    },
    (e) => {
      const still = db.prepare("SELECT status FROM downloads WHERE id = ?").get(d.id) as { status: string } | undefined;
      if (still?.status === "cancelled") return;
      const msg = e instanceof Error ? e.message : String(e);
      db.prepare("UPDATE downloads SET status = 'failed', error = ?, finished = ? WHERE id = ?").run(msg.slice(0, 500), now(), d.id);
      log("downloads", `${d.title}: ${msg}`);
    },
  ).finally(() => {
    running = null;
    emit("downloads");
    pump();
  });
}

/** A name a file system takes: no slashes or other characters Windows and NAS shares refuse. */
function safe(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 120) || "Untitled";
}

function xml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const LANGS: Record<string, string> = { dansk: "da", danish: "da", english: "en", engelsk: "en", svenska: "sv", norsk: "no", deutsch: "de" };
function langCode(l: string, title: string): string {
  const x = (l || "").toLowerCase();
  if (/^[a-z]{2,3}$/.test(x)) return x;
  return LANGS[x] ?? LANGS[(title || "").toLowerCase()] ?? "und";
}

async function run(d: Download): Promise<string> {
  const a = known(d.item, d.snap);
  if (!a) throw new Error("It isn't known any more: queue it again.");
  let series = known(d.series, d.series_snap);
  // the series' seasons, for the episode's season and number when the add-on didn't give them
  if (series && !series.seasons?.length && (a.season === undefined || a.episode === undefined)) series = await browse.open(series.id, d.person).catch(() => series);
  const who = people.get(d.person);
  const ans = await browse.play(a.id, who?.id ?? null);
  if (ans.web || !ans.url) throw new Error("It only plays in a web page, which can't be downloaded.");
  if (ans.live) throw new Error("Live TV can't be downloaded.");

  // where it goes
  let dir: string, base: string;
  if (a.kind === "film") {
    const f = folderFor("films");
    if (!f) throw new Error("There's no Films library to download into.");
    const name = safe(a.year ? `${a.title} (${a.year})` : a.title);
    dir = path.join(f.path, name);
    base = name;
  } else {
    const f = folderFor("series");
    if (!f) throw new Error("There's no Series library to download into.");
    const show = safe(series?.title || a.seriesTitle || "Series");
    const sn = a.season ?? findSeason(series, a.id) ?? 1;
    const en = a.episode ?? findEpisode(series, a.id) ?? 1;
    const code = `S${String(sn).padStart(2, "0")}E${String(en).padStart(2, "0")}`;
    dir = path.join(f.path, show, `Season ${String(sn).padStart(2, "0")}`);
    base = safe(`${show} - ${code}${a.title && !/^Episode \d+$/.test(a.title) ? " - " + a.title : ""}`);
    // the series' own .nfo, once
    const showDir = path.dirname(dir);
    fs.mkdirSync(showDir, { recursive: true });
    const tv = path.join(showDir, "tvshow.nfo");
    if (series && !fs.existsSync(tv)) {
      fs.writeFileSync(tv, `<?xml version="1.0" encoding="UTF-8"?>\n<tvshow>\n  <title>${xml(series.title)}</title>\n  <year>${xml(series.year)}</year>\n  <plot>${xml(series.overview)}</plot>\n${series.genres.map((g) => `  <genre>${xml(g)}</genre>\n`).join("")}${series.poster ? `  <thumb aspect="poster">${xml(series.poster)}</thumb>\n` : ""}${series.backdrop ? `  <fanart><thumb>${xml(series.backdrop)}</thumb></fanart>\n` : ""}</tvshow>\n`);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, base + ".mkv");
  const part = path.join(dir, base + ".part.mkv");

  // which picture and sound: one quality (the best up to 1080p) and its own sound tracks
  const src: playback.Source = { url: ans.url, headers: ans.headers };
  const p = await playback.probe(src).catch(() => null);
  const maps: string[] = [];
  if (p?.streams.length) {
    const vids = p.streams.filter((s) => s.type === "video");
    const fit = vids.filter((x) => !x.height || x.height <= 1080);
    const v = (fit.length ? fit : vids).reduce<playback.Stream | undefined>((b, x) => (!b || x.width * x.height > b.width * b.height ? x : b), undefined);
    const auds = p.streams.filter((s) => s.type === "audio" && (v?.program === undefined || s.program === v.program));
    const seen = new Set<string>();
    if (v) maps.push("-map", `0:${v.index}`);
    for (const x of auds) {
      const k = `${x.lang}|${x.title}|${x.codec}|${x.channels}`;
      if (seen.has(k)) continue;
      seen.add(k);
      maps.push("-map", `0:${x.index}`);
    }
  } else {
    maps.push("-map", "0:v:0?", "-map", "0:a?");
  }
  const total = p?.duration || (a.runtime ? a.runtime * 60 : 0);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...(await playback.inputArgs(src)), ...maps, "-c", "copy", "-sn", "-dn",
    ...(p?.streams.some((s) => s.type === "audio" && s.codec === "aac") ? ["-bsf:a", "aac_adtstoasc"] : []),
    "-progress", "pipe:1", "-f", "matroska", part];
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    if (running) running.proc = ff;
    let err = "";
    let last = 0;
    ff.stderr.on("data", (b) => (err = (err + b.toString()).slice(-1500)));
    ff.stdout.on("data", (b) => {
      const m = b.toString().match(/out_time_us=(\d+)/g);
      if (!m || !total) return;
      const t = Number(m[m.length - 1].split("=")[1]) / 1e6;
      const pr = Math.max(0, Math.min(0.99, t / total));
      if (pr - last >= 0.01) {
        last = pr;
        db.prepare("UPDATE downloads SET progress = ? WHERE id = ?").run(pr, d.id);
        emit("downloads");
      }
    });
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else {
        try {
          fs.rmSync(part, { force: true });
        } catch {
          /* gone */
        }
        reject(new Error(code === null ? "it was stopped" : /403/.test(err) ? "the source said no (403): it only streams to its own country" : err.split("\n").filter(Boolean).pop() || `FFmpeg stopped (${code})`));
      }
    });
  });
  fs.renameSync(part, file);

  // subtitles next to it, as .srt (the library picks them up by name)
  const used = new Set<string>();
  for (const s of ans.subtitles) {
    let lang = langCode(s.language, s.title);
    while (used.has(lang)) lang += "x";
    used.add(lang);
    const out = path.join(dir, `${base}.${lang}.srt`);
    await new Promise<void>((resolve) => {
      const ff = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...(ans.headers ? ["-headers", Object.entries(ans.headers).map(([k, v]) => `${k}: ${v}\r\n`).join("")] : []), "-i", s.url, out], { stdio: "ignore" });
      ff.on("close", () => resolve());
    });
  }

  // what it is, for the library (TMDb may not know DR's own programmes)
  if (a.kind === "film") {
    fs.writeFileSync(path.join(dir, "movie.nfo"), `<?xml version="1.0" encoding="UTF-8"?>\n<movie>\n  <title>${xml(a.title)}</title>\n  <year>${xml(a.year)}</year>\n  <plot>${xml(a.overview)}</plot>\n${a.runtime ? `  <runtime>${a.runtime}</runtime>\n` : ""}${a.genres.map((g) => `  <genre>${xml(g)}</genre>\n`).join("")}${a.director ? `  <director>${xml(a.director)}</director>\n` : ""}${a.cert ? `  <mpaa>${xml(a.cert)}</mpaa>\n` : ""}${a.poster ? `  <thumb aspect="poster">${xml(a.poster)}</thumb>\n` : ""}${a.backdrop ? `  <fanart><thumb>${xml(a.backdrop)}</thumb></fanart>\n` : ""}</movie>\n`);
  } else {
    fs.writeFileSync(path.join(dir, base + ".nfo"), `<?xml version="1.0" encoding="UTF-8"?>\n<episodedetails>\n  <title>${xml(a.title)}</title>\n  <season>${a.season ?? findSeason(series, a.id) ?? 1}</season>\n  <episode>${a.episode ?? findEpisode(series, a.id) ?? 1}</episode>\n  <plot>${xml(a.overview)}</plot>\n${a.thumb ? `  <thumb>${xml(a.thumb)}</thumb>\n` : ""}</episodedetails>\n`);
  }
  // the library looks at that folder again, so it shows up
  const f = folderFor(a.kind === "film" ? "films" : "series");
  if (f) void lib.scan([f.id]);
  return file;
}

function findSeason(series: browse.AItem | null | undefined, id: string): number | null {
  for (const s of series?.seasons ?? []) if (s.episodes.some((e) => e.id === id)) return s.n;
  return null;
}

function findEpisode(series: browse.AItem | null | undefined, id: string): number | null {
  for (const s of series?.seasons ?? []) {
    const e = s.episodes.find((x) => x.id === id);
    if (e) return e.episode ?? s.episodes.indexOf(e) + 1;
  }
  return null;
}

setTimeout(() => pump(), 5000).unref();
