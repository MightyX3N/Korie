// What the web admin (/web/admin) needs beyond the routes the apps use: the Overview, the
// Libraries page's counts, the Server page and its log, where each person is signed in, and an
// add-on's own page.
import os from "node:os";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PORT, VERSION, recentLog, log } from "./config.ts";
import { emit } from "./events.ts";
import { setting } from "./db.ts";
import * as lib from "./library.ts";
import * as people from "./people.ts";
import * as watching from "./watching.ts";
import * as addons from "./addons/manager.ts";
import * as browse from "./addons/browse.ts";
import { discovery } from "./discovery.ts";
import * as tmdb from "./tmdb.ts";
import * as playback from "./playback.ts";

class AdminError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

function admin(req: FastifyRequest): people.Person {
  const h = req.headers.authorization ?? "";
  const p = people.fromToken(h.startsWith("Bearer ") ? h.slice(7) : "");
  if (!p) throw Object.assign(new AdminError(401, "Sign in first."), { statusCode: 401 });
  if (!p.admin) throw Object.assign(new AdminError(403, "Only an admin can do that."), { statusCode: 403 });
  return p;
}

/** The addresses this machine answers on (what to type in an app that doesn't find Korie). */
export function addresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out.length ? out : [`http://localhost:${PORT}`];
}

function addonTotals() {
  let films = 0, series = 0, live = 0;
  const liveFrom: string[] = [];
  for (const id of addons.enabledIds()) {
    const s = browse.stats(id);
    films += s.films;
    series += s.series;
    live += s.live;
    if (s.live) liveFrom.push(addons.manifests.get(id)?.name ?? id);
  }
  return { films, series, live, liveFrom };
}

/** Things worth a look: add-ons that failed, and problems the server noted in the last day. */
function problems() {
  const out: { title: string; text: string; addon?: string; level: "bad" | "busy" }[] = [];
  for (const id of addons.enabledIds()) {
    const s = browse.stats(id);
    const m = addons.manifests.get(id);
    if (s.error && !s.loading) out.push({ title: `${m?.name ?? id} couldn't get its ${m?.games ? "games" : "films and series"}`, text: s.error, addon: id, level: "bad" });
    if (addons.needsInternet(id)) out.push({ title: `${m?.name ?? id} may not use the internet yet`, text: "Turn it on again in Add-ons and allow it.", addon: id, level: "bad" });
  }
  for (const f of lib.folders()) if (f.error) out.push({ title: `Can't read ${f.path}`, text: f.error, level: "bad" });
  const day = Date.now() - 86_400_000;
  const seen = new Set<string>();
  // the add-ons' own failures are above already (their fetches are noted as net and browse lines)
  for (const l of [...recentLog].reverse()) {
    if (!l.bad || l.at < day || out.length >= 8 || l.area === "net" || l.area === "browse" || l.area === "addons") continue;
    const key = l.area + l.text.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: l.area === "stream" ? "A stream stopped" : `Problem (${l.area})`, text: l.text, level: "bad" });
  }
  if (lib.status.scanning) out.push({ title: "Looking through your folders", text: lib.status.text || "Finding new files.", level: "busy" });
  const missing = lib.missingDetails();
  if (missing && tmdb.key()) out.push({ title: "Getting posters and descriptions", text: `${missing} films and series still to do. Everything is already watchable.`, level: "busy" });
  return out;
}

