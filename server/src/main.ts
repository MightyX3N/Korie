// Korie's server: the library, people, add-ons and the Store, and the web
// client every screen uses.
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { CLIENT_DIR, PORT, VERSION, log } from "./config.ts";
import { setting, setSetting, DEFAULTS } from "./db.ts";
import * as people from "./people.ts";
import * as lib from "./library.ts";
import * as tmdb from "./tmdb.ts";
import * as themes from "./themes.ts";
import * as views from "./views.ts";
import * as ages from "./ages.ts";
import * as playlists from "./playlists.ts";
import * as intros from "./intros.ts";
import * as addons from "./addons/manager.ts";
import * as browse from "./addons/browse.ts";
import * as store from "./addons/store.ts";
import * as playback from "./playback.ts";
import { img, picture, valid } from "./images.ts";
import { subscribe } from "./events.ts";
import { serverId } from "./ident.ts";
import { startDiscovery } from "./discovery.ts";
import * as kodi from "./kodi.ts";

const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, routerOptions: { maxParamLength: 8192 } });

type Req = FastifyRequest<{ Querystring: Record<string, string>; Params: Record<string, string>; Body: any }>;

class HttpError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

function who(req: FastifyRequest): people.Person {
  const h = req.headers.authorization ?? "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : ((req.query as Record<string, string>)?.t ?? "");
  const p = people.fromToken(tok);
  if (!p) throw new HttpError(401, "Sign in first.");
  return p;
}

function admin(req: FastifyRequest): people.Person {
  const p = who(req);
  if (!p.admin) throw new HttpError(403, "Only an admin can do that.");
  return p;
}

function installer(req: FastifyRequest): people.Person {
  const p = who(req);
  if (!p.canInstall) throw new HttpError(403, "Ask an admin to let you install add-ons.");
  return p;
}

function settingsPerson(req: FastifyRequest): people.Person {
  const p = who(req);
  if (!p.canSettings) throw new HttpError(403, "Ask an admin to let you change settings.");
  return p;
}

app.setErrorHandler((err: any, _req, reply) => {
  const code = err instanceof HttpError ? err.code : err.statusCode ?? 500;
  if (code >= 500) log("http", String(err?.stack ?? err));
  void reply.code(code).send({ error: err.message ?? "Something went wrong." });
});

const body = (req: FastifyRequest): Record<string, any> => (req.body ?? {}) as Record<string, any>;

const allowed = (p: people.Person) => (aid: string) => people.mayUseAddon(p, aid);

// --- hello, people, signing in ------------------------------------------------------------

if (process.env.KORIE_DEBUG_HTTP) app.addHook("onResponse", async (req, reply) => log("http", `${req.method} ${req.url} ${req.headers.range ?? ""} -> ${reply.statusCode}`));

