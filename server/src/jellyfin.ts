// Korie speaking Jellyfin: the part of Jellyfin's API that Jellyfin's own apps use (the Android TV
// app first, and the web client), answered from Korie's library. With it, every Jellyfin app works
// with a Korie server: their remote control, scrolling and screen sizes are theirs, already proven,
// and the library is Korie's (fast to add: names from the files first, details afterwards; files are
// only looked into when one is played).
//
// Shapes follow Jellyfin 12's answers field for field (PascalCase, ids as 32 hex digits). Korie's ids
// are mapped to Jellyfin-style ids (an MD5 of the Korie id) and remembered, so they can be looked up
// again.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { VERSION, log } from "./config.ts";
import { db, json, now, setting } from "./db.ts";
import * as people from "./people.ts";
import * as lib from "./library.ts";
import * as views from "./views.ts";
import * as playback from "./playback.ts";
import { picture } from "./images.ts";
import { serverId } from "./ident.ts";
import EMPTY from "./jellyfin-empty.json" with { type: "json" };
import websocket from "@fastify/websocket";

type Req = FastifyRequest<{ Querystring: Record<string, string>; Params: Record<string, string>; Body: any }>;
type P = people.Person;

const TICKS = 10_000_000;

// --- ids --------------------------------------------------------------------------------------

db.exec("CREATE TABLE IF NOT EXISTS jf_ids(jid TEXT PRIMARY KEY, kid TEXT NOT NULL)");
const putId = db.prepare("INSERT OR IGNORE INTO jf_ids(jid, kid) VALUES(?, ?)");
const getId = db.prepare("SELECT kid FROM jf_ids WHERE jid = ?");
const known = new Map<string, string>();

/** The Jellyfin id of a Korie id ("view:films", "season:<series>:<n>", a library item id ...). */
export function jid(kid: string): string {
  const j = crypto.createHash("md5").update("korie:" + kid).digest("hex");
  if (!known.has(j)) {
    known.set(j, kid);
    putId.run(j, kid);
  }
  return j;
}

/** The Korie id behind a Jellyfin id (with or without dashes); null when it isn't one of ours. */
export function kid(j: string | undefined | null): string | null {
  if (!j) return null;
  const k = j.replace(/-/g, "").toLowerCase();
  if (known.has(k)) return known.get(k)!;
  const r = getId.get(k) as { kid: string } | undefined;
  if (r) known.set(k, r.kid);
  return r?.kid ?? null;
}

const SID = () => crypto.createHash("md5").update("korie-server:" + serverId()).digest("hex");
/** The server's id as Jellyfin's apps know it. */
export const jellyfinServerId = SID;
const tag = (s: string) => crypto.createHash("md5").update(s).digest("hex");
const iso = (secs: number) => new Date(secs * 1000).toISOString().replace(/\.(\d{3})Z$/, ".$10000Z");
const dashed = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

// --- signing in ---------------------------------------------------------------------------------

/** The parts of a "MediaBrowser Client=..., Token=..." header. */
function authParts(req: FastifyRequest): Record<string, string> {
  const h = String(req.headers["authorization"] ?? req.headers["x-emby-authorization"] ?? "");
  const out: Record<string, string> = {};
  for (const m of h.matchAll(/(\w+)="([^"]*)"/g)) out[m[1].toLowerCase()] = decodeURIComponent(m[2]);
  return out;
}

function tokenOf(req: FastifyRequest): string {
  const q = lower(req.query as Record<string, string>);
  return authParts(req).token || String(req.headers["x-emby-token"] ?? req.headers["x-mediabrowser-token"] ?? "") || q.api_key || q.apikey || "";
}

class JfError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

function who(req: FastifyRequest): P {
  const p = people.fromToken(tokenOf(req));
  if (!p) throw new JfError(401, "Unauthorized");
  return p;
}

function userJson(p: P): Record<string, unknown> {
  return {
    Name: p.name, ServerId: SID(), Id: jid("person:" + p.id), HasPassword: p.hasPin, HasConfiguredPassword: p.hasPin,
    HasConfiguredEasyPassword: false, EnableAutoLogin: false, LastLoginDate: iso(now()), LastActivityDate: iso(now()),
    Configuration: {
      AudioLanguagePreference: p.audio || undefined, PlayDefaultAudioTrack: true, SubtitleLanguagePreference: p.subs && p.subs !== "off" ? p.subs : "",
      DisplayMissingEpisodes: false, GroupedFolders: [], SubtitleMode: p.subs === "off" ? "None" : "Default", DisplayCollectionsView: false,
      EnableLocalPassword: false, OrderedViews: [], LatestItemsExcludes: [], MyMediaExcludes: [], HidePlayedInLatest: true,
      RememberAudioSelections: true, RememberSubtitleSelections: true, EnableNextEpisodeAutoPlay: true, CastReceiverId: "F007D354",
    },
    Policy: {
      IsAdministrator: p.admin, IsHidden: false, EnableCollectionManagement: false, EnableSubtitleManagement: false, EnableLyricManagement: false,
      IsDisabled: false, MaxParentalRating: p.maxAge ?? undefined, BlockedTags: [], AllowedTags: [], EnableUserPreferenceAccess: true, AccessSchedules: [],
      BlockUnratedItems: [], EnableRemoteControlOfOtherUsers: false, EnableSharedDeviceControl: false, EnableRemoteAccess: true,
      EnableLiveTvManagement: false, EnableLiveTvAccess: true, EnableMediaPlayback: true, EnableAudioPlaybackTranscoding: true,
      EnableVideoPlaybackTranscoding: true, EnablePlaybackRemuxing: true, ForceRemoteSourceTranscoding: false, EnableContentDeletion: false,
      EnableContentDeletionFromFolders: [], EnableContentDownloading: true, EnableSyncTranscoding: false, EnableMediaConversion: false,
      EnabledDevices: [], EnableAllDevices: true, EnabledChannels: [], EnableAllChannels: true, EnabledFolders: [], EnableAllFolders: true,
      InvalidLoginAttemptCount: 0, LoginAttemptsBeforeLockout: -1, MaxActiveSessions: 0, EnablePublicSharing: false, BlockedMediaFolders: [],
      BlockedChannels: [], RemoteClientBitrateLimit: 0, AuthenticationProviderId: "Korie", PasswordResetProviderId: "Korie", SyncPlayAccess: "None",
    },
  };
}

function personByJid(j: string): P | null {
  const k = kid(j);
  return k?.startsWith("person:") ? people.get(k.slice(7)) : null;
}

// --- items --------------------------------------------------------------------------------------

/** What a Jellyfin item is, on the Korie side. */
type Thing =
  | { t: "view"; kind: "films" | "series" }
  | { t: "row"; row: lib.Row }
  | { t: "season"; series: lib.Row; n: number };

function thing(j: string | undefined | null): Thing | null {
  const k = kid(j);
  if (!k) return null;
  if (k === "view:films" || k === "view:series") return { t: "view", kind: k.slice(5) as "films" | "series" };
  if (k.startsWith("season:")) {
    const m = k.match(/^season:(.+):(\d+)$/);
    const s = m ? lib.getRow(m[1]) : null;
    return s ? { t: "season", series: s, n: Number(m![2]) } : null;
  }
  const row = lib.getRow(k);
  return row && !lib.isHidden(row) ? { t: "row", row } : null;
}

/** The raw picture sources (a web address or "file:" + path), as library.pictures picks them. */
function sources(r: lib.Row): { poster: string; backdrop: string; thumb: string } {
  const p = lib.pictures(r);
  const raw = (u: string) => (u ? decodeURIComponent(u.split("?u=")[1] ?? "") : "");
  return { poster: raw(p.poster), backdrop: raw(p.backdrop), thumb: raw(p.thumb) };
}

function seasonPoster(series: lib.Row, n: number): string {
  const info = lib.data(series).seasonInfo?.[n];
  return info?.poster || sources(series).poster;
}

function seasonsOf(series: lib.Row): number[] {
  return [...new Set(lib.rows("episode", series.id).map((e) => Number(lib.data(e).season) || 0))].sort((a, b) => (a || 1e9) - (b || 1e9));
}

function seasonName(n: number): string {
  return n === 0 ? "Specials" : `Season ${n}`;
}

