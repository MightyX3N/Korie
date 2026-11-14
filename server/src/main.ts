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
import * as views from "./views.ts";
import * as addons from "./addons/manager.ts";
import * as browse from "./addons/browse.ts";
import * as store from "./addons/store.ts";
import * as playback from "./playback.ts";
import { img, picture, valid } from "./images.ts";
import { subscribe } from "./events.ts";
import { serverId } from "./ident.ts";
import { startDiscovery } from "./discovery.ts";

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

app.get("/api/hello", async () => ({ korie: true, id: serverId(), name: setting("server_name"), version: VERSION }));

app.get("/api/people", async () => people.list().map(({ id, name, color, hasPin }) => ({ id, name, color, hasPin })));

app.post("/api/login", async (req: Req) => {
  const { person, pin, device } = body(req);
  const p = people.get(String(person ?? ""));
  if (!p) throw new HttpError(404, "That person isn't here any more.");
  if (p.hasPin && !people.checkPin(p.id, String(pin ?? ""))) throw new HttpError(403, "Wrong PIN.");
  return { token: people.startSession(p.id, String(device ?? "")), person: p };
});

app.post("/api/logout", async (req) => {
  const h = req.headers.authorization ?? "";
  if (h.startsWith("Bearer ")) people.endSession(h.slice(7));
  return { ok: true };
});

app.get("/api/me", async (req) => {
  const p = who(req);
  return { person: p, server: { name: setting("server_name"), version: VERSION, id: serverId() }, games: hasGames(p) };
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
  const recentFilms = lib.recent("film", 20).map((r) => views.rowCard(p, r));
  if (recentFilms.length) rows.push({ id: "films", title: "Recently added films", kind: "poster", items: recentFilms });
  const recentSeries = lib.recent("series", 20).map((r) => views.rowCard(p, r));
  if (recentSeries.length) rows.push({ id: "series", title: "Recently added series", kind: "poster", items: recentSeries });
  const recentMusic = lib.recent("album", 20).map((r) => views.rowCard(p, r));
  if (recentMusic.length) rows.push({ id: "music", title: "Recently added music", kind: "square", items: recentMusic });
  const fav = views.favourites(p);
  if (fav.length) rows.push({ id: "favourites", title: "Favourites", kind: "poster", items: fav });
  for (const s of browse.section("home", allowed(p))) {
    for (const r of s.rows) rows.push({ id: `${s.addon}:${r.id}`, title: `${s.name}: ${r.title}`, kind: rowKind(r.items), items: r.items.map((a) => views.addonCard(p, a)), source: s.addon });
  }
  return { rows, empty: rows.length === 0, scanning: lib.status.scanning, status: lib.status.text };
});

function rowKind(items: browse.AItem[]): string {
  // links without pictures (DRTV's genre buttons) show as labelled tiles
  if (items.every((i) => !i.poster && !i.thumb && !i.backdrop)) return "text";
  const wide = items.filter((i) => ["episode", "live", "page"].includes(i.kind) || (!i.poster && (i.thumb || i.backdrop))).length;
  return wide * 2 > items.length ? "wide" : "poster";
}

const SORTS: Record<string, string> = { added: "added DESC, sort", title: "sort", year: "year DESC, sort", rating: "CAST(json_extract(data, '$.rating') AS REAL) DESC, sort" };

function grid(req: Req, kind: "film" | "series" | "album") {
  const p = who(req);
  const sort = SORTS[req.query.sort ?? "added"] ? req.query.sort ?? "added" : "added";
  const show = req.query.show ?? "all";
  let rows = (lib.rows(kind) as lib.Row[]);
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
    out.rows = (s?.rows ?? []).map((r) => ({ id: r.id, title: r.title, kind: rowKind(r.items), items: r.items.map((a) => views.addonCard(p, a)) }));
    out.status = s ? (s.rows.length ? "" : s.loading ? `Loading ${s.name}…` : s.error || `${s.name} has nothing here.`) : "This add-on isn't on.";
  } else {
    out.items = grid(req, kind);
    out.status = (out.items as unknown[]).length ? "" : lib.folders().some((f) => f.kind === sec)
      ? (lib.status.scanning ? "Looking through your folders…" : `No ${sec} found in your ${sec} folders yet.`)
      : `No ${sec} yet. Add a folder with ${sec} in Settings → Libraries.`;
  }
  return out;
}