// the Kodi repository (see kodi.ts)
app.get("/kodi", async (_req, reply: FastifyReply) => reply.redirect("/kodi/"));
app.get("/kodi/*", async (req: Req, reply: FastifyReply) => {
  const rel = decodeURIComponent((req.params as any)["*"] ?? "");
  const f = await kodi.serve(rel, kodi.baseOf(req.headers.host));
  if (!f) throw new HttpError(404, "Not found.");
  const buf = typeof f.body === "string" ? Buffer.from(f.body) : f.body;
  reply.header("Content-Type", f.type).header("Cache-Control", "no-cache").header("Accept-Ranges", "bytes");
  // Kodi reads zip files in pieces (it jumps to the zip's index at the end first)
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    let start = range[1] ? Number(range[1]) : buf.length - Number(range[2] || 0);
    let end = range[1] && range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    if (!range[1]) start = Math.max(0, start);
    if (start >= buf.length || start > end) return reply.code(416).header("Content-Range", `bytes */${buf.length}`).send();
    return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${buf.length}`).header("Content-Length", end - start + 1).send(buf.subarray(start, end + 1));
  }
  return reply.header("Content-Length", buf.length).send(buf);
});

app.get("/api/hello", async () => ({ korie: true, id: serverId(), name: setting("server_name"), version: VERSION }));

app.get("/api/people", async () => people.list().map(({ id, name, color, hasPin, admin }) => ({ id, name, color, hasPin, admin })));

app.post("/api/login", async (req: Req) => {
  const { person, pin, device, deviceId } = body(req);
  const p = people.get(String(person ?? ""));
  if (!p) throw new HttpError(404, "That person isn't here any more.");
  if (p.hasPin && !people.checkPin(p.id, String(pin ?? ""))) throw new HttpError(403, "Wrong PIN.");
  people.noteDevice(deviceId, device);
  return { token: people.startSession(p.id, String(device ?? "")), person: p };
});

/** A device starting up: when someone signs in on it by itself (Settings, People), their session. */
app.post("/api/auto", async (req: Req) => {
  const { device, deviceId } = body(req);
  people.noteDevice(deviceId, device);
  const p = typeof deviceId === "string" ? people.autoFor(deviceId) : null;
  if (!p) return { token: null };
  return { token: people.startSession(p.id, String(device ?? "")), person: p };
});

app.post("/api/logout", async (req) => {
  const h = req.headers.authorization ?? "";
  if (h.startsWith("Bearer ")) people.endSession(h.slice(7));
  return { ok: true };
});

app.get("/api/me", async (req) => {
  const p = who(req);
  return { person: p, server: { name: setting("server_name"), version: VERSION, id: serverId() }, games: hasGames(p), languages: people.LANGUAGES };
});

/** A TV says which Android apps it has (their names, for choosing who may open which). */
app.post("/api/apps", async (req: Req) => {
  who(req);
  const list = Array.isArray(body(req).apps) ? (body(req).apps as { pkg: string; label: string }[]) : [];
  people.noteApps(list.filter((a) => a && typeof a.pkg === "string"));
  return { ok: true };
});

/** Your own audio and subtitle languages (anyone may set their own). */
app.post("/api/me/playback", async (req: Req) => {
  const p = who(req);
  const b = body(req);
  return { person: people.setPlayback(p.id, { audio: b.audio != null ? String(b.audio) : undefined, subs: b.subs != null ? String(b.subs) : undefined, skipIntro: b.skipIntro != null ? String(b.skipIntro) : undefined }) };
});

app.get("/api/events", (req, reply) => {
  who(req);
  reply.hijack();
  subscribe(reply.raw);
});

function hasGames(p: people.Person): boolean {
  return addons.enabledIds().some((id) => addons.manifests.get(id)?.games && people.mayUseAddon(p, id));
}

// --- home and the sections ----------------------------------------------------------------

app.get("/api/home", async (req) => {
  const p = who(req);
  const rows: { id: string; title: string; kind: string; items: views.Card[]; source?: string }[] = [];
  const cont = views.continueWatching(p, allowed(p));
  if (cont.length) rows.push({ id: "continue", title: "Continue watching", kind: "wide", items: cont });
  const next = views.nextUp(p);
  if (next.length) rows.push({ id: "next", title: "Next up", kind: "wide", items: next });
  const recent = (k: "film" | "series" | "album") => lib.recent(k, 400).filter((r) => views.may(p, r)).slice(0, 20).map((r) => views.rowCard(p, r));
  const recentFilms = recent("film");
  if (recentFilms.length) rows.push({ id: "films", title: "Recently added films", kind: "poster", items: recentFilms });
  const recentSeries = recent("series");
  if (recentSeries.length) rows.push({ id: "series", title: "Recently added series", kind: "poster", items: recentSeries });
  const recentMusic = p.music ? recent("album") : [];
  if (recentMusic.length) rows.push({ id: "music", title: "Recently added music", kind: "square", items: recentMusic });
  const fav = views.favourites(p);
  if (fav.length) rows.push({ id: "favourites", title: "Favourites", kind: "fav", items: fav });
  for (const s of browse.section("home", allowed(p))) {
    for (const r of s.rows) rows.push({ id: `${s.addon}:${r.id}`, title: `${s.name}: ${r.title}`, kind: rowKind(r.items), items: r.items.filter((a) => views.mayItem(p, a)).map((a) => views.addonCard(p, a)), source: s.addon });
  }
  return { rows, empty: rows.length === 0, scanning: lib.status.scanning, status: lib.status.text };
});

function rowKind(items: browse.AItem[]): string {
  // links without pictures (DRTV's genre buttons) show as labelled tiles
  if (items.every((i) => !i.poster && !i.thumb && !i.backdrop)) return "text";
  const wide = items.filter((i) => ["episode", "live", "page"].includes(i.kind) || (!i.poster && (i.thumb || i.backdrop))).length;
  return wide * 2 > items.length ? "wide" : "poster";
}

const SORTS: Record<string, string> = { added: "added DESC, sort", title: "sort", year: "year DESC, sort", rating: "CAST(json_extract(data, '$.rating') AS REAL) DESC, sort", artist: "artist" };

function grid(req: Req, kind: "film" | "series" | "album") {
  const p = who(req);
  const sort = SORTS[req.query.sort ?? "added"] ? req.query.sort ?? "added" : "added";
  const show = req.query.show ?? "all";
  let rows = (lib.rows(kind) as lib.Row[]).filter((r) => views.may(p, r));
  rows = [...rows].sort(sorter(sort));
  let cards = rows.map((r) => views.rowCard(p, r));
  if (show === "unwatched") cards = cards.filter((c) => !c.watched);
  if (show === "progress") cards = cards.filter((c) => c.progress > 0);
  return cards;
}

function sorter(sort: string): (a: lib.Row, b: lib.Row) => number {
  const rating = (r: lib.Row) => Number(lib.data(r).rating ?? 0);
  switch (sort) {
    case "title": return (a, b) => a.sort.localeCompare(b.sort);
    case "year": return (a, b) => (b.year || "0").localeCompare(a.year || "0") || a.sort.localeCompare(b.sort);
    case "rating": return (a, b) => rating(b) - rating(a) || a.sort.localeCompare(b.sort);
    case "artist": return (a, b) => String(lib.data(a).artist ?? "").localeCompare(String(lib.data(b).artist ?? "")) || (a.year || "").localeCompare(b.year || "");
    default: return (a, b) => b.added - a.added || a.sort.localeCompare(b.sort);
  }
}

function sectionView(req: Req, sec: "films" | "series", kind: "film" | "series") {
  const p = who(req);
  const sources = browse.section(sec, allowed(p)).filter((s) => s.rows.length || s.loading);
  const src = req.query.source ?? "";
  const out: Record<string, unknown> = {
    sources: [{ id: "", name: sec === "films" ? "Your films" : "Your series" }, ...sources.map((s) => ({ id: s.addon, name: s.name }))],
    source: src,
  };
  if (src) {
    const s = browse.section(sec, allowed(p)).find((x) => x.addon === src);
    out.rows = (s?.rows ?? []).map((r) => ({ id: r.id, title: r.title, kind: rowKind(r.items), items: r.items.filter((a) => views.mayItem(p, a)).map((a) => views.addonCard(p, a)) }));
    out.status = s ? (s.rows.length ? "" : s.loading ? `Loading ${s.name}…` : s.error || `${s.name} has nothing here.`) : "This add-on isn't on.";
  } else {
    out.items = grid(req, kind);
    const shown = req.query.show ?? "all";
    out.status = (out.items as unknown[]).length ? "" : shown === "unwatched" ? `You've watched all your ${sec}.`
      : shown === "progress" ? `None of your ${sec} are half watched.` : lib.folders().some((f) => f.kind === sec)
      ? (lib.status.scanning ? "Looking through your folders…" : `No ${sec} found in your ${sec} folders yet.`)
      : `No ${sec} yet. Add a folder with ${sec} in Settings → Libraries.`;
  }
  return out;
}