export function register(app: FastifyInstance): void {
  app.get("/api/admin/overview", async (req) => {
    admin(req);
    const c = lib.counts();
    const t = addonTotals();
    return {
      name: setting("server_name"), version: VERSION, addresses: addresses(),
      counts: { films: c.film ?? 0, series: c.series ?? 0, albums: c.album ?? 0 },
      fromAddons: t, discovery: { korie: discovery.korie, jellyfin: discovery.jellyfin },
      watching: watching.list(), problems: problems(), folders: lib.folders().length,
    };
  });

  app.get("/api/admin/log", async (req) => {
    admin(req);
    return { lines: recentLog.slice(-400).reverse() };
  });

  app.get("/api/admin/server", async (req) => {
    admin(req);
    return {
      name: setting("server_name"), version: VERSION, addresses: addresses(), discovery: { korie: discovery.korie, jellyfin: discovery.jellyfin },
      tmdb: { works: !!tmdb.key(), own: !!setting("tmdb_key") }, language: setting("language"), scanOnStart: setting("scan_on_start"),
    };
  });

  app.get("/api/admin/folders", async (req) => {
    admin(req);
    const counts = lib.folderCounts();
    return { folders: lib.folders().map((f) => ({ ...f, counts: counts[f.id] ?? {} })), status: lib.status, missing: tmdb.key() ? lib.missingDetails() : 0 };
  });

  /** The folder picker: a folder's subfolders, how many video and music files each has, and which are in the library. */
  app.get("/api/admin/dirs", async (req) => {
    admin(req);
    const asked = String((req.query as Record<string, string>).path ?? "");
    const real = asked ? lib.findPath(asked) : null;
    if (asked && !real) return { path: asked, parent: null, dirs: [], missing: true };
    const d = lib.browseDir(real ?? "");
    const have = lib.folders();
    return {
      path: d.path, parent: d.parent, missing: false,
      dirs: d.dirs.map((name) => {
        const p = d.path.replace(/\/$/, "") + "/" + name;
        const f = have.find((x) => x.path === p);
        return { name, path: p, ...lib.countFiles(p), inLibrary: f ? f.kind : null };
      }),
      here: { ...lib.countFiles(d.path), inLibrary: have.find((x) => x.path === d.path)?.kind ?? null },
    };
  });

  app.get("/api/admin/sessions", async (req) => {
    admin(req);
    const id = String((req.query as Record<string, string>).person ?? "");
    return { sessions: people.sessionsOf(id) };
  });

  app.delete("/api/admin/sessions/:person/:id", async (req) => {
    admin(req);
    const { person, id } = req.params as Record<string, string>;
    if (!people.endSessionById(person, Number(id))) throw Object.assign(new AdminError(404, "That device isn't signed in any more."), { statusCode: 404 });
    return { ok: true };
  });

  app.get("/api/admin/addon", async (req) => {
    admin(req);
    const id = String((req.query as Record<string, string>).id ?? "");
    if (!addons.manifests.get(id)) throw Object.assign(new AdminError(404, "That add-on isn't installed."), { statusCode: 404 });
    const hide = new Set(addons.hidden(id));
    return { stats: browse.stats(id), channels: browse.channels(id).map((c) => ({ id: c.id, title: c.title, hidden: hide.has(c.id) })) };
  });

  // --- an add-on's accounts: the house's (with a profile per person) or each person's own ---

  const withAccounts = (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = String(b.id ?? (req.query as Record<string, string>).id ?? "");
    const m = addons.manifests.get(id);
    if (!m) throw Object.assign(new AdminError(404, "That add-on isn't installed."), { statusCode: 404 });
    if (!m.accounts) throw Object.assign(new AdminError(400, `${m.name} has no accounts.`), { statusCode: 400 });
    return { id, m, acc: m.accounts, b };
  };

  app.get("/api/admin/accounts", async (req) => {
    admin(req);
    const { id, acc } = withAccounts(req);
    const house = acc.who === "house" ? addons.account(id, "house") : null;
    return {
      who: acc.who, label: acc.label, help: acc.help, fields: acc.fields, profiles: acc.profiles,
      house: house ? { name: house.name, profiles: house.profiles, mapping: house.mapping, at: house.at } : null,
      people: people.list().map((p) => {
        const a = acc.who === "person" ? addons.account(id, p.id) : null;
        return { id: p.id, name: p.name, color: p.color, account: a ? { name: a.name, at: a.at } : null, mayUse: people.mayUseAddon(p, id) };
      }),
    };
  });

  // a person's accounts in the add-ons that have them (the People page)
  app.get("/api/admin/person-accounts", async (req) => {
    admin(req);
    const p = people.get(String((req.query as Record<string, string>).person ?? ""));
    if (!p) throw Object.assign(new AdminError(404, "There's no such person."), { statusCode: 404 });
    const out: { id: string; name: string; text: string; on: boolean }[] = [];
    for (const m of addons.manifests.values()) {
      if (!m.accounts || m.error || !addons.state(m.id).enabled) continue;
      if (m.accounts.who === "person") {
        const a = addons.account(m.id, p.id);
        out.push({ id: m.id, name: m.name, text: a ? `Signed in as ${a.name}` : "Not signed in", on: !!a });
      } else {
        const h = addons.account(m.id, "house");
        if (!h) continue;
        const prof = h.profiles.find((x) => x.id === h.mapping[p.id]);
        out.push({ id: m.id, name: m.name, text: prof ? `Uses ${m.name} profile ${prof.name}` : `No ${m.name} profile`, on: true });
      }
    }
    return { accounts: out };
  });

  app.post("/api/admin/accounts/login", async (req) => {
    admin(req);
    const { id, m, acc, b } = withAccounts(req);
    const owner = acc.who === "person" ? String(b.person ?? "") : "house";
    if (acc.who === "person" && !people.get(owner)) throw Object.assign(new AdminError(400, "Pick who signs in."), { statusCode: 400 });
    const fields: Record<string, string> = {};
    for (const f of acc.fields) fields[f.key] = String((b.fields as Record<string, unknown>)?.[f.key] ?? "").trim();
    if (acc.fields.some((f) => !fields[f.key])) throw Object.assign(new AdminError(400, "Fill in every field."), { statusCode: 400 });
    if (!(await addons.has(id, "login"))) throw Object.assign(new AdminError(400, `${m.name} can't sign in (it has no login()).`), { statusCode: 400 });
    const who = acc.who === "person" ? people.get(owner) : null;
    const { ctx } = addons.ctx(id, who ? { id: who.id, name: who.name } : null);
    addons.forgetCookies(id);
    let res: any;
    try {
      res = await addons.call(id, "login", [fields, ctx]);
    } catch (e) {
      throw Object.assign(new AdminError(502, `Couldn't sign in to ${m.name}: ${e instanceof Error ? e.message : String(e)}`), { statusCode: 502 });
    }
    if (!res || typeof res !== "object" || res.error || !res.account || typeof res.account !== "object") {
      throw Object.assign(new AdminError(400, String(res?.error ?? `${m.name} didn't sign in.`)), { statusCode: 400 });
    }
    const profiles = (Array.isArray(res.profiles) ? res.profiles : []).filter((x: any) => x && x.id != null).map((x: any) => ({ id: String(x.id), name: String(x.name ?? x.id), kid: x.kid === true }));
    addons.saveAccount(id, owner, { name: String(res.account.name ?? fields.email ?? ""), data: res.account.data ?? {}, profiles });
    log("addons", `${m.name}: ${owner === "house" ? "the house" : who?.name} signed in`);
    browse.forget(acc.who === "person" ? `${id}@${owner}` : id);
    browse.refreshAddon(id, true);
    emit("addons");
    return { ok: true, name: addons.account(id, owner)?.name, profiles };
  });

  app.post("/api/admin/accounts/logout", async (req) => {
    admin(req);
    const { id, acc, b } = withAccounts(req);
    const owner = acc.who === "person" ? String(b.person ?? "") : "house";
    addons.removeAccount(id, owner);
    browse.forget(acc.who === "person" ? `${id}@${owner}` : id);
    browse.refreshAddon(id, true);
    emit("addons");
    return { ok: true };
  });

  app.post("/api/admin/accounts/profile", async (req) => {
    admin(req);
    const { id, b } = withAccounts(req);
    const person = String(b.person ?? "");
    if (!addons.setProfile(id, person, String(b.profile ?? ""))) throw Object.assign(new AdminError(400, "That profile isn't on the account."), { statusCode: 400 });
    browse.staleMine(id, person);
    emit("browse");
    return { ok: true };
  });

  // --- live channels: which show, and do they play ---

  app.post("/api/admin/addon/hidden", async (req) => {
    admin(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = String(b.id ?? "");
    if (!addons.manifests.get(id) || !Array.isArray(b.hidden)) throw Object.assign(new AdminError(400, "Say which channels to hide."), { statusCode: 400 });
    addons.setHidden(id, (b.hidden as unknown[]).map(String));
    emit("browse");
    return { ok: true };
  });

  app.post("/api/admin/addon/order", async (req) => {
    admin(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = String(b.id ?? "");
    if (!addons.manifests.get(id) || !Array.isArray(b.order)) throw Object.assign(new AdminError(400, "Say the channels' order."), { statusCode: 400 });
    addons.setChannelOrder(id, (b.order as unknown[]).map(String));
    emit("browse");
    return { ok: true };
  });

  // --- what the add-on says about one person's view of it (Stremio: their add-ons and catalogues) ---

  app.get("/api/admin/addon/about", async (req) => {
    admin(req);
    const q = req.query as Record<string, string>;
    const id = String(q.id ?? "");
    if (!addons.manifests.get(id)) throw Object.assign(new AdminError(404, "That add-on isn't installed."), { statusCode: 404 });
    const person = q.person ? people.get(q.person) : null;
    try {
      const a = await browse.about(id, person?.id ?? null);
      if (!a) return { about: null };
      const src = person && addons.manifests.get(id)?.accounts?.who === "person" ? `${id}@${person.id}` : id;
      const hide = new Set(addons.hidden(src));
      return { about: { ...a, rows: a.rows.map((r) => ({ ...r, hidden: hide.has(r.id) })) } };
    } catch (e) {
      return { about: null, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.post("/api/admin/addon/rows", async (req) => {
    admin(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = String(b.id ?? "");
    const m = addons.manifests.get(id);
    if (!m || !Array.isArray(b.hidden)) throw Object.assign(new AdminError(400, "Say which rows to hide."), { statusCode: 400 });
    const person = b.person ? people.get(String(b.person)) : null;
    const src = person && m.accounts?.who === "person" ? `${id}@${person.id}` : id;
    addons.setHidden(src, (b.hidden as unknown[]).map(String));
    emit("browse");
    return { ok: true };
  });

  app.post("/api/admin/addon/test", async (req) => {
    const p = admin(req);
    const id = String(((req.body ?? {}) as Record<string, unknown>).id ?? "");
    const list = browse.channels(id);
    if (!list.length) throw Object.assign(new AdminError(400, "This add-on has no live channels."), { statusCode: 400 });
    const results = await Promise.all(list.map(async (c) => {
      try {
        const ans = await browse.play(c.id, p.id);
        if (!ans.url) return { id: c.id, ok: false, error: "it gave no stream" };
        const r = await playback.tryStream({ url: ans.url, headers: ans.headers, live: true });
        if (!r.ok) log("stream", `${c.title} doesn't start: ${r.error}`);
        if (!r.ok && /403/.test(r.error)) return { id: c.id, ok: false, error: "said no (403): it only streams to its own country and thinks this server is outside it. A VPN on the server does that." };
        return { id: c.id, ...r };
      } catch (e) {
        return { id: c.id, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }));
    return { results };
  });
}