const VIDEO_EXT: Record<string, string> = { ".mkv": "mkv", ".mp4": "mp4", ".m4v": "mp4", ".avi": "avi", ".webm": "webm", ".ts": "ts", ".m2ts": "ts", ".mov": "mov", ".wmv": "asf", ".iso": "iso" };

function userData(p: P, k: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const pr = views.progressOf(p.id, k);
  return {
    PlaybackPositionTicks: pr && !pr.watched ? Math.round(pr.position * TICKS) : 0, PlayCount: pr?.watched ? 1 : 0,
    IsFavorite: views.isFavourite(p, k), Played: !!pr?.watched, Key: k, ItemId: jid(k),
    ...(pr && !pr.watched && pr.duration > 0 && pr.position > 0 ? { PlayedPercentage: (100 * pr.position) / pr.duration } : {}),
    ...(pr?.updated ? { LastPlayedDate: iso(pr.updated) } : {}),
    ...extra,
  };
}

/** Runtime in seconds: what playing it found, or TMDb's minutes. */
function runtimeOf(r: lib.Row): number {
  const d = lib.data(r);
  return Number(d.duration) || (Number(d.runtime) || 0) * 60;
}

const durations = db.prepare("UPDATE items SET data = json_set(data, '$.duration', ?) WHERE id = ?");

function images(base: Record<string, unknown>, poster: string, backdrop: string, aspect: number): void {
  base.ImageTags = poster ? { Primary: tag(poster) } : {};
  base.BackdropImageTags = backdrop ? [tag(backdrop)] : [];
  if (poster) base.PrimaryImageAspectRatio = aspect;
}

function common(name: string, k: string, type: string): Record<string, unknown> {
  return { Name: name, ServerId: SID(), Id: jid(k), Type: type, LocationType: "FileSystem", ChannelId: null };
}

export function dto(p: P, th: Thing): Record<string, unknown> {
  if (th.t === "view") {
    const k = "view:" + th.kind;
    const o = common(th.kind === "films" ? "Films" : "Series", k, "CollectionFolder");
    Object.assign(o, {
      CollectionType: th.kind === "films" ? "movies" : "tvshows", IsFolder: true, SortName: th.kind, MediaType: "Unknown",
      ChildCount: lib.rows(th.kind === "films" ? "film" : "series").filter((r) => views.may(p, r)).length,
      DisplayPreferencesId: jid(k), UserData: userData(p, k), ImageTags: {}, BackdropImageTags: [], PlayAccess: "Full",
    });
    return o;
  }
  if (th.t === "season") {
    const { series, n } = th;
    const k = `season:${series.id}:${n}`;
    const eps = lib.rows("episode", series.id).filter((e) => (Number(lib.data(e).season) || 0) === n);
    const unplayed = eps.filter((e) => !views.progressOf(p.id, e.id)?.watched).length;
    const o = common(seasonName(n), k, "Season");
    const sp = sources(series);
    const poster = seasonPoster(series, n);
    Object.assign(o, {
      IndexNumber: n, IsFolder: true, MediaType: "Unknown", SeriesName: series.title, SeriesId: jid(series.id), ParentId: jid(series.id),
      SeriesPrimaryImageTag: sp.poster ? tag(sp.poster) : undefined, ChildCount: eps.length, SortName: String(n).padStart(4, "0"),
      ParentBackdropItemId: sp.backdrop ? jid(series.id) : undefined, ParentBackdropImageTags: sp.backdrop ? [tag(sp.backdrop)] : undefined,
      UserData: userData(p, k, { UnplayedItemCount: unplayed, Played: unplayed === 0 && eps.length > 0, PlayedPercentage: eps.length ? (100 * (eps.length - unplayed)) / eps.length : 0 }),
      PlayAccess: "Full",
    });
    images(o, poster, "", 2 / 3);
    return o;
  }
  const r = th.row;
  const d = lib.data(r);
  const pics = sources(r);
  const type = r.kind === "film" ? "Movie" : r.kind === "series" ? "Series" : r.kind === "episode" ? "Episode" : r.kind === "album" ? "MusicAlbum" : "Audio";
  const o = common(r.title || (r.kind === "episode" ? `Episode ${d.episode}` : "Untitled"), r.id, type);
  const runtime = runtimeOf(r);
  const genres: string[] = Array.isArray(d.genres) ? d.genres : [];
  Object.assign(o, {
    SortName: r.sort, DateCreated: iso(r.added), CanDelete: false, CanDownload: r.kind !== "series", PlayAccess: "Full",
    Overview: d.overview || undefined, Genres: genres, GenreItems: genres.map((g) => ({ Name: g, Id: jid("genre:" + g.toLowerCase()) })),
    CommunityRating: d.rating ? Number(Number(d.rating).toFixed(1)) : undefined, OfficialRating: d.cert || undefined,
    ProductionYear: r.year ? Number(r.year) : undefined, PremiereDate: r.year ? `${r.year}-01-01T00:00:00.0000000Z` : undefined,
    RunTimeTicks: runtime ? Math.round(runtime * TICKS) : undefined, ProviderIds: d.tmdb ? { Tmdb: String(d.tmdb) } : {},
    Taglines: [], Tags: [], Studios: [], People: [], RemoteTrailers: [], LocalTrailerCount: 0, SpecialFeatureCount: 0,
    DisplayPreferencesId: jid(r.id), EnableMediaSourceDisplay: true,
  });
  if (r.kind === "film") {
    Object.assign(o, { IsFolder: false, MediaType: "Video", VideoType: "VideoFile", ParentId: jid("view:films"), Container: VIDEO_EXT[path.extname(r.file ?? "").toLowerCase()], UserData: userData(p, r.id) });
    images(o, pics.poster, pics.backdrop, 2 / 3);
  } else if (r.kind === "series") {
    const eps = lib.rows("episode", r.id);
    const unplayed = eps.filter((e) => !views.progressOf(p.id, e.id)?.watched).length;
    Object.assign(o, {
      IsFolder: true, MediaType: "Unknown", ParentId: jid("view:series"), ChildCount: seasonsOf(r).length, RecursiveItemCount: eps.length, Status: "Continuing",
      UserData: userData(p, r.id, { UnplayedItemCount: unplayed, Played: unplayed === 0 && eps.length > 0, PlayedPercentage: eps.length ? (100 * (eps.length - unplayed)) / eps.length : 0 }),
    });
    images(o, pics.poster, pics.backdrop, 2 / 3);
  } else if (r.kind === "episode") {
    const s = lib.getRow(r.parent ?? "");
    const n = Number(d.season) || 0;
    const sp = s ? sources(s) : { poster: "", backdrop: "", thumb: "" };
    Object.assign(o, {
      IsFolder: false, MediaType: "Video", VideoType: "VideoFile", IndexNumber: Number(d.episode) || undefined, IndexNumberEnd: d.episodeEnd || undefined,
      ParentIndexNumber: n, SeriesName: s?.title, SeriesId: s ? jid(s.id) : undefined, SeasonId: s ? jid(`season:${s.id}:${n}`) : undefined,
      SeasonName: seasonName(n), ParentId: s ? jid(`season:${s.id}:${n}`) : undefined, SeriesPrimaryImageTag: sp.poster ? tag(sp.poster) : undefined,
      ParentBackdropItemId: sp.backdrop && s ? jid(s.id) : undefined, ParentBackdropImageTags: sp.backdrop ? [tag(sp.backdrop)] : undefined,
      PremiereDate: d.aired ? `${d.aired}T00:00:00.0000000Z` : undefined, ProductionYear: d.aired ? Number(String(d.aired).slice(0, 4)) : undefined,
      Container: VIDEO_EXT[path.extname(r.file ?? "").toLowerCase()], UserData: userData(p, r.id),
    });
    // an episode's own picture is its still; without one, the series' backdrop stands in
    const thumb = d.still || d.localThumb || d.nfoThumb ? pics.thumb : "";
    images(o, thumb, "", 16 / 9);
  }
  return o;
}

// --- listing -------------------------------------------------------------------------------------

/** Query parameters with lower-case names (the web app sends ParentId, the Android SDK parentId). */
function lower(q: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q ?? {})) out[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v);
  return out;
}