app.get("/api/films", async (req: Req) => sectionView(req, "films", "film"));
app.get("/api/series", async (req: Req) => sectionView(req, "series", "series"));
app.get("/api/music", async (req: Req) => {
  const p = who(req);
  if (!p.music) throw new HttpError(403, "Music isn't on for you. An admin can turn it on (Settings, People).");
  const by = req.query.by ?? "albums";
  const empty = lib.folders().some((f) => f.kind === "music") ? "No music found in your music folders yet." : "No music yet. Add a folder with music in Settings → Libraries.";
  const albums = lib.rows("album");
  const artistOf = (r: lib.Row) => String(lib.data(r).artist || "Unknown artist");
  const genresOf = (r: lib.Row) => (lib.data(r).genres ?? []) as string[];
  const counts = { albums: albums.length, artists: new Set(albums.map(artistOf)).size };
  // a card for a group of albums (an artist, a genre) with the first one's cover
  const group = (kind: string, name: string, rs: lib.Row[]) => {
    const c = views.rowCard(p, rs[0]);
    return { ...c, id: `${kind}:${name}`, kind, title: name, subtitle: rs.length === 1 ? "1 album" : `${rs.length} albums`, year: "" };
  };
  if (by === "artists" || by === "genres") {
    const groups = new Map<string, lib.Row[]>();
    for (const r of albums) for (const k of by === "artists" ? [artistOf(r)] : genresOf(r)) groups.set(k, [...(groups.get(k) ?? []), r]);
    const items = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, rs]) => group(by === "artists" ? "artist" : "genre", name, rs));
    const none = by === "genres" && albums.length ? "Your music has no genres yet. They come from the songs' genre tags." : empty;
    return { items, counts, status: items.length ? "" : none };
  }
  if (by === "songs") {
    const items = albums.flatMap((a) => lib.rows("track", a.id).map((t) => views.rowCard(p, t)));
    return { items, counts, status: items.length ? "" : empty };
  }
  if (by === "playlists") {
    const items = playlists.list(p.id).map((pl) => views.playlistCard(p, pl));
    return { items, counts, status: items.length ? "" : "No playlists yet. Make one here, or add songs and albums to one with the options menu." };
  }
  if (req.query.playlist) {
    const pl = playlists.get(p.id, req.query.playlist);
    if (!pl) throw new HttpError(404, "That playlist isn't there any more.");
    const items = playlists.songs(pl).map((t, i) => ({ ...views.rowCard(p, t), playlist: pl.id, n: i + 1 }));
    return { items, counts, title: pl.name, status: items.length ? "" : "Nothing on it yet. Add songs and albums with the options menu." };
  }
  const artist = req.query.artist;
  const genre = req.query.genre;
  const items = grid(req, "album").filter((c) => (!artist || c.subtitle.startsWith(artist)) && (!genre || genresOf(lib.getRow(c.id)!).includes(genre)));
  return { items, counts, status: items.length ? "" : empty };
});

// --- playlists ---------------------------------------------------------------------------------

function musicPerson(req: Req) {
  const p = who(req);
  if (!p.music) throw new HttpError(403, "Music isn't on for you. An admin can turn it on (Settings, People).");
  return p;
}

app.get("/api/playlists", async (req: Req) => {
  const p = musicPerson(req);
  return { playlists: playlists.list(p.id).map((pl) => ({ id: pl.id, name: pl.name, count: playlists.songs(pl).length })) };
});

app.post("/api/playlists", async (req: Req) => {
  const p = musicPerson(req);
  const name = String(body(req).name ?? "").trim();
  if (!name) throw new HttpError(400, "A playlist needs a name.");
  const pl = playlists.create(p.id, name);
  if (body(req).item) playlists.add(p.id, pl.id, String(body(req).item));
  return { id: pl.id, name: pl.name };
});

app.post("/api/playlists/:id", async (req: Req) => {
  const p = musicPerson(req);
  const b = body(req);
  const id = req.params.id;
  if (!playlists.get(p.id, id)) throw new HttpError(404, "That playlist isn't there any more.");
  if (b.add) return { added: playlists.add(p.id, id, String(b.add)) };
  if (b.take) return { ok: playlists.take(p.id, id, String(b.take)) };
  if (b.name) return { ok: playlists.rename(p.id, id, String(b.name)) };
  throw new HttpError(400, "Nothing to change.");
});

app.delete("/api/playlists/:id", async (req: Req) => {
  const p = musicPerson(req);
  if (!playlists.remove(p.id, req.params.id)) throw new HttpError(404, "That playlist isn't there any more.");
  return { ok: true };
});