app.get("/api/films", async (req: Req) => sectionView(req, "films", "film"));
app.get("/api/series", async (req: Req) => sectionView(req, "series", "series"));
app.get("/api/music", async (req: Req) => {
  const items = grid(req, "album");
  return { items, status: items.length ? "" : lib.folders().some((f) => f.kind === "music") ? "No music found in your music folders yet." : "No music yet. Add a folder with music in Settings → Libraries." };
});

app.get("/api/live", async (req) => {
  const p = who(req);
  const secs = browse.section("live", allowed(p));
  const rows = secs.filter((s) => s.rows.length).map((s) => ({ id: s.addon, title: s.name, kind: "wide", items: s.rows[0].items.map((a) => views.addonCard(p, a)) }));
  return { rows, status: rows.length ? "" : secs.some((s) => s.loading) ? "Loading channels…" : "No channels yet. Add-ons with live TV (DRTV, Stremio TV add-ons) show their channels here. Get them in the Store." };
});

app.get("/api/games", async (req) => {
  const p = who(req);
  const secs = browse.section("games", allowed(p)).filter((s) => addons.manifests.get(s.addon)?.games);
  const rows = secs.flatMap((s) => s.rows.map((r) => ({ id: `${s.addon}:${r.id}`, title: secs.length > 1 ? `${r.title} · ${s.name}` : r.title, kind: "poster", items: r.items.map((a) => views.addonCard(p, a)) })));
  const errors = secs.filter((s) => !s.rows.length && s.error).map((s) => `${s.name}: ${s.error}`);
  return { rows, status: rows.length ? "" : secs.some((s) => s.loading) ? "Loading games…" : errors.join("\n") || "No games yet. Type your RomM server in the RomM add-on's settings (Store → Installed → RomM)." };
});

app.get("/api/page", async (req: Req) => {
  const p = who(req);
  const pg = await browse.page(req.query.id ?? "");
  return { title: pg.title, rows: pg.rows.map((r) => ({ id: r.id, title: r.title, kind: rowKind(r.items), items: r.items.map((a) => views.addonCard(p, a)) })), status: pg.rows.length ? "" : pg.error || "Nothing here." };
});

app.get("/api/item", async (req: Req) => {
  const p = who(req);
  const id = req.query.id ?? "";
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
    const items = lib.rows(k).filter(match).slice(0, 40).map((r) => views.rowCard(p, r));
    if (items.length) groups.push({ id: k, title, items });
  }
  if (q.length >= 2) {
    for (const [aid, items] of browse.search(q, allowed(p))) {
      const name = addons.manifests.get(aid)?.name ?? aid;
      if (items === null) groups.push({ id: aid, title: name, items: [], loading: true });
      else if (items.length) groups.push({ id: aid, title: name, items: items.slice(0, 40).map((a) => views.addonCard(p, a)) });
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
  let next: string | null = null;
  if (row) {
    if (!row.file) throw new HttpError(400, "There's no file to play.");
    const d = lib.data(row);
    src = { file: row.file, disc: d.disc ?? null };
    subFiles = d.subs ?? [];
    if (row.kind === "episode") {
      const s = lib.getRow(row.parent ?? "");
      subtitle = `${s?.title ?? ""} · S${d.season}E${d.episode}`;
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
  let pl: playback.Plan;
  try {
    pl = await playback.plan(src, caps, audio, burn, subFiles, extra);
  } catch (e) {
    throw new HttpError(422, e instanceof Error ? e.message : String(e));
  }
  const prog = views.progressOf(p.id, id);
  return { ...pl, id, title, subtitle, resume: prog && !prog.watched ? prog.position : 0, next };
});

app.get("/api/media/:tok", async (req: Req, reply: FastifyReply) => {
  const src = playback.source(req.params.tok);
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
});

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
  return { start: req.query.v === "copy" ? await playback.keyframeBefore(src, t) : t };
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

// --- people --------------------------------------------------------------------------------

app.get("/api/people/all", async (req) => {
  admin(req);
  return { people: people.list(), addons: addons.enabledIds().map((id) => ({ id, name: addons.manifests.get(id)?.name ?? id })) };
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
  const ids = new Set([...addons.manifests.keys(), ...store.store.entries.map((e) => e.id)]);
  return {
    addons: [...ids].map((id) => addonView(id, p)).filter(Boolean),
    store: { loading: store.store.loading, error: store.store.error }, admin: p.admin,
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
  admin(req);
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