const list = (s: string | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

/** Everything below a parent (or the whole library), as Things this person may see. */
function children(p: P, parent: Thing | null, recursive: boolean, types: string[]): Thing[] {
  const want = (t: string) => !types.length || types.some((x) => x.toLowerCase() === t.toLowerCase());
  const rowThing = (r: lib.Row): Thing => ({ t: "row", row: r });
  const ok = (r: lib.Row) => views.may(p, r);
  const out: Thing[] = [];
  const addSeries = (s: lib.Row, deep: boolean) => {
    if (want("Series")) out.push(rowThing(s));
    if (!deep) return;
    for (const n of seasonsOf(s)) if (want("Season")) out.push({ t: "season", series: s, n });
    if (want("Episode")) for (const e of lib.rows("episode", s.id)) out.push(rowThing(e));
  };
  if (!parent) {
    if (want("Movie")) out.push(...lib.rows("film").filter(ok).map(rowThing));
    for (const s of lib.rows("series").filter(ok)) addSeries(s, recursive);
    return out;
  }
  if (parent.t === "view") {
    if (parent.kind === "films") return want("Movie") ? lib.rows("film").filter(ok).map(rowThing) : [];
    for (const s of lib.rows("series").filter(ok)) addSeries(s, recursive);
    return out;
  }
  if (parent.t === "season") {
    if (!ok(parent.series)) return [];
    return lib.rows("episode", parent.series.id).filter((e) => (Number(lib.data(e).season) || 0) === parent.n).map(rowThing).filter((t) => want("Episode"));
  }
  if (parent.row.kind === "series") {
    if (!ok(parent.row)) return [];
    if (recursive) {
      for (const n of seasonsOf(parent.row)) if (want("Season")) out.push({ t: "season", series: parent.row, n });
      if (want("Episode")) out.push(...lib.rows("episode", parent.row.id).map(rowThing));
      return out;
    }
    return seasonsOf(parent.row).map((n) => ({ t: "season", series: parent.row, n }) as Thing).filter(() => want("Season"));
  }
  return [];
}

function keyOf(th: Thing): string {
  return th.t === "view" ? "view:" + th.kind : th.t === "season" ? `season:${th.series.id}:${th.n}` : th.row.id;
}

function filterSort(p: P, items: Thing[], q: Record<string, string>): Thing[] {
  let out = items;
  const filters = list(q.filters).map((f) => f.toLowerCase());
  const prog = (th: Thing) => views.progressOf(p.id, keyOf(th));
  if (filters.includes("isfavorite") || q.isfavorite === "true") out = out.filter((t) => views.isFavourite(p, keyOf(t)));
  if (filters.includes("isresumable")) out = out.filter((t) => { const x = prog(t); return !!x && !x.watched && x.position > 0; });
  if (filters.includes("isplayed") || q.isplayed === "true") out = out.filter((t) => !!prog(t)?.watched);
  if (filters.includes("isunplayed") || q.isplayed === "false") out = out.filter((t) => !prog(t)?.watched);
  if (q.searchterm) {
    const s = q.searchterm.toLowerCase();
    out = out.filter((t) => t.t === "row" && t.row.title.toLowerCase().includes(s));
  }
  if (q.namestartswith) out = out.filter((t) => t.t === "row" && t.row.sort.startsWith(q.namestartswith.toLowerCase()));
  if (q.namelessthan) out = out.filter((t) => t.t === "row" && t.row.sort < q.namelessthan.toLowerCase());
  const genres = list(q.genres).map((g) => g.toLowerCase());
  const genreIds = list(q.genreids).map((g) => kid(g)?.replace(/^genre:/, "")).filter(Boolean);
  const wantGenres = [...genres, ...genreIds];
  if (wantGenres.length) out = out.filter((t) => t.t === "row" && (lib.data(t.row).genres ?? []).some((g: string) => wantGenres.includes(g.toLowerCase())));
  const years = list(q.years);
  if (years.length) out = out.filter((t) => t.t === "row" && years.includes(t.row.year));
  const sortBy = list(q.sortby).map((s) => s.toLowerCase());
  const desc = list(q.sortorder)[0]?.toLowerCase() === "descending";
  const val = (t: Thing, s: string): number | string => {
    if (t.t !== "row") return t.t === "season" ? t.n : 0;
    const r = t.row;
    switch (s) {
      case "datecreated": return r.added;
      case "premieredate": case "productionyear": return Number(r.year) || 0;
      case "communityrating": return Number(lib.data(r).rating) || 0;
      case "runtime": return runtimeOf(r);
      case "dateplayed": case "datelastcontentadded": return views.progressOf(p.id, r.id)?.updated ?? 0;
      case "random": return Math.random();
      case "parentindexnumber": return Number(lib.data(r).season) || 0;
      case "indexnumber": return Number(lib.data(r).episode) || 0;
      default: return r.kind === "episode" ? r.sort : r.sort;
    }
  };
  if (sortBy.length) {
    out = [...out].sort((a, b) => {
      for (const s of sortBy) {
        const x = val(a, s), y = val(b, s);
        if (x < y) return desc ? 1 : -1;
        if (x > y) return desc ? -1 : 1;
      }
      return 0;
    });
  }
  return out;
}

function page(p: P, items: Thing[], q: Record<string, string>): Record<string, unknown> {
  const start = Math.max(0, Number(q.startindex) || 0);
  const limit = q.limit ? Math.max(0, Number(q.limit)) : items.length;
  return { Items: items.slice(start, start + limit).map((t) => dto(p, t)), TotalRecordCount: items.length, StartIndex: start };
}

function resumable(p: P, q: Record<string, string>): Thing[] {
  const rows = db.prepare(`SELECT item FROM progress WHERE person = ? AND watched = 0 AND position > 0 ORDER BY updated DESC LIMIT 100`).all(p.id) as { item: string }[];
  const types = list(q.includeitemtypes).map((t) => t.toLowerCase());
  return rows.map((r) => lib.getRow(r.item)).filter((r): r is lib.Row => !!r && !lib.isHidden(r) && (r.kind === "film" || r.kind === "episode") && views.may(p, r))
    .filter((r) => !types.length || types.includes(r.kind === "film" ? "movie" : "episode"))
    .map((r) => ({ t: "row", row: r }));
}

function nextUp(p: P, seriesId: string | null): Thing[] {
  const series = seriesId ? [seriesId] : (db.prepare(`SELECT i.parent AS s, MAX(p.updated) AS at FROM progress p JOIN items i ON i.id = p.item
    WHERE p.person = ? AND i.kind = 'episode' AND p.watched = 1 GROUP BY i.parent ORDER BY at DESC LIMIT 24`).all(p.id) as { s: string }[]).map((x) => x.s);
  const out: Thing[] = [];
  for (const s of series) {
    const sr = lib.getRow(s);
    if (!sr || lib.isHidden(sr) || !views.may(p, sr)) continue;
    const eps = lib.rows("episode", s);
    const last = eps.map((e, i) => (views.progressOf(p.id, e.id)?.watched ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const next = eps[last + 1];
    if (next && (seriesId || last >= 0)) out.push({ t: "row", row: next });
  }
  return out;
}

// --- playing -------------------------------------------------------------------------------------

/** ffprobe's format name as Jellyfin's container name. */
function containerName(fmt: string, file: string): string {
  const ext = VIDEO_EXT[path.extname(file).toLowerCase()];
  if (/matroska/.test(fmt)) return ext === "webm" ? "webm" : "mkv";
  if (/mp4|mov/.test(fmt)) return ext === "mov" ? "mov" : "mp4";
  if (fmt === "mpegts") return "ts";
  return ext ?? fmt.split(",")[0];
}

interface Profile { DirectPlayProfiles?: any[]; TranscodingProfiles?: any[]; SubtitleProfiles?: any[] }

function inList(v: string, csv: string | undefined): boolean {
  const l = list(csv).map((x) => x.toLowerCase());
  return !l.length || l.includes(v.toLowerCase()) || (v === "mkv" && l.includes("matroska"));
}

/** Whether the client says it plays this file as it is. */
function directPlayable(pr: Profile | undefined, container: string, vcodec: string, acodec: string): boolean {
  if (!pr?.DirectPlayProfiles) return true; // no profile sent: Jellyfin's apps then play the file itself
  return pr.DirectPlayProfiles.some((d) => (d.Type ?? d.type) === "Video" && inList(container, d.Container ?? d.container) &&
    (!vcodec || inList(vcodec, d.VideoCodec ?? d.videoCodec)) && (!acodec || inList(acodec, d.AudioCodec ?? d.audioCodec)));
}

const FILE_TYPES: Record<string, string> = { ".mkv": "video/x-matroska", ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".avi": "video/x-msvideo", ".ts": "video/mp2t", ".m2ts": "video/mp2t", ".mov": "video/quicktime" };
const TEXT_SUBS = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);
const SUB_FORMAT: Record<string, string> = { subrip: "srt", mov_text: "mov_text", webvtt: "vtt", hdmv_pgs_subtitle: "PGSSUB", dvd_subtitle: "DVDSUB", dvb_subtitle: "DVBSUB" };

function subDelivery(pr: Profile | undefined, fmt: string, direct: boolean): string {
  const subs = pr?.SubtitleProfiles ?? [];
  const has = (method: string) => subs.some((s: any) => (s.Method ?? s.method) === method && String(s.Format ?? s.format).toLowerCase() === fmt.toLowerCase());
  if (direct && has("Embed")) return "Embed";
  // Korie turns any text subtitles into WebVTT, so a client that takes WebVTT files gets them that way
  if (has("External") || subs.some((s: any) => (s.Method ?? s.method) === "External" && /^(vtt|webvtt)$/i.test(String(s.Format ?? s.format)))) return "External";
  if (direct) return "Embed";
  return "External";
}

export async function mediaSource(p: P, r: lib.Row, body: Record<string, any>, host: string): Promise<Record<string, unknown>> {
  const d = lib.data(r);
  const src: playback.Source = { file: r.file!, disc: d.disc ?? null, ...(Array.isArray(d.parts) && d.parts.length > 1 ? { parts: d.parts } : {}) };
  const probe = await playback.probe(src);
  if (probe.duration && Math.abs(probe.duration - (Number(d.duration) || 0)) > 1) durations.run(probe.duration, r.id);
  const container = containerName(probe.container, r.file!);
  const video = probe.streams.find((s) => s.type === "video");
  const audios = probe.streams.filter((s) => s.type === "audio");
  const prefAudio = audios.find((a) => p.audio && playback.sameLang(a.lang, p.audio)) ?? audios.find((a) => a.isDefault) ?? audios[0];
  const audioIndex = body.AudioStreamIndex != null ? Number(body.AudioStreamIndex) : prefAudio?.index;
  const audio = audios.find((a) => a.index === audioIndex) ?? prefAudio;
  const profile: Profile | undefined = body.DeviceProfile;
  const direct = !src.disc && !src.parts && body.EnableDirectPlay !== false && directPlayable(profile, container, video?.codec ?? "", audio?.codec ?? "");
  const id = jid(r.id);
  let size = 0;
  try {
    size = fs.statSync(r.file!).size;
  } catch { /* a folder (DVD) */ }
  const token = tokenOf;
  void token;
  const subFiles: string[] = d.subs ?? [];
  const streams: Record<string, unknown>[] = probe.streams.map((s) => {
    const base: Record<string, unknown> = {
      Index: s.index, Codec: s.codec, Language: s.lang || undefined, Title: s.title || undefined, IsDefault: s.isDefault, IsForced: s.forced,
      IsHearingImpaired: false, IsInterlaced: false, IsExternal: false, IsAVC: s.codec === "h264", Level: 0, IsAnamorphic: false,
      Type: s.type === "video" ? "Video" : s.type === "audio" ? "Audio" : "Subtitle", SupportsExternalStream: false, VideoRange: "Unknown",
      VideoRangeType: "Unknown", AudioSpatialFormat: "None", IsTextSubtitleStream: s.type === "subtitle" && TEXT_SUBS.has(s.codec),
    };
    if (s.type === "video") Object.assign(base, { Width: s.width, Height: s.height, AspectRatio: s.width && s.height ? `${s.width}:${s.height}` : undefined, VideoRange: "SDR", VideoRangeType: "SDR", DisplayTitle: `${s.height >= 2000 ? "4K" : s.height >= 1000 ? "1080p" : s.height >= 700 ? "720p" : s.height + "p"} ${s.codec.toUpperCase()}`, RealFrameRate: 24 });
    if (s.type === "audio") Object.assign(base, { Channels: s.channels, ChannelLayout: s.channels >= 6 ? "5.1" : s.channels === 2 ? "stereo" : undefined, DisplayTitle: [playback.langName(s.lang) || "Unknown", s.codec.toUpperCase(), s.channels >= 6 ? "5.1" : s.channels === 2 ? "Stereo" : ""].filter(Boolean).join(" - "), IsDefault: s.index === audio?.index });
    if (s.type === "subtitle") {
      const fmt = SUB_FORMAT[s.codec] ?? s.codec;
      const text = TEXT_SUBS.has(s.codec);
      const method = text ? subDelivery(profile, fmt, direct) : direct ? "Embed" : "Encode";
      Object.assign(base, {
        DisplayTitle: [playback.langName(s.lang) || "Unknown", s.title, fmt.toUpperCase()].filter(Boolean).join(" - "), SupportsExternalStream: text,
        DeliveryMethod: method, ...(method === "External" ? { DeliveryUrl: `/Videos/${id}/${id}/Subtitles/${s.index}/0/Stream.vtt`, IsExternalUrl: false } : {}),
      });
    }
    return base;
  });
  // subtitle files next to the video: numbered after the file's own streams
  subFiles.forEach((f, i) => {
    const index = probe.streams.length + i;
    const lang = path.basename(f).split(".").slice(-2, -1)[0] ?? "";
    streams.push({
      Index: index, Codec: path.extname(f).slice(1).toLowerCase(), Language: lang.length <= 3 ? lang : undefined, DisplayTitle: [playback.langName(lang) || path.basename(f), "External"].join(" - "),
      IsDefault: false, IsForced: false, IsHearingImpaired: false, IsInterlaced: false, IsExternal: true, Type: "Subtitle", IsTextSubtitleStream: true,
      SupportsExternalStream: true, DeliveryMethod: "External", DeliveryUrl: `/Videos/${id}/${id}/Subtitles/${index}/0/Stream.vtt`, IsExternalUrl: false, Path: f,
      VideoRange: "Unknown", VideoRangeType: "Unknown", AudioSpatialFormat: "None", IsAVC: false, Level: 0, IsAnamorphic: false,
    });
  });
  const firstSub = streams.find((s) => s.Type === "Subtitle" && s.IsDefault);
  const ms: Record<string, unknown> = {
    Protocol: "File", Id: id, Path: r.file, Type: "Default", Container: container, Size: size || undefined, Name: path.parse(r.file!).name, IsRemote: false,
    ETag: tag(r.file + ":" + size), RunTimeTicks: probe.duration ? Math.round(probe.duration * TICKS) : undefined, ReadAtNativeFramerate: false,
    IgnoreDts: false, IgnoreIndex: false, GenPtsInput: false, SupportsTranscoding: true, SupportsDirectStream: direct, SupportsDirectPlay: direct,
    IsInfiniteStream: false, UseMostCompatibleTranscodingProfile: false, RequiresOpening: false, RequiresClosing: false, RequiresLooping: false,
    SupportsProbing: true, VideoType: "VideoFile", MediaStreams: streams, MediaAttachments: [], Formats: [], RequiredHttpHeaders: {},
    TranscodingSubProtocol: "http", HasSegments: !!d.intro, DefaultAudioStreamIndex: audio?.index,
    DefaultSubtitleStreamIndex: firstSub ? firstSub.Index : -1, Bitrate: probe.duration && size ? Math.round((size * 8) / probe.duration) : undefined,
  };
  if (!direct) {
    // converted as it plays (fragmented MP4, from the start time the client asks for); the picture is
    // copied when the client plays its codec
    const vOk = profile?.TranscodingProfiles?.some((t: any) => inList(video?.codec ?? "", t.VideoCodec ?? t.videoCodec)) ?? video?.codec === "h264";
    const start = Number(body.StartTimeTicks ?? 0) / TICKS || 0;
    const q = new URLSearchParams({ v: vOk && video?.codec === "h264" ? "copy" : "x264", ...(audio ? { audio: String(audio.index) } : {}) });
    const tok = playback.token(src);
    ms.TranscodingUrl = `/Videos/${id}/stream.mp4?k=${encodeURIComponent(tok)}&start=${start}&${q}`;
    ms.TranscodingContainer = "mp4";
  }
  void host;
  return ms;
}

function vttTime(t: string): number {
  const p = t.trim().split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

/** WebVTT as Jellyfin's subtitle events. */
function vttEvents(vtt: string): { Id: string; StartPositionTicks: number; EndPositionTicks: number; Text: string }[] {
  const out: { Id: string; StartPositionTicks: number; EndPositionTicks: number; Text: string }[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    out.push({ Id: String(out.length + 1), StartPositionTicks: Math.round(vttTime(a) * TICKS), EndPositionTicks: Math.round(vttTime(b.trim().split(" ")[0]) * TICKS), Text: lines.slice(i + 1).join("\n") });
  }
  return out;
}

/** How long each played thing is (from PlaybackInfo), for progress reports that don't say. */
const lengths = new Map<string, number>();

// --- routes --------------------------------------------------------------------------------------

/** Jellyfin's addresses are case-insensitive (its web app asks for /users/public): the words of
 *  every Jellyfin route, by their lower-case form, to put a request's words back in their case. */
const WORDS = new Map<string, string>();
const TOP = new Set<string>();

function learn(url: string): void {
  const parts = url.split("/").filter(Boolean);
  parts.forEach((w, i) => {
    if (w.startsWith(":") || w.includes(":") || w === "*") return;
    WORDS.set(w.toLowerCase(), w);
    if (i === 0) TOP.add(w.toLowerCase());
  });
}

/** A request address with Jellyfin's words in their own case (for Fastify's rewriteUrl). */
export function rewrite(url: string): string {
  const q = url.indexOf("?");
  const p = q < 0 ? url : url.slice(0, q);
  const parts = p.split("/");
  if (parts.length < 2 || !TOP.has((parts[1] ?? "").toLowerCase())) return url;
  const fixed = parts.map((w) => WORDS.get(w.toLowerCase()) ?? w).join("/");
  return q < 0 ? fixed : fixed + url.slice(q);
}

export async function register(app: FastifyInstance, webDir: string | null): Promise<void> {
  // Jellyfin's apps keep a socket open to the server (and keep trying until they get one)
  await app.register(websocket);
  app.get("/socket", { websocket: true }, (sock, req) => {
    if (!people.fromToken(tokenOf(req))) {
      sock.close(4401, "Unauthorized");
      return;
    }
    sock.send(JSON.stringify({ MessageType: "ForceKeepAlive", Data: 60, MessageId: crypto.randomUUID().replace(/-/g, "") }));
    sock.on("message", (m: Buffer) => {
      try {
        if (JSON.parse(m.toString()).MessageType === "KeepAlive") sock.send(JSON.stringify({ MessageType: "KeepAlive", MessageId: crypto.randomUUID().replace(/-/g, "") }));
      } catch { /* not JSON */ }
    });
  });
  learn("/socket");

  const send = (reply: FastifyReply, code: number) => reply.code(code).send();

  app.addHook("onRequest", async (req, reply) => {
    // Jellyfin's apps send JSON with Accept: application/json; answer in its casing either way
    reply.header("Access-Control-Allow-Origin", "*");
    void req;
  });

  const r = (method: "GET" | "POST" | "DELETE", urls: string[], fn: (req: Req, reply: FastifyReply) => unknown) => {
    for (const url of urls) {
      learn(url);
      app.route({
        method, url, handler: async (req, reply) => {
          try {
            const out = await fn(req as Req, reply);
            if (reply.sent) return;
            if (out === undefined) return send(reply, 204);
            return reply.header("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(out));
          } catch (e: any) {
            const code = e instanceof JfError ? e.code : 500;
            if (code >= 500) log("jellyfin", `${req.method} ${req.url}: ${e?.stack ?? e}`);
            return reply.code(code).send(e?.message ?? "Error");
          }
        },
      });
    }
  };
  const qs = (req: Req) => lower(req.query);
  const bodyOf = (req: Req): Record<string, any> => {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    // the Android SDK sends camelCase field names: accept both
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(b)) out[k.charAt(0).toUpperCase() + k.slice(1)] = v;
    return out;
  };
  const host = (req: FastifyRequest) => String(req.headers.host ?? "");

  // --- server ---
  const publicInfo = (req: FastifyRequest) => ({
    LocalAddress: `http://${host(req)}`, ServerName: setting<string>("server_name") || "Korie", Version: "12.4.0", ProductName: "Jellyfin Server",
    OperatingSystem: "", Id: SID(), StartupWizardCompleted: true,
  });
  r("GET", ["/System/Info/Public"], (req) => publicInfo(req));
  r("GET", ["/System/Info"], (req) => {
    who(req);
    return { ...publicInfo(req), OperatingSystemDisplayName: "", HasPendingRestart: false, IsShuttingDown: false, SupportsLibraryMonitor: false, WebSocketPortNumber: 8100,
      CompletedInstallations: [], CanSelfRestart: false, CanLaunchWebBrowser: false, CastReceiverApplications: [], HasUpdateAvailable: false, EncoderLocation: "System",
      SystemArchitecture: "X64", KorieVersion: VERSION };
  });
  r("GET", ["/System/Ping"], () => "Jellyfin Server");
  r("POST", ["/System/Ping"], () => "Jellyfin Server");
  r("GET", ["/System/Endpoint"], () => ({ IsLocal: true, IsInNetwork: true }));
  r("GET", ["/Branding/Configuration"], () => ({ LoginDisclaimer: "", CustomCss: "", SplashscreenEnabled: false }));
  for (const u of ["/Branding/Css", "/Branding/Css.css", "/Playback/BitrateTest", "/Users/:userId/Images/:type", "/UserImage", "/Items/:itemId/Images/:imageType", "/Videos/:itemId/stream", "/Videos/:itemId/:msId/Subtitles/:index/:start/Stream.:fmt", "/Items/:itemId/Download"]) learn(u);
  app.get("/Branding/Css", async (_req, reply) => reply.header("Content-Type", "text/css").send(""));
  app.get("/Branding/Css.css", async (_req, reply) => reply.header("Content-Type", "text/css").send(""));
  r("GET", ["/QuickConnect/Enabled"], () => false);
  r("GET", ["/Localization/Countries", "/Localization/Cultures", "/Localization/ParentalRatings", "/Localization/Options"], () => []);
  r("GET", ["/Plugins", "/Packages", "/ScheduledTasks", "/Sessions", "/Notifications/Services", "/LiveTv/Channels"], (req) => (req.url.startsWith("/LiveTv") ? { Items: [], TotalRecordCount: 0, StartIndex: 0 } : []));
  r("GET", ["/LiveTv/Info"], () => ({ Services: [], IsEnabled: false, EnabledUsers: [] }));
  r("POST", ["/Sessions/Capabilities", "/Sessions/Capabilities/Full", "/ClientLog/Document"], () => undefined);
  app.get("/Playback/BitrateTest", async (req, reply) => {
    const size = Math.min(10_000_000, Number((req.query as any).size ?? (req.query as any).Size ?? 500000) || 500000);
    return reply.header("Content-Type", "application/octet-stream").send(crypto.randomBytes(size));
  });

  // --- users ---
  r("GET", ["/Users/Public"], () => people.list().map((p) => ({ Name: p.name, ServerId: SID(), Id: jid("person:" + p.id), HasPassword: p.hasPin, HasConfiguredPassword: p.hasPin, HasConfiguredEasyPassword: false, EnableAutoLogin: false })));
  r("POST", ["/Users/AuthenticateByName"], (req) => {
    const b = bodyOf(req);
    const name = String(b.Username ?? "").trim().toLowerCase();
    const p = people.list().find((x) => x.name.toLowerCase() === name);
    if (!p || (p.hasPin && !people.checkPin(p.id, String(b.Pw ?? "")))) throw new JfError(401, "Invalid username or password.");
    const a = authParts(req);
    const token = people.startSession(p.id, `${a.client ?? "Jellyfin"} on ${a.device ?? "a device"}`);
    if (a.deviceid) people.noteDevice(a.deviceid, a.device ?? "");
    return {
      User: userJson(p), AccessToken: token, ServerId: SID(),
      SessionInfo: { Id: tag(token), UserId: jid("person:" + p.id), UserName: p.name, Client: a.client ?? "", DeviceName: a.device ?? "", DeviceId: a.deviceid ?? "", ApplicationVersion: a.version ?? "",
        IsActive: true, SupportsMediaControl: false, SupportsRemoteControl: false, HasCustomDeviceName: false, LastActivityDate: iso(now()), LastPlaybackCheckIn: "0001-01-01T00:00:00.0000000Z",
        PlayState: { CanSeek: false, IsPaused: false, IsMuted: false, RepeatMode: "RepeatNone", PlaybackOrder: "Default" },
        Capabilities: { PlayableMediaTypes: [], SupportedCommands: [], SupportsMediaControl: false, SupportsPersistentIdentifier: true },
        RemoteEndPoint: req.ip, ServerId: SID(), PlayableMediaTypes: [], SupportedCommands: [], AdditionalUsers: [], NowPlayingQueue: [] },
    };
  });
  r("POST", ["/Sessions/Logout"], (req) => {
    people.endSession(tokenOf(req));
    return undefined;
  });
  r("GET", ["/Users/Me"], (req) => userJson(who(req)));
  r("GET", ["/Users"], (req) => {
    who(req);
    return people.list().map(userJson);
  });
  r("GET", ["/Users/:userId"], (req) => {
    who(req);
    const p = personByJid(req.params.userId);
    if (!p) throw new JfError(404, "User not found");
    return userJson(p);
  });
  app.get("/Users/:userId/Images/:type", async (_req, reply) => reply.code(404).send());
  app.get("/UserImage", async (_req, reply) => reply.code(404).send());

  // --- display preferences (kept per person and client) ---
  db.exec("CREATE TABLE IF NOT EXISTS jf_prefs(person TEXT NOT NULL, id TEXT NOT NULL, client TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(person, id, client))");
  r("GET", ["/DisplayPreferences/:id"], (req) => {
    const p = who(req);
    const q = qs(req);
    const row = db.prepare("SELECT data FROM jf_prefs WHERE person = ? AND id = ? AND client = ?").get(p.id, req.params.id, q.client ?? "") as { data: string } | undefined;
    const def = { Id: req.params.id.length === 32 ? dashed(req.params.id) : req.params.id, SortBy: "SortName", RememberIndexing: false, PrimaryImageHeight: 250, PrimaryImageWidth: 250,
      CustomPrefs: {}, ScrollDirection: "Horizontal", ShowBackdrop: true, RememberSorting: false, SortOrder: "Ascending", ShowSidebar: false, Client: q.client ?? "" };
    return row ? { ...def, ...json(row.data, {}) } : def;
  });
  r("POST", ["/DisplayPreferences/:id"], (req) => {
    const p = who(req);
    db.prepare("INSERT INTO jf_prefs(person, id, client, data) VALUES(?, ?, ?, ?) ON CONFLICT(person, id, client) DO UPDATE SET data = excluded.data")
      .run(p.id, req.params.id, qs(req).client ?? "", JSON.stringify(req.body ?? {}));
    return undefined;
  });

  // --- libraries and items ---
  const viewsOf = (p: P): Thing[] => {
    const kinds = new Set(lib.folders().map((f) => f.kind));
    const out: Thing[] = [];
    if (kinds.has("films")) out.push({ t: "view", kind: "films" });
    if (kinds.has("series")) out.push({ t: "view", kind: "series" });
    void p;
    return out;
  };
  r("GET", ["/UserViews", "/Users/:userId/Views"], (req) => {
    const p = who(req);
    const v = viewsOf(p);
    return { Items: v.map((t) => dto(p, t)), TotalRecordCount: v.length, StartIndex: 0 };
  });
  r("GET", ["/UserViews/GroupingOptions", "/Users/:userId/GroupingOptions"], (req) => {
    const p = who(req);
    return viewsOf(p).map((t) => ({ Name: (dto(p, t) as any).Name, Id: jid(keyOf(t)) }));
  });
  r("GET", ["/Library/MediaFolders"], (req) => {
    const p = who(req);
    const v = viewsOf(p);
    return { Items: v.map((t) => dto(p, t)), TotalRecordCount: v.length, StartIndex: 0 };
  });
  r("GET", ["/Library/VirtualFolders"], (req) => {
    who(req);
    return lib.folders().map((f) => ({ Name: path.basename(f.path), Locations: [f.path], CollectionType: f.kind === "films" ? "movies" : f.kind === "series" ? "tvshows" : "music", ItemId: jid("view:" + f.kind) }));
  });

  r("GET", ["/Items", "/Users/:userId/Items"], (req) => {
    const p = who(req);
    const q = qs(req);
    const ids = list(q.ids);
    if (ids.length) {
      const ths = ids.map((i) => thing(i)).filter((t): t is Thing => !!t && (t.t !== "row" || views.may(p, t.row)));
      return page(p, ths, { ...q, limit: "" });
    }
    const parent = q.parentid ? thing(q.parentid) : null;
    if (q.parentid && !parent) return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
    const types = list(q.includeitemtypes);
    const exclude = list(q.excludeitemtypes).map((t) => t.toLowerCase());
    // what Jellyfin lists without IncludeItemTypes and without Recursive: a library's own things
    let items = children(p, parent, q.recursive === "true" || (!parent && !!types.length) || !!q.searchterm, types);
    if (exclude.length) items = items.filter((t) => !exclude.includes(String(dto(p, t).Type).toLowerCase()));
    if (list(q.mediatypes).length) items = items.filter((t) => list(q.mediatypes).some((m) => m.toLowerCase() === String(dto(p, t).MediaType).toLowerCase()));
    if (q.isfolder === "false") items = items.filter((t) => t.t === "row" && (t.row.kind === "film" || t.row.kind === "episode"));
    if (q.isfolder === "true") items = items.filter((t) => t.t !== "row" || t.row.kind === "series");
    if (!q.sortby && parent?.t !== "season" && !(parent?.t === "row")) q.sortby = "SortName";
    return page(p, filterSort(p, items, q), q);
  });

  const one = (req: Req) => {
    const p = who(req);
    const th = thing(req.params.itemId);
    if (!th || (th.t === "row" && !views.may(p, th.row)) || (th.t === "season" && !views.may(p, th.series))) throw new JfError(404, "Item not found");
    return { p, th };
  };
  r("GET", ["/Items/:itemId", "/Users/:userId/Items/:itemId"], async (req) => {
    const { p, th } = one(req);
    const o = dto(p, th);
    if (th.t === "row" && (th.row.kind === "film" || th.row.kind === "episode") && th.row.file && !lib.data(th.row).disc) {
      // the file is looked into only when someone opens it (not while adding the folder)
      try {
        const ms = await mediaSource(p, th.row, {}, host(req));
        o.MediaSources = [ms];
        o.MediaStreams = ms.MediaStreams;
        o.RunTimeTicks = ms.RunTimeTicks ?? o.RunTimeTicks;
        o.Path = th.row.file;
      } catch (e) {
        log("jellyfin", `couldn't look into ${th.row.file}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return o;
  });
  r("GET", ["/Items/:itemId/Ancestors"], (req) => {
    const { p, th } = one(req);
    const out: Thing[] = [];
    if (th.t === "row" && th.row.kind === "episode") {
      const s = lib.getRow(th.row.parent ?? "");
      if (s) out.push({ t: "season", series: s, n: Number(lib.data(th.row).season) || 0 }, { t: "row", row: s }, { t: "view", kind: "series" });
    } else if (th.t === "season") out.push({ t: "row", row: th.series }, { t: "view", kind: "series" });
    else if (th.t === "row") out.push({ t: "view", kind: th.row.kind === "film" ? "films" : "series" });
    return out.map((t) => dto(p, t));
  });
  r("GET", ["/Items/Latest", "/Users/:userId/Items/Latest"], (req) => {
    const p = who(req);
    const q = qs(req);
    const parent = q.parentid ? thing(q.parentid) : null;
    const limit = Number(q.limit) || 16;
    const ok = (r: lib.Row) => views.may(p, r) && !(q.isplayed === "false" && views.progressOf(p.id, r.id)?.watched);
    let out: lib.Row[] = [];
    const kinds = parent?.t === "view" ? [parent.kind] : ["films", "series"];
    if (kinds.includes("films")) out.push(...lib.recent("film", 200).filter(ok));
    if (kinds.includes("series")) {
      // series by their newest episode, as Jellyfin groups them
      const latest = db.prepare(`SELECT parent, MAX(added) AS at FROM items WHERE kind = 'episode' GROUP BY parent ORDER BY at DESC LIMIT 200`).all() as { parent: string }[];
      out.push(...latest.map((l) => lib.getRow(l.parent)).filter((s): s is lib.Row => !!s && !lib.isHidden(s) && ok(s)));
    }
    out = out.sort((a, b) => b.added - a.added).slice(0, limit);
    return out.map((row) => dto(p, { t: "row", row }));
  });
  r("GET", ["/UserItems/Resume", "/Users/:userId/Items/Resume"], (req) => {
    const p = who(req);
    return page(p, resumable(p, qs(req)), qs(req));
  });
  r("GET", ["/Shows/NextUp"], (req) => {
    const p = who(req);
    const q = qs(req);
    const s = q.seriesid ? kid(q.seriesid) : null;
    return page(p, nextUp(p, s), q);
  });
  r("GET", ["/Shows/:itemId/Seasons"], (req) => {
    const { p, th } = one(req);
    if (th.t !== "row" || th.row.kind !== "series") throw new JfError(404, "Not a series");
    const ths: Thing[] = seasonsOf(th.row).map((n) => ({ t: "season", series: th.row, n }));
    return page(p, ths, { ...qs(req), limit: "" });
  });
  r("GET", ["/Shows/:itemId/Episodes"], (req) => {
    const { p, th } = one(req);
    if (th.t !== "row" || th.row.kind !== "series") throw new JfError(404, "Not a series");
    const q = qs(req);
    let eps = lib.rows("episode", th.row.id);
    const season = q.seasonid ? thing(q.seasonid) : null;
    if (season?.t === "season") eps = eps.filter((e) => (Number(lib.data(e).season) || 0) === season.n);
    else if (q.season) eps = eps.filter((e) => (Number(lib.data(e).season) || 0) === Number(q.season));
    if (q.startitemid) {
      const i = eps.findIndex((e) => jid(e.id) === q.startitemid.replace(/-/g, ""));
      if (i > 0) eps = eps.slice(i);
    }
    return page(p, eps.map((row) => ({ t: "row", row }) as Thing), q);
  });
  r("GET", ["/Items/:itemId/Similar"], (req) => {
    const { p, th } = one(req);
    if (th.t !== "row") return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
    const g = new Set((lib.data(th.row).genres ?? []).map((x: string) => x.toLowerCase()));
    const same = lib.rows(th.row.kind === "series" ? "series" : "film").filter((r) => r.id !== th.row.id && views.may(p, r) && (lib.data(r).genres ?? []).some((x: string) => g.has(x.toLowerCase())));
    return page(p, same.map((row) => ({ t: "row", row }) as Thing), { ...qs(req), limit: qs(req).limit || "12" });
  });
  r("GET", ["/Items/:itemId/Intros", "/Users/:userId/Items/:itemId/Intros"], () => ({ Items: [], TotalRecordCount: 0, StartIndex: 0 }));
  r("GET", ["/Items/:itemId/LocalTrailers", "/Users/:userId/Items/:itemId/LocalTrailers", "/Items/:itemId/SpecialFeatures", "/Users/:userId/Items/:itemId/SpecialFeatures"], () => []);
  r("GET", ["/Items/:itemId/ThemeMedia"], () => ({ ThemeVideosResult: { Items: [], TotalRecordCount: 0, StartIndex: 0, OwnerId: "00000000000000000000000000000000" }, ThemeSongsResult: { Items: [], TotalRecordCount: 0, StartIndex: 0, OwnerId: "00000000000000000000000000000000" }, SoundtrackSongsResult: { Items: [], TotalRecordCount: 0, StartIndex: 0, OwnerId: "00000000000000000000000000000000" } }));
  r("GET", ["/Items/Filters", "/Items/Filters2"], (req) => {
    const p = who(req);
    const genres = new Set<string>();
    for (const row of [...lib.rows("film"), ...lib.rows("series")]) if (views.may(p, row)) for (const g of lib.data(row).genres ?? []) genres.add(g);
    const sorted = [...genres].sort();
    return req.url.includes("Filters2") ? { Genres: sorted.map((g) => ({ Name: g, Id: jid("genre:" + g.toLowerCase()) })), Tags: [] } : { Genres: sorted, Tags: [], OfficialRatings: [], Years: [] };
  });
  r("GET", ["/Genres"], (req) => {
    const p = who(req);
    const q = qs(req);
    const parent = q.parentid ? thing(q.parentid) : null;
    const rows = parent?.t === "view" ? lib.rows(parent.kind === "films" ? "film" : "series") : [...lib.rows("film"), ...lib.rows("series")];
    const genres = new Map<string, string>();
    for (const row of rows) if (views.may(p, row)) for (const g of lib.data(row).genres ?? []) genres.set(g.toLowerCase(), g);
    const items = [...genres.values()].sort().map((g) => ({ Name: g, ServerId: SID(), Id: jid("genre:" + g.toLowerCase()), Type: "Genre", IsFolder: true, ImageTags: {}, BackdropImageTags: [], LocationType: "Virtual", MediaType: "Unknown", ChannelId: null }));
    return { Items: items, TotalRecordCount: items.length, StartIndex: 0 };
  });
  r("GET", ["/Persons", "/Studios", "/Artists", "/Artists/AlbumArtists"], () => ({ Items: [], TotalRecordCount: 0, StartIndex: 0 }));
  r("GET", ["/Search/Hints"], (req) => {
    const p = who(req);
    const term = (qs(req).searchterm ?? "").toLowerCase();
    const hits = [...lib.rows("film"), ...lib.rows("series")].filter((r) => views.may(p, r) && r.title.toLowerCase().includes(term)).slice(0, Number(qs(req).limit) || 20);
    return { SearchHints: hits.map((r) => ({ ItemId: jid(r.id), Id: jid(r.id), Name: r.title, Type: r.kind === "film" ? "Movie" : "Series", ProductionYear: Number(r.year) || undefined, IsFolder: r.kind === "series", MediaType: r.kind === "film" ? "Video" : "Unknown" })), TotalRecordCount: hits.length };
  });

  // intros, found by Korie's intro add-on, as Jellyfin's media segments (the apps show "Skip intro")
  r("GET", ["/MediaSegments/:itemId"], (req) => {
    who(req);
    const k = kid(req.params.itemId);
    const row = k ? lib.getRow(k) : null;
    const intro = row ? (lib.data(row).intro as { start: number; end: number } | null) : null;
    const items = intro ? [{ Id: tag("intro:" + row!.id), ItemId: jid(row!.id), Type: "Intro", StartTicks: Math.round(intro.start * TICKS), EndTicks: Math.round(intro.end * TICKS) }] : [];
    return { Items: items, TotalRecordCount: items.length, StartIndex: 0 };
  });

  // --- pictures ---
  const imageRoute = async (req: Req, reply: FastifyReply) => {
    const q = qs(req);
    const th = thing(req.params.itemId);
    const type = req.params.imageType.toLowerCase();
    let src = "";
    if (th?.t === "row") {
      const s = sources(th.row);
      src = type === "primary" ? (th.row.kind === "episode" ? s.thumb : s.poster) : type === "backdrop" || type === "thumb" ? s.backdrop || s.thumb : "";
    } else if (th?.t === "season") {
      src = type === "primary" ? seasonPoster(th.series, th.n) : type === "backdrop" ? sources(th.series).backdrop : "";
    }
    if (!src) return reply.code(404).send();
    const w = Number(q.maxwidth || q.fillwidth || q.width || 0) || (Number(q.maxheight || q.fillheight || q.height || 0) ? Math.round(Number(q.maxheight || q.fillheight || q.height) * (type === "primary" ? 0.67 : 1.78)) : 780);
    const file = await picture(src, w);
    if (!file) return reply.code(404).send();
    return reply.header("Content-Type", "image/webp").header("Cache-Control", "public, max-age=31536000").send(fs.createReadStream(file));
  };
  app.get("/Items/:itemId/Images/:imageType", imageRoute as any);
  app.get("/Items/:itemId/Images/:imageType/:imageIndex", imageRoute as any);

  // --- playing ---
  const playbackInfo = async (req: Req) => {
    const { p, th } = one(req);
    if (th.t !== "row" || !th.row.file || (th.row.kind !== "film" && th.row.kind !== "episode")) throw new JfError(404, "Nothing to play");
    const b = bodyOf(req);
    const q = qs(req);
    for (const k of ["AudioStreamIndex", "SubtitleStreamIndex", "StartTimeTicks"]) if (b[k] == null && q[k.toLowerCase()] != null) b[k] = q[k.toLowerCase()];
    const ms = await mediaSource(p, th.row, b, host(req));
    lengths.set(th.row.id, Number(ms.RunTimeTicks ?? 0) / TICKS);
    return { MediaSources: [ms], PlaySessionId: crypto.randomBytes(16).toString("hex") };
  };
  r("POST", ["/Items/:itemId/PlaybackInfo"], playbackInfo);
  r("GET", ["/Items/:itemId/PlaybackInfo"], playbackInfo);

  // the file as it is (static=true), or converted as it plays
  const videoStream = async (req: Req, reply: FastifyReply) => {
    const q = qs(req);
    const k = kid(req.params.itemId);
    const row = k ? lib.getRow(k) : null;
    if (q.k) {
      const src = playback.source(q.k);
      if (!src) return reply.code(404).send();
      reply.hijack();
      const start = Math.max(0, Number(q.start ?? 0) || 0);
      playback.stream(src, start, { v: q.v === "copy" ? "copy" : undefined, audio: q.audio }, reply.raw, (fn) => req.raw.on("close", fn), q.k).catch((e) => {
        log("jellyfin", `stream: ${e?.message ?? e}`);
        if (!reply.raw.headersSent) reply.raw.writeHead(500);
        reply.raw.end();
      });
      return;
    }
    if (!row?.file || !fs.existsSync(row.file) || fs.statSync(row.file).isDirectory()) return reply.code(404).send();
    // like Jellyfin, a file is handed out without signing in (its players don't all send the token);
    // the ids are unguessable and only listed to people who may see them. A token that is sent is
    // still checked against the person's age limit.
    const p = people.fromToken(tokenOf(req));
    if (p && !views.may(p, row)) return reply.code(403).send();
    const st = fs.statSync(row.file);
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    const type = FILE_TYPES[path.extname(row.file).toLowerCase()] ?? playback.mime(row.file);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start >= st.size) return reply.code(416).header("Content-Range", `bytes */${st.size}`).send();
      reply.code(206).headers({ "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
      return reply.send(fs.createReadStream(row.file, { start, end }));
    }
    reply.headers({ "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": st.size });
    return reply.send(fs.createReadStream(row.file));
  };
  for (const u of ["/Videos/:itemId/stream", "/Videos/:itemId/stream.:container", "/Items/:itemId/Download"]) {
    app.get(u, videoStream as any);
  }
  app.get("/Videos/:itemId/:msId/Subtitles/:index/:start/Stream.:fmt", async (req: any, reply) => {
    const k = kid(req.params.itemId);
    const row = k ? lib.getRow(k) : null;
    if (!row?.file) return reply.code(404).send();
    const index = Number(req.params.index);
    const probe = await playback.probe({ file: row.file });
    const files: string[] = lib.data(row).subs ?? [];
    const src: playback.Source = index >= probe.streams.length ? { file: files[index - probe.streams.length] } : { file: row.file };
    if (!src.file) return reply.code(404).send();
    const text = await playback.subtitles(src, index >= probe.streams.length ? null : index);
    // Stream.js: Jellyfin's own shape, which its web app draws the subtitles from
    if (req.params.fmt === "js") return reply.header("Content-Type", "application/json").send(JSON.stringify({ TrackEvents: vttEvents(text) }));
    return reply.header("Content-Type", "text/vtt; charset=utf-8").send(text);
  });
  app.get("/Videos/:itemId/:msId/Subtitles/:index/Stream.:fmt", async (req: any, reply) => reply.redirect(`/Videos/${req.params.itemId}/${req.params.msId}/Subtitles/${req.params.index}/0/Stream.${req.params.fmt}`));

  // progress: Korie's own, so it's the same in every app
  const report = (req: Req, stopped: boolean) => {
    const p = who(req);
    const b = bodyOf(req);
    const k = kid(String(b.ItemId ?? ""));
    if (!k) return undefined;
    const pos = Number(b.PositionTicks ?? 0) / TICKS;
    const len = lengths.get(k) || runtimeOf(lib.getRow(k) ?? ({ data: "{}" } as lib.Row));
    if (pos > 0 || stopped) views.setProgress(p, k, pos, len, false);
    return undefined;
  };
  r("POST", ["/Sessions/Playing"], (req) => report(req, false));
  r("POST", ["/Sessions/Playing/Progress"], (req) => report(req, false));
  r("POST", ["/Sessions/Playing/Stopped"], (req) => report(req, true));
  r("POST", ["/Sessions/Playing/Ping"], () => undefined);
  r("DELETE", ["/Videos/ActiveEncodings"], () => undefined);

  const played = (req: Req, watched: boolean) => {
    const p = who(req);
    const k = kid(req.params.itemId);
    if (!k) throw new JfError(404, "Item not found");
    if (k.startsWith("season:")) {
      const th = thing(req.params.itemId);
      if (th?.t === "season") for (const e of lib.rows("episode", th.series.id).filter((e) => (Number(lib.data(e).season) || 0) === th.n)) views.setWatched(p, e.id, watched);
    } else views.setWatched(p, k, watched);
    return userData(p, k);
  };
  r("POST", ["/UserPlayedItems/:itemId", "/Users/:userId/PlayedItems/:itemId"], (req) => played(req, true));
  r("DELETE", ["/UserPlayedItems/:itemId", "/Users/:userId/PlayedItems/:itemId"], (req) => played(req, false));
  const fav = (req: Req, on: boolean) => {
    const p = who(req);
    const k = kid(req.params.itemId);
    if (!k) throw new JfError(404, "Item not found");
    if (views.isFavourite(p, k) !== on) views.toggleFavourite(p, k);
    return userData(p, k);
  };
  r("POST", ["/UserFavoriteItems/:itemId", "/Users/:userId/FavoriteItems/:itemId"], (req) => fav(req, true));
  r("DELETE", ["/UserFavoriteItems/:itemId", "/Users/:userId/FavoriteItems/:itemId"], (req) => fav(req, false));
  r("GET", ["/UserItems/:itemId/UserData", "/Users/:userId/Items/:itemId/UserData"], (req) => {
    const p = who(req);
    const k = kid(req.params.itemId);
    if (!k) throw new JfError(404, "Item not found");
    return userData(p, k);
  });

  // --- everything else Jellyfin lists things for: an empty list ---
  // (features Korie doesn't have, or has as add-ons not installed: Live TV, music, SyncPlay ...).
  // Jellyfin's apps then show nothing there instead of an error. From Jellyfin's API description.
  let empties = 0;
  for (const [url, methods] of Object.entries(EMPTY as Record<string, Record<string, string>>)) {
    for (const [method, kind] of Object.entries(methods)) {
      if (app.hasRoute({ method: method as "GET", url })) continue;
      try {
        r(method as "GET", [url], (req) => {
          who(req);
          return kind === "qr" ? { Items: [], TotalRecordCount: 0, StartIndex: 0 } : [];
        });
        empties++;
      } catch { /* a route Fastify can't take beside ours */ }
    }
  }
  log("jellyfin", `${empties} Jellyfin lists answered as empty`);

  // --- Jellyfin's web app, served by Korie (from KORIE_JELLYFIN_WEB) ---
  if (webDir && fs.existsSync(webDir)) {
    // served by hand: its file names have characters (@) that arrive encoded (%40)
    const root = path.resolve(webDir);
    const TYPES: Record<string, string> = { ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".webp": "image/webp", ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".txt": "text/plain" };
    app.get("/web/*", async (req, reply) => {
      let rel = "";
      try {
        rel = decodeURIComponent(String((req.params as Record<string, string>)["*"] ?? "").split("?")[0]);
      } catch {
        return reply.code(400).send();
      }
      let file = path.resolve(root, rel || "index.html");
      if (!file.startsWith(root)) return reply.code(403).send();
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.existsSync(file)) return reply.code(404).send();
      const html = file.endsWith(".html");
      return reply.header("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream").header("Cache-Control", html ? "no-cache" : "public, max-age=31536000").send(fs.createReadStream(file));
    });
    app.get("/web", async (_req, reply) => reply.redirect("/web/"));
    log("jellyfin", `Jellyfin's web app at /web (${webDir})`);
  }
}