app.get("/api/live", async (req) => {
  const p = who(req);
  const secs = browse.section("live", allowed(p));
  const rows = secs.filter((s) => s.rows.length).map((s) => ({ id: s.addon, title: s.name, kind: "wide", items: s.rows[0].items.filter((a) => views.mayItem(p, a)).map((a) => views.addonCard(p, a)) }));
  return { rows, status: rows.length ? "" : secs.some((s) => s.loading) ? "Loading channels…" : "No channels yet. Add-ons with live TV (DRTV, Stremio TV add-ons) show their channels here. Get them in the Store." };
});

app.get("/api/games", async (req) => {
  const p = who(req);
  const secs = browse.section("games", allowed(p)).filter((s) => addons.manifests.get(s.addon)?.games);
  const rows = secs.flatMap((s) => s.rows.map((r) => ({ id: `${s.addon}:${r.id}`, title: secs.length > 1 ? `${r.title} · ${s.name}` : r.title, kind: "poster", items: r.items.filter((a) => views.mayItem(p, a)).map((a) => views.addonCard(p, a)) })));
  const errors = secs.filter((s) => !s.rows.length && s.error).map((s) => `${s.name}: ${s.error}`);
  return { rows, status: rows.length ? "" : secs.some((s) => s.loading) ? "Loading games…" : errors.join("\n") || "No games yet. Type your RomM server in the RomM add-on's settings (Store → Installed → RomM)." };
});

app.get("/api/page", async (req: Req) => {
  const p = who(req);
  const pg = await browse.page(req.query.id ?? "");
  return { title: pg.title, rows: pg.rows.map((r) => ({ id: r.id, title: r.title, kind: rowKind(r.items), items: r.items.filter((a) => views.mayItem(p, a)).map((a) => views.addonCard(p, a)) })), status: pg.rows.length ? "" : pg.error || "Nothing here." };
});

app.get("/api/item", async (req: Req) => {
  const p = who(req);
  const id = req.query.id ?? "";
  if (id.startsWith("playlist:")) {
    const pl = playlists.get(musicPerson(req).id, id.slice(9));
    if (!pl) throw new HttpError(404, "That playlist isn't there any more.");
    return views.playlistDetails(p, pl);
  }
  let a = browse.get(id);
  if (a && a.kind === "series" && !a.seasons) {
    try {
      a = await browse.open(id);
    } catch (e) {
      const d = views.details(p, id);
      return { ...d, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const d = views.details(p, id);
  if (!d) throw new HttpError(404, "This isn't here any more.");
  return d;
});

app.get("/api/search", async (req: Req) => {
  const p = who(req);
  const q = (req.query.q ?? "").trim();
  if (!q) return { groups: [] };
  const ql = tmdb.norm(q);
  const match = (r: lib.Row) => tmdb.norm(r.title).includes(ql) || tmdb.norm((lib.data(r).genres ?? []).join(" ")).includes(ql);
  const groups: { id: string; title: string; items: views.Card[]; loading?: boolean }[] = [];
  for (const [k, title] of [["film", "Films"], ["series", "Series"], ["album", "Music"]] as const) {
    if (k === "album" && !p.music) continue;
    const items = lib.rows(k).filter((r) => match(r) && views.may(p, r)).slice(0, 40).map((r) => views.rowCard(p, r));
    if (items.length) groups.push({ id: k, title, items });
  }
  if (q.length >= 2) {
    for (const [aid, items] of browse.search(q, allowed(p))) {
      const name = addons.manifests.get(aid)?.name ?? aid;
      if (items === null) groups.push({ id: aid, title: name, items: [], loading: true });
      else if (items.some((a) => views.mayItem(p, a))) groups.push({ id: aid, title: name, items: items.filter((a) => views.mayItem(p, a)).slice(0, 40).map((a) => views.addonCard(p, a)) });
    }
  }
  return { groups };
});

// --- playing --------------------------------------------------------------------------------

app.post("/api/play", async (req: Req) => {
  const p = who(req);
  const id = String(body(req).id ?? "");
  const caps = playback.parseCaps(String(body(req).caps ?? ""));
  const audio = body(req).audio != null ? Number(body(req).audio) : null;
  const burn = body(req).burn != null ? Number(body(req).burn) : null;
  const row = lib.getRow(id);
  let src: playback.Source;
  let subFiles: string[] = [];
  let extra: { url: string; title: string; language: string; default: boolean }[] = [];
  let title = row?.title ?? "";
  let subtitle = "";
  let episode: { show: string; season: number; episode: number } | null = null;
  let next: string | null = null;
  if (row) {
    if (lib.isHidden(row) || !views.may(p, row)) throw new HttpError(403, "This isn't for you. An admin can change what you may watch (Settings, People).");
    if (!row.file) throw new HttpError(400, "There's no file to play.");
    const d = lib.data(row);
    src = { file: row.file, disc: d.disc ?? null, ...(Array.isArray(d.parts) && d.parts.length > 1 ? { parts: d.parts } : {}) };
    subFiles = d.subs ?? [];
    if (row.kind === "episode") {
      const s = lib.getRow(row.parent ?? "");
      subtitle = `${s?.title ?? ""} · S${d.season}E${d.episode}`;
      episode = { show: s?.title ?? "", season: Number(d.season) || 0, episode: Number(d.episode) || 0 };
      const eps = lib.rows("episode", row.parent ?? "");
      next = eps[eps.findIndex((e) => e.id === id) + 1]?.id ?? null;
    }
    if (row.kind === "track") {
      const al = lib.getRow(row.parent ?? "");
      subtitle = [d.artist, al?.title].filter(Boolean).join(" · ");
    }
  } else {
    const a = browse.get(id);
    if (!a) throw new HttpError(404, "This isn't known any more. Go back and open it again.");
    if (!views.mayItem(p, a)) throw new HttpError(403, "This isn't for you. An admin can change what you may watch (Settings, People).");
    if (!people.mayUseAddon(p, a.source)) throw new HttpError(403, "You can't use this add-on.");
    title = a.title;
    subtitle = a.subtitle;
    let ans: browse.PlayAnswer;
    try {
      ans = await browse.play(id);
    } catch (e) {
      throw new HttpError(502, `${addons.manifests.get(a.source)?.name ?? a.source} couldn't start "${a.title}": ${e instanceof Error ? e.message : e}.`);
    }
    if (ans.web) return { web: ans.web, title };
    src = { url: ans.url!, headers: ans.headers, live: ans.live };
    extra = ans.subtitles;
    if (a.kind === "episode" && a.series) {
      const s = browse.get(a.series);
      const eps = (s?.seasons ?? []).flatMap((x) => x.episodes);
      next = eps[eps.findIndex((e) => e.id === id) + 1]?.id ?? null;
    }
  }
  const prog0 = views.progressOf(p.id, id);
  const resume = prog0 && !prog0.watched ? prog0.position : 0;
  // an episode's intro (found by intros.ts) and what this person wants done with it
  const intro = row?.kind === "episode" && p.skipIntro !== "off" ? (lib.data(row).intro as { start: number; end: number } | null) ?? null : null;
  const skip = intro ? { ...intro, auto: p.skipIntro === "auto" } : null;
  // Kodi plays nearly everything itself: hand it the original file or stream, nothing probed or converted
  // a DVD with "Play the film only": the server sends the main title, as it does for every other screen
  const filmOnly = body(req).menu === false && src.disc === "dvd";
  if (body(req).kodi && !filmOnly) {
    const k = kodiSource(src, req.headers.host);
    if (k) {
      const subs = [
        ...subFiles.map((f) => `http://${req.headers.host}/api/raw/${playback.token({ file: f })}/${encodeURIComponent(path.basename(f))}`),
        ...extra.map((x) => x.url),
      ];
      // Kodi picks the tracks itself, after it starts: it gets the person's languages to pick by
      return { mode: "kodi", url: k, subs, id, title, subtitle, episode, resume, next, live: !!src.live, languages: { audio: p.audio, subs: p.subs }, discMenu: src.disc === "dvd", intro: skip };
    }
  }
  let pl: playback.Plan;
  try {
    pl = await playback.plan(src, caps, audio, burn, subFiles, extra, { audio: p.audio, subs: p.subs });
  } catch (e) {
    throw new HttpError(422, e instanceof Error ? e.message : String(e));
  }
  const prog = views.progressOf(p.id, id);
  return { ...pl, id, title, subtitle, episode, resume: prog && !prog.watched ? prog.position : 0, next, intro: skip };
});

/** The address Kodi should open for a source, or null when the server has to convert it (disc folders). */
function kodiSource(src: playback.Source, host: string | undefined): string | null {
  const media = (f: string) => `http://${host}/api/media/${playback.token({ file: f })}/${encodeURIComponent(path.basename(f))}`;
  if (src.url) {
    // Kodi's way of sending request headers: url|Name=value&Name=value
    const h = Object.entries(src.headers ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return h ? `${src.url}|${h}` : src.url;
  }
  // a DVD folder: Kodi plays it with its own DVD player (and the disc's menus), reading the folder's
  // files from /api/disc
  if (src.file && src.disc === "dvd") return `http://${host}/api/disc/${playback.token({ file: src.file })}/VIDEO_TS/VIDEO_TS.IFO`;
  if (!src.file || src.disc === "bluray") return null;
  // one film in several files: Kodi plays them as one
  if (src.parts && src.parts.length > 1) return "stack://" + src.parts.map((f) => media(f).replace(/,/g, ",,")).join(" , ");
  return media(src.file);
}

// a subtitle file as it is (Kodi reads .srt/.ass itself)
app.get("/api/raw/:tok/:name", async (req: Req, reply: FastifyReply) => {
  const src = playback.source(req.params.tok);
  if (!src?.file || !fs.existsSync(src.file)) throw new HttpError(404, "Not found.");
  return reply.header("Content-Type", "application/octet-stream").send(fs.createReadStream(src.file));
});

app.get("/api/media/:tok/:name", async (req: Req, reply: FastifyReply) => mediaFile(req, reply));

// the files of a DVD folder, for Kodi's DVD player: it opens VIDEO_TS.IFO, lists the folder (as a
// web server's folder listing) and reads the files beside it
/** A path under root, matched part by part without regard to case (VIDEO_TS / video_ts); null when
 *  it isn't there or would leave root. */
function underRoot(root: string, rel: string): string | null {
  let cur = root;
  for (const part of rel.split("/").filter(Boolean)) {
    if (part === "." || part === "..") return null;
    const exact = path.join(cur, part);
    if (fs.existsSync(exact)) { cur = exact; continue; }
    if (!fs.existsSync(cur) || !fs.statSync(cur).isDirectory()) return null;
    const hit = fs.readdirSync(cur).find((n) => n.toUpperCase() === part.toUpperCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

const discFile = async (req: Req, reply: FastifyReply) => {
  const src = playback.source(req.params.tok);
  if (!src?.file) throw new HttpError(404, "Not found.");
  const root = path.resolve(src.file);
  const rel = String((req.params as Record<string, string>)["*"] ?? "");
  const full = underRoot(root, rel);
  if (!full) throw new HttpError(404, "Not found.");
  if (fs.statSync(full).isDirectory()) {
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const rows = fs.readdirSync(full, { withFileTypes: true }).filter((e) => !e.name.startsWith("."))
      .map((e) => `<a href="${encodeURIComponent(e.name)}${e.isDirectory() ? "/" : ""}">${esc(e.name)}${e.isDirectory() ? "/" : ""}</a>`);
    return reply.header("Content-Type", "text/html; charset=utf-8")
      .send(`<html><head><title>Index of /${esc(rel)}</title></head><body><h1>Index of /${esc(rel)}</h1><pre>\n${rows.join("\n")}\n</pre></body></html>`);
  }
  return mediaFile(req, reply, full);
};
app.get("/api/disc/:tok", discFile);
app.get("/api/disc/:tok/*", discFile);
app.get("/api/media/:tok", async (req: Req, reply: FastifyReply) => mediaFile(req, reply));

async function mediaFile(req: Req, reply: FastifyReply, file?: string) {
  const src = file ? { file } : playback.source(req.params.tok);
  if (!src?.file) throw new HttpError(404, "Not found.");
  const st = fs.statSync(src.file);
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  const type = playback.mime(src.file);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size) return reply.code(416).header("Content-Range", `bytes */${st.size}`).send();
    reply.code(206).headers({ "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
    return reply.send(fs.createReadStream(src.file, { start, end }));
  }
  reply.headers({ "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": st.size });
  return reply.send(fs.createReadStream(src.file));
}

app.get("/api/stream/:tok", (req: Req, reply: FastifyReply) => {
  const src = playback.source(req.params.tok);
  if (!src) {
    void reply.code(404).send({ error: "Not found." });
    return;
  }
  reply.hijack();
  const start = Math.max(0, Number(req.query.start ?? 0) || 0);
  playback.stream(src, start, req.query, reply.raw, (fn) => req.raw.on("close", fn), req.params.tok).catch((e) => {
    log("stream", String(e?.message ?? e));
    if (!reply.raw.headersSent) reply.raw.writeHead(500, { "Content-Type": "text/plain" });
    reply.raw.end(String(e?.message ?? e));
  });
});

app.get("/api/stream-error/:tok", async (req: Req) => ({ error: playback.streamErrors.get(req.params.tok) ?? "" }));

app.get("/api/seek/:tok", async (req: Req) => {
  const src = playback.source(req.params.tok);
  if (!src) throw new HttpError(404, "Not found.");
  const t = Math.max(0, Number(req.query.t ?? 0) || 0);
  return { start: req.query.v === "copy" ? await playback.keyframeBefore(src, t, req.query.after === "1") : t };
});

app.get("/api/subs/:tok/:name", async (req: Req, reply: FastifyReply) => {
  const src = playback.source(req.params.tok);
  if (!src) throw new HttpError(404, "Not found.");
  const m = req.params.name.match(/^(\d+)\.vtt$/);
  const text = await playback.subtitles(src, m ? Number(m[1]) : null);
  return reply.header("Content-Type", "text/vtt; charset=utf-8").send(text);
});

app.post("/api/progress", async (req: Req) => {
  const p = who(req);
  const { id, position, duration, ended } = body(req);
  if (typeof id !== "string") throw new HttpError(400, "No id.");
  views.setProgress(p, id, Number(position) || 0, Number(duration) || 0, ended === true);
  return { ok: true };
});

app.post("/api/watched", async (req: Req) => {
  const p = who(req);
  views.setWatched(p, String(body(req).id ?? ""), body(req).watched === true);
  return { ok: true };
});

app.post("/api/favourite", async (req: Req) => {
  const p = who(req);
  return { favourite: views.toggleFavourite(p, String(body(req).id ?? "")) };
});

// --- pictures ----------------------------------------------------------------------------

app.get("/img/:sig", async (req: Req, reply: FastifyReply) => {
  const src = req.query.u ?? "";
  if (!valid(req.params.sig, src)) return reply.code(403).send();
  const file = await picture(src, Math.max(60, Math.min(2560, Number(req.query.w ?? 500) || 500)));
  if (!file) return reply.code(404).send();
  return reply.headers({ "Content-Type": "image/webp", "Cache-Control": "public, max-age=2592000, immutable" }).send(fs.createReadStream(file));
});

// --- settings: libraries, server, matching -------------------------------------------------

app.get("/api/settings", async (req) => {
  settingsPerson(req);
  const s: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS)) s[k] = setting(k);
  s.tmdb_key = s.tmdb_key ? "••••••••" : "";
  return { settings: s, folders: lib.folders(), status: lib.status, counts: lib.counts(), tmdb: !!tmdb.key(), version: VERSION };
});

app.post("/api/settings", async (req: Req) => {
  settingsPerson(req);
  const { key, value } = body(req);
  if (!(key in DEFAULTS) || typeof value !== typeof DEFAULTS[key]) throw new HttpError(400, "Unknown setting.");
  setSetting(key, value);
  if (key === "language" || key === "tmdb_key") void lib.enrich(true);
  return { ok: true };
});

app.get("/api/dirs", async (req: Req) => {
  admin(req);
  return lib.browseDir(req.query.path ?? "/");
});

app.post("/api/folders", async (req: Req) => {
  admin(req);
  const { path: p, kind } = body(req);
  if (!["films", "series", "music"].includes(kind)) throw new HttpError(400, "Say what the folder holds.");
  const r = lib.addFolder(String(p ?? ""), kind);
  if (typeof r === "string") throw new HttpError(400, r);
  return r;
});

app.delete("/api/folders/:id", async (req: Req) => {
  admin(req);
  lib.removeFolder(Number(req.params.id));
  return { ok: true };
});

app.post("/api/scan", async (req) => {
  settingsPerson(req);
  void lib.scan();
  return { ok: true };
});

app.get("/api/match", async (req: Req) => {
  settingsPerson(req);
  const r = lib.getRow(req.query.id ?? "");
  if (!r || (r.kind !== "film" && r.kind !== "series")) throw new HttpError(404, "Not found.");
  const q = (req.query.q ?? r.title).trim();
  const found = await tmdb.search(r.kind, q);
  return { query: q, results: found.map((f) => ({ ...f, poster: img(f.poster) })) };
});

app.post("/api/match", async (req: Req) => {
  settingsPerson(req);
  const ok = await lib.fixMatch(String(body(req).id ?? ""), Number(body(req).tmdb));
  if (!ok) throw new HttpError(400, "Couldn't change it.");
  return { ok: true };
});

app.post("/api/age", async (req: Req) => {
  // only admins: someone with an age limit and Change settings could otherwise lift their own
  admin(req);
  const age = body(req).age;
  if (age !== null && !(ages.LIMITS as readonly unknown[]).includes(age) && !(typeof age === "number" && age >= 0 && age <= 18)) throw new HttpError(400, "Not an age.");
  if (!lib.setAge(String(body(req).id ?? ""), age as number | null)) throw new HttpError(404, "Not found.");
  return { ok: true };
});

// --- a film's or series' poster, and removing it from the library ---------------------------

app.get("/api/posters", async (req: Req) => {
  settingsPerson(req);
  const r = lib.getRow(req.query.id ?? "");
  if (!r || (r.kind !== "film" && r.kind !== "series")) throw new HttpError(404, "Not found.");
  const t = lib.data(r).tmdb;
  if (!t) return { posters: [] };
  return { posters: (await tmdb.posters(r.kind, Number(t))).map((p) => ({ ...p, picture: img(p.url) })) };
});

app.post("/api/poster", async (req: Req) => {
  settingsPerson(req);
  const url = String(body(req).url ?? "");
  if (!/^https:\/\/image\.tmdb\.org\//.test(url)) throw new HttpError(400, "That isn't a TMDb poster.");
  if (!lib.choosePoster(String(body(req).id ?? ""), url)) throw new HttpError(404, "Not found.");
  return { ok: true };
});

app.post("/api/remove", async (req: Req) => {
  const p = who(req);
  if (!p.canDelete) throw new HttpError(403, "Ask an admin to let you remove things from the library.");
  if (!lib.hide(String(body(req).id ?? ""), body(req).restore !== true)) throw new HttpError(404, "Not found.");
  return { ok: true };
});

app.get("/api/removed", async (req: Req) => {
  settingsPerson(req);
  return { items: lib.hiddenRows().map((r) => ({ id: r.id, kind: r.kind, title: r.title, year: r.year, file: r.file })) };
});

// --- people --------------------------------------------------------------------------------

app.get("/api/people/all", async (req) => {
  admin(req);
  return {
    people: people.list(), addons: addons.enabledIds().map((id) => ({ id, name: addons.manifests.get(id)?.name ?? id })), apps: people.knownApps(),
    devices: people.devices().map(({ id, name, seen }) => ({ id, name, seen })),
  };
});

app.post("/api/people", async (req: Req) => {
  admin(req);
  return people.add(String(body(req).name ?? "Person"));
});

app.patch("/api/people/:id", async (req: Req) => {
  const me = who(req);
  const change = body(req);
  const self = me.id === req.params.id;
  // everyone may rename themselves and pick a colour; the rest is for admins
  if (!me.admin && (!self || Object.keys(change).some((k) => !["name", "color"].includes(k)))) throw new HttpError(403, "Only an admin can do that.");
  return people.update(req.params.id, change);
});

app.delete("/api/people/:id", async (req: Req) => {
  admin(req);
  if (!people.remove(req.params.id)) throw new HttpError(400, "The last admin can't be removed.");
  return { ok: true };
});

app.post("/api/people/:id/pin", async (req: Req) => {
  const me = who(req);
  if (!me.admin && me.id !== req.params.id) throw new HttpError(403, "Only an admin can do that.");
  const pin = body(req).pin === null ? null : String(body(req).pin ?? "");
  if (!people.setPin(req.params.id, pin)) throw new HttpError(400, "A PIN is four digits.");
  return { ok: true };
});

// --- add-ons and the Store -------------------------------------------------------------------

function addonView(id: string, p: people.Person) {
  const m = addons.manifests.get(id);
  const e = store.find(id);
  const base = m ?? e;
  if (!base) return null;
  const st = addons.state(id);
  return {
    id, name: base.name, version: m?.version ?? e?.version ?? "", storeVersion: e?.version ?? "", author: base.author, description: base.description,
    games: !!(m?.games ?? e?.games), installed: !!m, builtin: !!m?.builtin, enabled: !!m && st.enabled, error: m?.error ?? "",
    status: store.status(id), busy: store.store.busy.has(id), internet: (m?.permissions ?? e?.permissions ?? []).includes("internet"),
    hosts: m?.hosts ?? e?.hosts ?? [], hostsFromSettings: !!(m?.hosts_from_settings ?? e?.hosts_from_settings),
    settings: p.admin && m ? m.settings.map((s) => ({ ...s, value: s.type === "password" ? (addons.settingsOf(id)[s.key] ? "set" : "") : addons.settingsOf(id)[s.key] })) : [],
    log: p.admin ? (addons.logs.get(id) ?? []).slice(-30) : [],
  };
}

app.get("/api/addons", async (req) => {
  const p = who(req);
  void store.refresh();
  const ids = new Set([...addons.manifests.keys(), ...store.store.entries.filter((e) => e.type !== "theme").map((e) => e.id)]);
  return {
    addons: [...ids].map((id) => addonView(id, p)).filter(Boolean),
    store: { loading: store.store.loading, error: store.store.error }, admin: p.admin, canInstall: p.canInstall,
  };
});

app.get("/api/addon", async (req: Req) => {
  const p = who(req);
  if (!store.store.entries.length) await store.refresh();
  const v = addonView(req.query.id ?? "", p);
  if (!v) throw new HttpError(404, "There's no such add-on.");
  return v;
});

app.post("/api/addon/:action", async (req: Req) => {
  // installing and turning add-ons on and off: admins and those allowed to; their settings: admins
  if (req.params.action === "setting") admin(req);
  else installer(req);
  const id = String(body(req).id ?? "");
  switch (req.params.action) {
    case "install": {
      const err = await store.install(id);
      if (err) throw new HttpError(502, err);
      return { ok: true };
    }
    case "enable": {
      const err = addons.enable(id, body(req).internet === true);
      if (err === "needs_internet") return { needsInternet: true, hosts: addons.manifests.get(id)?.hosts ?? [], hostsFromSettings: addons.manifests.get(id)?.hosts_from_settings };
      if (err) throw new HttpError(400, err);
      browse.refresh(id, true);
      return { ok: true };
    }
    case "disable":
      addons.disable(id);
      return { ok: true };
    case "remove":
      if (!store.uninstall(id)) throw new HttpError(400, "Built-in add-ons can't be removed.");
      browse.forget(id);
      return { ok: true };
    case "setting": {
      if (!addons.setSetting(id, String(body(req).key ?? ""), body(req).value)) throw new HttpError(400, "That setting can't be saved.");
      browse.forget(id);
      browse.refresh(id, true);
      return { ok: true };
    }
    case "refresh":
      browse.refresh(id, true);
      return { ok: true };
  }
  throw new HttpError(404, "Unknown action.");
});

// --- themes: how Korie looks on the TVs ------------------------------------------------------

app.get("/api/themes", async (req) => {
  const p = who(req);
  void store.refresh();
  const have = themes.list();
  const inStore = store.store.entries.filter((e) => e.type === "theme");
  return {
    themes: have.map((t) => {
      const e = inStore.find((x) => x.id === t.id);
      return { id: t.id, name: t.name, version: t.version, author: t.author, builtin: t.builtin, installed: true,
        update: !!e && store.newer(e.version, t.version), description: e?.description ?? "", files: t.files };
    }),
    store: inStore.filter((e) => !have.some((t) => t.id === e.id)).map((e) => ({ id: e.id, name: e.name, version: e.version, author: e.author, description: e.description, installed: false })),
    admin: p.admin, canInstall: p.canInstall,
  };
});

app.get("/api/themes/:id/:name", async (req: Req, reply: FastifyReply) => {
  who(req);
  const f = themes.file(req.params.id, req.params.name);
  if (!f) return reply.code(404).send();
  return reply.headers({ "Cache-Control": "no-cache" }).send(fs.createReadStream(f));
});

app.post("/api/theme/:action", async (req: Req) => {
  installer(req);
  const id = String(body(req).id ?? "");
  if (req.params.action === "install") {
    const err = await store.install(id);
    if (err) throw new HttpError(502, err);
    return { ok: true };
  }
  if (req.params.action === "remove") {
    if (!themes.remove(id)) throw new HttpError(400, "The themes Korie comes with can't be removed.");
    return { ok: true };
  }
  throw new HttpError(404, "Unknown action.");
});

// --- the web client ---------------------------------------------------------------------------

if (fs.existsSync(CLIENT_DIR)) {
  await app.register(fastifyStatic, { root: CLIENT_DIR, prefix: "/", wildcard: true, setHeaders: (res: any, file: string) => {
    const v = file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
    if (typeof res.setHeader === "function") res.setHeader("Cache-Control", v);
    else res.header("Cache-Control", v);
  } });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/img/")) return reply.code(404).send({ error: "Not found." });
    return reply.header("Cache-Control", "no-cache").sendFile("index.html");
  });
} else {
  log("http", `no web client at ${CLIENT_DIR} (build it with npm run build in client/)`);
}

// --- start ----------------------------------------------------------------------------------

people.ensureFirst();
addons.scan();
browse.load();
await app.listen({ port: PORT, host: "0.0.0.0" });
log("korie", `Korie ${VERSION} on http://0.0.0.0:${PORT} (${tmdb.key() ? "TMDb on" : "no TMDb key"})`);
startDiscovery();
browse.refreshAll();
setInterval(() => browse.refreshAll(), 5 * 60 * 1000).unref();
void store.refresh();
if (setting("scan_on_start")) void lib.scan();
// episodes from before Korie found intros (or added while it was off): looked at in the background
else void intros.findAll();
