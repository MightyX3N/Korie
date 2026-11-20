// What add-ons offer, sorted into Korie's own sections: rows for Home, Films,
// Series and Games, channels for Live TV, pages (categories), search, a
// series' seasons, and where something plays from.
//
// The server asks every add-on for its rows when it starts and every half hour
// after, and keeps the answer on disk. Clients always get the kept rows at
// once; they never wait for an add-on.
//
// Everything an add-on returns is checked here before anyone sees it: things
// with the wrong shape are dropped (and noted in the add-on's log), so one
// broken add-on can't break a screen.
import * as ages from "../ages.ts";
import fs from "node:fs";
import path from "node:path";
import { DATA, log } from "../config.ts";
import { emit } from "../events.ts";
import * as addons from "./manager.ts";
import * as people from "../people.ts";

export const SECTIONS = ["home", "films", "series", "live", "games"] as const;
export type Section = (typeof SECTIONS)[number];
const KINDS = new Set(["film", "series", "episode", "live", "page", "game"]);
const FRESH = 30 * 60 * 1000;
const DIR = path.join(DATA, "cache/browse");

export interface AItem {
  id: string; source: string; sourceId: string; kind: string; title: string; subtitle: string; year: string;
  runtime: number; overview: string; poster: string; backdrop: string; thumb: string; genres: string[];
  rating: number; director: string; cast: { name: string; role: string; photo: string }[]; data: unknown;
  seasons?: ASeason[]; series?: string;
  /** an episode: its series' name (from the add-on when the series itself isn't known yet), season and number */
  seriesTitle?: string; season?: number; episode?: number;
  /** its age rating, when the add-on gives one ("DK 11", "PG-13", or just an age) */
  cert?: string; age?: number | null;
}
export interface ASeason { n: number; title: string; episodes: AItem[] }
export interface ARow { id: string; title: string; items: AItem[] }

interface Sections { at: number; loading: boolean; error: string; rows: Record<Section, ARow[]> }

// A source is an add-on's id, or for an add-on with an account per person (Stremio), that person's
// own view of it: "korie.stremio@<person id>". Its items carry the source, so opening or playing one
// is done with the right person's account.
const sections = new Map<string, Sections>();

export function aidOf(src: string): string {
  const i = src.indexOf("@");
  return i < 0 ? src : src.slice(0, i);
}

function personOfSrc(src: string): string | null {
  const i = src.indexOf("@");
  return i < 0 ? null : src.slice(i + 1);
}

function perPerson(aid: string): boolean {
  return addons.manifests.get(aid)?.accounts?.who === "person";
}

/** The sources a person sees: every add-on, and their own view of the ones with a person's account. */
export function sources(pid?: string | null): string[] {
  const out: string[] = [];
  for (const aid of addons.enabledIds()) {
    // (one that only looks after something, like households, has nothing to watch)
    if (addons.manifests.get(aid)?.type === "service") continue;
    // an add-on with an account per person: their own view if they signed in (the house's things
    // in it too), otherwise the house's (Stremio add-ons added for everyone)
    if (!perPerson(aid)) out.push(aid);
    else out.push(pid && addons.account(aid, pid) ? `${aid}@${pid}` : aid);
  }
  return out;
}

/** The source a person's view of an add-on is: their own if it has accounts per person and they signed in. */
export function srcFor(aid: string, pid?: string | null): string {
  return pid && perPerson(aid) && addons.account(aid, pid) ? `${aid}@${pid}` : aid;
}

/** Every source there is: the add-ons, and everyone's own view of the per-person ones. */
function allSources(): string[] {
  const out: string[] = [];
  for (const aid of addons.enabledIds()) {
    if (addons.manifests.get(aid)?.type === "service") continue;
    out.push(aid);
    if (perPerson(aid)) for (const pid of addons.signedIn(aid)) out.push(`${aid}@${pid}`);
  }
  return out;
}

/** Calls an add-on for a source; pid: the person it's for (their DR profile, say). */
async function callFor(src: string, fn: string, args: unknown[], pid?: string | null): Promise<any> {
  const who = people.get(personOfSrc(src) ?? pid ?? "");
  const { ctx, owner } = addons.ctx(aidOf(src), who ? { id: who.id, name: who.name } : null);
  return addons.call(aidOf(src), fn, [...args, ctx], owner);
}
const items = new Map<string, AItem>();
const pages = new Map<string, { at: number; loading: boolean; error: string; title: string; rows: ARow[] }>();

// --- checking what add-ons send -----------------------------------------------------

function s(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "";
}
/** text an add-on gave, with HTML's character codes (&amp; &#39; &#xA;) turned into the characters */
function t(v: unknown, max = 2000): string {
  const x = s(v, max * 2);
  if (!x.includes("&")) return x.slice(0, max);
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return x.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c: string) => {
    if (c[0] === "#") {
      const code = c[1] === "x" || c[1] === "X" ? parseInt(c.slice(2), 16) : Number(c.slice(1));
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return named[c.toLowerCase()] ?? m;
  }).slice(0, max);
}
function n(v: unknown): number {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : 0;
}
function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  // Lua's empty table, or a table with holes, arrives as an object
  if (v && typeof v === "object") return Object.keys(v).filter((k) => /^\d+$/.test(k)).sort((a, b) => +a - +b).map((k) => (v as any)[k]);
  return [];
}
function url(v: unknown): string {
  const x = s(v, 4000);
  return /^https?:\/\//.test(x) ? x : "";
}

export function item(aid: string, raw: unknown): AItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sid = s(r.id, 500);
  if (!sid) return null;
  const kind = KINDS.has(s(r.kind)) ? s(r.kind) : "film";
  const it: AItem = {
    id: `${aid}/${sid}`, source: aid, sourceId: sid, kind, title: t(r.title, 300) || "Untitled", subtitle: t(r.subtitle, 300),
    year: s(r.year, 10), runtime: n(r.runtime), overview: t(r.overview, 5000), poster: url(r.poster), backdrop: url(r.backdrop),
    thumb: url(r.thumb) || url(r.still), genres: list(r.genres).map((g) => t(g, 60)).filter(Boolean).slice(0, 10),
    rating: n(r.rating), director: s(r.director, 200),
    cast: list(r.cast).map((c: any) => Array.isArray(c) ? { name: s(c[0], 100), role: s(c[1], 100), photo: "" } : { name: s(c?.name, 100), role: s(c?.role, 100), photo: url(c?.photo) }).filter((c) => c.name).slice(0, 12),
    data: r.data ?? null,
  };
  const cert = s(r.cert, 40) || s(r.certification, 40);
  const age = typeof r.age === "number" && r.age >= 0 && r.age <= 18 ? Math.round(r.age) : ages.ageOf(cert);
  if (age !== null) {
    it.age = age;
    it.cert = cert || ages.label(age);
  }
  if (kind === "episode" && r.series) it.series = `${aid}/${s(r.series, 500)}`;
  if (kind === "episode") {
    if (t(r.series_title, 300)) it.seriesTitle = t(r.series_title, 300);
    if (n(r.season)) it.season = n(r.season);
    if (n(r.episode) || n(r.n)) it.episode = n(r.episode) || n(r.n);
  }
  const old = items.get(it.id);
  if (old?.seasons && !it.seasons) it.seasons = old.seasons; // keep what's known already
  if (old && kind === "episode") {
    it.seriesTitle ??= old.seriesTitle;
    it.season ??= old.season;
    it.episode ??= old.episode;
  }
  items.set(it.id, it);
  return it;
}

function rows(aid: string, v: unknown, from: string): ARow[] {
  const out: ARow[] = [];
  for (const [i, r] of list(v).entries()) {
    if (!r || typeof r !== "object") {
      addons.logs.get(aidOf(aid))?.push(`${from}: row ${i + 1} isn't a table, left out`);
      continue;
    }
    const its = list((r as any).items).map((x) => item(aid, x)).filter((x): x is AItem => !!x);
    if (its.length) out.push({ id: s((r as any).id) || s((r as any).title) || String(i), title: s((r as any).title, 200), items: its });
  }
  return out;
}

function sectionsFrom(aid: string, res: any): Record<Section, ARow[]> {
  const out = {} as Record<Section, ARow[]>;
  for (const k of SECTIONS) {
    if (k === "live") {
      const its = list(res?.live).map((x) => item(aid, x)).filter((x): x is AItem => !!x);
      out.live = its.length ? [{ id: "live", title: addons.manifests.get(aidOf(aid))?.name ?? aid, items: its }] : [];
    } else {
      out[k] = rows(aid, res?.[k], `browse().${k}`);
    }
  }
  return out;
}

// --- sections ---------------------------------------------------------------------------

function file(key: string): string {
  return path.join(DIR, key.replace(/[^a-z0-9._-]/gi, "_") + ".json");
}

export function load(): void {
  for (const aid of allSources()) {
    try {
      const saved = JSON.parse(fs.readFileSync(file(aid), "utf8"));
      // rows kept by an older version of the add-on are fetched again at once
      const same = saved.version === addons.manifests.get(aidOf(aid))?.version;
      sections.set(aid, { at: same ? saved.at ?? 0 : 0, loading: false, error: "", rows: sectionsFrom(aid, saved.res) });
      void buildCatalogue(aid);
    } catch {
      /* first time */
    }
  }
}

export function refresh(aid: string, force = false): void {
  let sec = sections.get(aid);
  if (!sec) {
    sec = { at: 0, loading: false, error: "", rows: { home: [], films: [], series: [], live: [], games: [] } };
    sections.set(aid, sec);
  }
  if (sec.loading || (!force && Date.now() - sec.at < FRESH)) return;
  const st = sec;
  st.loading = true;
  const t0 = Date.now();
  void (async () => {
    try {
      if (!(await addons.has(aidOf(aid), "browse"))) {
        st.at = Date.now();
        return;
      }
      const res = await callFor(aid, "browse", []);
      if (res && typeof res === "object" && !res.error) {
        st.rows = sectionsFrom(aid, res);
        st.at = Date.now();
        st.error = "";
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(file(aid), JSON.stringify({ at: st.at, version: addons.manifests.get(aidOf(aid))?.version, res }));
        log("browse", `${aid}: fresh rows in ${Date.now() - t0} ms`);
        void buildCatalogue(aid);
      } else {
        st.error = s(res?.error) || "nothing came back";
      }
    } catch (e) {
      st.error = e instanceof Error ? e.message : String(e);
      log("browse", `${aid}: ${st.error}`);
    } finally {
      st.loading = false;
      emit("browse");
    }
  })();
}

/** An add-on asked again: for an add-on with a person's account, everyone's view of it. */
export function refreshAddon(aid: string, force = false): void {
  if (perPerson(aid)) for (const pid of addons.signedIn(aid)) refresh(`${aid}@${pid}`, force);
  else refresh(aid, force);
}

export function refreshAll(force = false): void {
  for (const src of allSources()) refresh(src, force);
}

/** An add-on (all its sources), or one person's view of it (aid@person). */
export function forget(aid: string): void {
  for (const k of [...sections.keys()]) {
    if (k !== aid && !(aid.indexOf("@") < 0 && k.startsWith(aid + "@"))) continue;
    sections.delete(k);
    catalogues.delete(k);
    try {
      fs.unlinkSync(file(k));
    } catch {
      /* none */
    }
  }
  for (const k of [...mine.keys()]) if (k.startsWith(aidOf(aid) + "#")) mine.delete(k);
  for (const k of [...searches.keys()]) searches.delete(k);
  emit("browse");
}

export interface SectionView { addon: string; aid: string; name: string; rows: ARow[]; loading: boolean; error: string }

/** A section's rows from every source the person may see (pid: whose; allowed: by add-on id). */
export function section(sec: Section, allowed: (aid: string) => boolean, pid?: string | null): SectionView[] {
  const out: SectionView[] = [];
  for (const src of sources(pid)) {
    const aid = aidOf(src);
    if (!allowed(aid)) continue;
    refresh(src);
    const st = sections.get(src)!;
    let rows = st.rows[sec] ?? [];
    // rows an admin hid for this source (one person's Stremio catalogues)
    const hideRows = new Set(addons.hidden(src));
    if (hideRows.size) rows = rows.filter((r) => !hideRows.has(r.id));
    if (sec === "live") {
      // channels an admin hid, in the order they chose
      const hide = new Set(addons.hidden(aid));
      rows = rows.map((r) => ({ ...r, items: ordered(aid, r.items.filter((a) => !hide.has(a.id))) })).filter((r) => r.items.length);
    }
    // a house account's rows for this person's profile (DR's Continue watching, My list)
    if (sec === "home" && pid) rows = [...mineRows(src, pid), ...rows];
    out.push({ addon: src, aid, name: addons.manifests.get(aid)?.name ?? aid, rows, loading: st.loading && !rows.length, error: st.error });
  }
  return out;
}

// --- a person's own rows from a house account (their DR profile's Continue watching) --------------

const mine = new Map<string, { at: number; loading: boolean; rows: ARow[] }>();
const MINE_FRESH = 5 * 60 * 1000;

function mineRows(src: string, pid: string): ARow[] {
  const aid = aidOf(src);
  const m = addons.manifests.get(aid);
  if (!m?.accounts || m.accounts.who !== "house" || !addons.account(aid, "house")) return [];
  const key = `${aid}#${pid}`;
  let e = mine.get(key);
  if (!e) {
    e = { at: 0, loading: false, rows: [] };
    mine.set(key, e);
  }
  if (!e.loading && Date.now() - e.at > MINE_FRESH) {
    const entry = e;
    entry.loading = true;
    void (async () => {
      try {
        if (!(await addons.has(aid, "mine"))) return;
        const res = await callFor(aid, "mine", [], pid);
        entry.rows = rows(aid, res?.rows, "mine()");
      } catch (err) {
        log("browse", `${aid} mine() for a person: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        entry.at = Date.now();
        entry.loading = false;
        emit("browse");
      }
    })();
  }
  return e.rows;
}

/** A person's own rows were changed (they watched something): ask again next time. */
export function staleMine(aid: string, pid: string): void {
  const e = mine.get(`${aid}#${pid}`);
  if (e) e.at = 0;
}

/** How much an add-on offers and when it was last asked (the admin's add-on pages). */
export function stats(aid: string): { films: number; series: number; live: number; games: number; categories: number; at: number; loading: boolean; error: string } {
  if (perPerson(aid)) {
    // each person's own view: the biggest, and any problem
    const all = addons.signedIn(aid).map((pid) => stats(`${aid}@${pid}`));
    const sum = { films: 0, series: 0, live: 0, games: 0, categories: 0, at: 0, loading: false, error: "" };
    for (const x of all) {
      for (const k of ["films", "series", "live", "games", "categories", "at"] as const) sum[k] = Math.max(sum[k], x[k]);
      sum.loading ||= x.loading;
      sum.error ||= x.error;
    }
    return sum;
  }
  const st = sections.get(aid);
  const c = catalogues.get(aid);
  const games = new Set<string>();
  for (const r of st?.rows.games ?? []) for (const a of r.items) games.add(a.id);
  return {
    films: c?.films.length ?? catalogue(aid, "film").length, series: c?.series.length ?? catalogue(aid, "series").length,
    live: st?.rows.live[0]?.items.length ?? 0, games: games.size, categories: c?.order.length ?? 0,
    at: st?.at ?? 0, loading: !!st?.loading, error: st?.error ?? "",
  };
}

/** An add-on's live channels, in its own order. */
/** Channels in the order an admin chose; ones they haven't placed keep the add-on's order, after. */
function ordered(aid: string, list: AItem[]): AItem[] {
  const order = addons.channelOrder(aid);
  if (!order.length) return list;
  const at = new Map(order.map((id, i) => [id, i]));
  return list.map((a, i) => ({ a, k: at.get(a.id) ?? order.length + i })).sort((x, y) => x.k - y.k).map((x) => x.a);
}

/** An add-on's live channels (all of them, hidden ones too), in the admin's order. */
export function channels(aid: string): AItem[] {
  const src = sections.get(aid) ? aid : [...sections.keys()].find((k) => aidOf(k) === aid && sections.get(k)?.rows.live[0]);
  return ordered(aid, (src && sections.get(src)?.rows.live[0]?.items) || []);
}

export interface AboutAct { call: string; value: string; label: string }
export interface About {
  sections: { title: string; text: string; items: { title: string; subtitle: string; remove: AboutAct | null }[]; add: { call: string; label: string; placeholder: string; help: string } | null }[];
  rows: { id: string; title: string; section: string }[];
}

/** Does one of the things about() offered (add a Stremio add-on, remove one): only those, with the
 *  value the admin typed; an address typed to add may be fetched for that one call. */
export async function act(aid: string, pid: string | null, fn: string, value: string): Promise<any> {
  const a = await about(aid, pid);
  const offered = new Set<string>();
  for (const sec of a?.sections ?? []) {
    if (sec.add) offered.add(sec.add.call);
    for (const i of sec.items) if (i.remove) offered.add(i.remove.call);
  }
  if (!offered.has(fn)) throw new Error("The add-on doesn't offer that.");
  const src = srcFor(aid, pid);
  const who = people.get(personOfSrc(src) ?? pid ?? "");
  const { ctx, owner } = addons.ctx(aid, who ? { id: who.id, name: who.name } : null);
  let host = "";
  try {
    host = new URL(value.trim().replace(/^stremio:\/\//, "https://")).hostname.toLowerCase();
  } catch {
    /* not an address */
  }
  const res = await addons.call(aid, fn, [value, ctx], owner, host ? [host] : []);
  if (res && typeof res === "object" && res.error) throw new Error(String(res.error));
  forget(src);
  refreshAddon(aid, true);
  return res;
}

/** What an add-on says about one source of its own for the admin page (Stremio: a person's add-ons and catalogues). */
export async function about(aid: string, pid?: string | null): Promise<About | null> {
  if (!(await addons.has(aid, "about"))) return null;
  const res = await callFor(srcFor(aid, pid), "about", [], pid);
  if (!res || typeof res !== "object") return null;
  if (res.error) throw new Error(String(res.error));
  return {
    sections: list(res.sections).map((x: any) => ({
      title: s(x?.title, 200), text: s(x?.text, 1000),
      items: list(x?.items).map((i: any) => ({
        title: s(i?.title, 200), subtitle: s(i?.subtitle, 300),
        remove: i?.remove && typeof i.remove === "object" && /^[a-z_]+$/.test(s(i.remove.call, 40)) ? { call: s(i.remove.call, 40), value: s(i.remove.value, 2000), label: s(i.remove.label, 40) || "Remove" } : null,
      })).filter((i) => i.title),
      add: x?.add && typeof x.add === "object" && /^[a-z_]+$/.test(s(x.add.call, 40))
        ? { call: s(x.add.call, 40), label: s(x.add.label, 200) || "Add", placeholder: s(x.add.placeholder, 200), help: s(x.add.help, 500) } : null,
    })).filter((x) => x.title),
    rows: list(res.rows).map((r: any) => ({ id: s(r?.id, 500), title: s(r?.title, 200), section: s(r?.section, 20) })).filter((r) => r.id && r.title),
  };
}

export function get(id: string): AItem | null {
  return items.get(id) ?? null;
}

/** An item known again from a snapshot (kept with someone's progress), after a restart. */
export function remember(a: AItem): void {
  if (a && typeof a.id === "string" && !items.has(a.id)) items.set(a.id, a);
}

// --- pages (an add-on's categories) -------------------------------------------------

export async function page(id: string, pid?: string | null): Promise<{ title: string; rows: ARow[]; error: string }> {
  const it = items.get(id);
  if (!it) return { title: "", rows: [], error: "This page isn't known any more. Go back and open it again." };
  let p = pages.get(id);
  if (p && Date.now() - p.at < FRESH) return p;
  try {
    const saved = JSON.parse(fs.readFileSync(file("page-" + id), "utf8"));
    if (!p) p = { at: saved.at, loading: false, error: "", title: saved.title || it.title, rows: rows(it.source, saved.rows, "page()") };
    pages.set(id, p);
    if (Date.now() - p.at < FRESH) return p;
  } catch {
    /* not kept */
  }
  try {
    const res = await callFor(it.source, "page", [{ id: it.sourceId, kind: "page", title: it.title, data: it.data }], pid);
    const fresh = { at: Date.now(), loading: false, error: s(res?.error), title: s(res?.title) || it.title, rows: rows(it.source, res?.rows, "page()") };
    pages.set(id, fresh);
    fs.writeFileSync(file("page-" + id), JSON.stringify({ at: fresh.at, title: fresh.title, rows: res?.rows ?? [] }));
    return fresh;
  } catch (e) {
    if (p) return p; // old rows beat an error
    return { title: it.title, rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// --- catalogue: everything an add-on has, and its categories --------------------------

/** An add-on's films and series (from its rows and from inside its category pages) and which of
 *  its categories each is in. A row of films or series is a category ("Julefilm", "Krimi"), and
 *  so is a category page ("Dokumentar"). Jellyfin's apps get the categories as genres, so they
 *  show as one row each under Genres. */
interface Catalogue { films: AItem[]; series: AItem[]; cats: Map<string, string[]>; order: string[]; generic: Set<string>; building: boolean }
const catalogues = new Map<string, Catalogue>();

function addTo(c: Catalogue, a: AItem, cat: string, seen: Set<string>): void {
  if (a.kind !== "film" && a.kind !== "series") return;
  if (!seen.has(a.id)) {
    seen.add(a.id);
    (a.kind === "film" ? c.films : c.series).push(a);
  }
  if (!cat) return;
  const list = c.cats.get(a.id) ?? [];
  if (!list.includes(cat)) list.push(cat);
  c.cats.set(a.id, list);
  if (!c.order.includes(cat)) c.order.push(cat);
}

async function buildCatalogue(aid: string): Promise<void> {
  const st = sections.get(aid);
  const old = catalogues.get(aid);
  if (!st || old?.building) return;
  const c: Catalogue = { films: [], series: [], cats: new Map(), order: [], generic: new Set(), building: true };
  if (!old) catalogues.set(aid, c);
  const seen = new Set<string>();
  const pagesToRead: AItem[] = [];
  for (const sec of ["films", "series"] as const) {
    for (const row of st.rows[sec] ?? []) {
      const real = row.items.filter((a) => a.kind === "film" || a.kind === "series");
      for (const a of real) addTo(c, a, row.title, seen);
      for (const a of row.items) if (a.kind === "page" && !pagesToRead.some((x) => x.id === a.id)) pagesToRead.push(a);
    }
  }
  // a category page's films and series: one page after the other, so the add-on isn't flooded
  for (const pg of pagesToRead) {
    try {
      const res = await page(pg.id);
      for (const row of res.rows) for (const a of row.items) addTo(c, a, pg.title, seen);
    } catch {
      /* this page stays out until next time */
    }
  }
  // categories that sort nothing are left out: an A-Z index, one that holds nearly everything,
  // or one with just a couple of things in it
  const size = new Map<string, number>();
  for (const list of c.cats.values()) for (const n of list) size.set(n, (size.get(n) ?? 0) + 1);
  const total = c.films.length + c.series.length;
  const useless = (n: string) => /^[a-zæøå0-9#](\s*[-–]\s*[a-zæøå0-9])?$/i.test(n.trim()) || (size.get(n) ?? 0) < 3 || (total >= 20 && (size.get(n) ?? 0) > total * 0.5);
  // a front-page row that's a taste of a bigger category ("Danske film", 16 of "Danske") goes
  // in favour of the whole category
  const members = new Map<string, Set<string>>();
  for (const [id, list] of c.cats) for (const n of list) (members.get(n) ?? members.set(n, new Set()).get(n)!).add(id);
  const part = (n: string) => {
    const a = members.get(n)!;
    for (const [m, b] of members) {
      if (m === n || b.size <= a.size || useless(m)) continue;
      let both = 0;
      for (const id of a) if (b.has(id)) both++;
      if (both >= a.size * 0.9) return true;
    }
    return false;
  };
  const drop = new Set([...members.keys()].filter((n) => useless(n) || part(n)));
  for (const [id, list] of c.cats) c.cats.set(id, list.filter((n) => !drop.has(n)));
  c.order = c.order.filter((n) => !drop.has(n));
  // with no categories at all, an add-on's own genres sort its things instead; one that nearly
  // everything has ("Film" on every film) sorts nothing
  for (const list of [c.films, c.series]) {
    const count = new Map<string, number>();
    for (const a of list) for (const g of new Set(a.genres)) count.set(g, (count.get(g) ?? 0) + 1);
    for (const [g, k] of count) if (list.length >= 10 && k > list.length * 0.6) c.generic.add(g);
  }
  c.building = false;
  catalogues.set(aid, c);
  log("browse", `${aid}: ${c.films.length} films, ${c.series.length} series in ${c.order.length} categories`);
  emit("browse");
}

/** The add-on's films or series: all of them, also those only inside its category pages. */
export function catalogue(aid: string, kind: "film" | "series"): AItem[] {
  const c = catalogues.get(aid);
  if (c && (c.films.length || c.series.length)) return kind === "film" ? c.films : c.series;
  // not built yet: what its rows show
  const st = sections.get(aid);
  const seen = new Set<string>();
  const out: AItem[] = [];
  for (const sec of ["films", "series"] as const) for (const row of st?.rows[sec] ?? []) for (const a of row.items) if (a.kind === kind && !seen.has(a.id)) { seen.add(a.id); out.push(a); }
  return out;
}

/** The add-on's categories in its own order, each with its films and series. */
export function categories(aid: string): { name: string; items: AItem[] }[] {
  const c = catalogues.get(aid);
  if (!c) return [];
  const by = new Map<string, AItem[]>(c.order.map((n) => [n, []]));
  for (const a of [...c.films, ...c.series]) for (const n of c.cats.get(a.id) ?? []) by.get(n)?.push(a);
  return c.order.map((name) => ({ name, items: by.get(name) ?? [] })).filter((x) => x.items.length);
}

/** An add-on film's or series' genres: its categories (or, without any, its own genres). */
export function genresOf(a: AItem): string[] {
  const c = catalogues.get(a.source);
  // an add-on with categories of its own is sorted by them alone (its tags would repeat them:
  // "Krimi" next to "Krimifilm og thrillers")
  if (c?.order.length) return c.cats.get(a.id) ?? [];
  return (a.genres ?? []).filter((g) => !c?.generic.has(g));
}

// --- search ------------------------------------------------------------------------------

const searches = new Map<string, Map<string, AItem[] | null>>();

/** What each source found (null: still asking), for the sources this person sees. */
export function search(q: string, allowed: (aid: string) => boolean, pid?: string | null): Map<string, AItem[] | null> {
  const key = q.toLowerCase().trim();
  let found = searches.get(key);
  if (!found) {
    found = new Map();
    searches.set(key, found);
    if (searches.size > 50) searches.delete(searches.keys().next().value!);
  }
  const mine = sources(pid);
  for (const src of mine) {
    if (found.has(src)) continue;
    found.set(src, null);
    const f = found;
    void (async () => {
      try {
        if (!(await addons.has(aidOf(src), "search"))) {
          f.delete(src);
          return;
        }
        const res = await callFor(src, "search", [q], pid);
        f.set(src, list(res?.items).map((x) => item(src, x)).filter((x): x is AItem => !!x));
      } catch {
        f.set(src, []);
      }
      emit("search");
    })();
  }
  const out = new Map<string, AItem[] | null>();
  for (const [k, v] of found) if (mine.includes(k) && allowed(aidOf(k))) out.set(k, v);
  return out;
}

// --- a series' seasons -----------------------------------------------------------------

/** A series known only by its id (an episode from DR's Continue watching names its series): the
 *  add-on is asked for it when it's opened. */
export function seriesById(id: string): AItem | null {
  const at = id.indexOf("/");
  if (at <= 0) return items.get(id) ?? null;
  const src = id.slice(0, at);
  if (!addons.manifests.get(aidOf(src)) || !addons.enabledIds().includes(aidOf(src))) return null;
  return items.get(id) ?? item(src, { id: id.slice(at + 1), kind: "series", title: "" });
}

export async function open(id: string, pid?: string | null): Promise<AItem> {
  const it = items.get(id);
  if (!it) throw new Error("This isn't known any more. Go back and open it again.");
  if (it.seasons?.length) return it;
  const res = await callFor(it.source, "open", [{ id: it.sourceId, kind: it.kind, title: it.title, data: it.data }], pid);
  if (res?.error) throw new Error(s(res.error));
  for (const k of ["overview", "poster", "backdrop", "year"] as const) {
    const v = k === "poster" || k === "backdrop" ? url(res?.[k]) : k === "overview" ? t(res?.[k], 5000) : s(res?.[k]);
    if (v && !it[k]) (it as any)[k] = v;
  }
  if (s(res?.title) && (!it.title || it.title === "Untitled")) it.title = t(res.title, 300);
  if (!it.thumb) it.thumb = it.backdrop || it.poster;
  if (!it.genres.length) it.genres = list(res?.genres).map((g) => s(g, 60)).filter(Boolean);
  it.seasons = list(res?.seasons).map((sn: any, i) => ({
    n: n(sn?.n) || (sn?.n === 0 ? 0 : i + 1),
    title: t(sn?.title, 100),
    episodes: list(sn?.episodes).map((e: any) => {
      const ep = item(it.source, { ...e, kind: "episode", series: it.sourceId, subtitle: e?.subtitle ?? "" });
      if (ep) Object.assign(ep, { season: n(sn?.n), episode: n(e?.n) });
      return ep;
    }).filter((x): x is AItem => !!x),
  })).filter((x) => x.episodes.length);
  return it;
}

// --- where it plays from ----------------------------------------------------------------

export interface PlayAnswer { url?: string; web?: string; live: boolean; subtitles: { url: string; title: string; language: string; default: boolean }[]; headers?: Record<string, string> }

export async function play(id: string, pid?: string | null): Promise<PlayAnswer> {
  const it = items.get(id);
  if (!it) throw new Error("This isn't known any more. Go back and open it again.");
  const res = await callFor(it.source, "play", [{ id: it.sourceId, kind: it.kind, title: it.title, data: it.data }], pid);
  if (!res || typeof res !== "object") throw new Error("the add-on gave no answer");
  if (res.error) throw new Error(s(res.error));
  if (url(res.web)) return { web: url(res.web), live: false, subtitles: [] };
  if (!url(res.url)) throw new Error("the add-on gave no address to play");
  const subtitles = list(res.subtitles).map((x: any) => ({ url: url(x?.url), title: s(x?.title, 100), language: s(x?.language, 20), default: x?.default === true })).filter((x) => x.url);
  const headers: Record<string, string> = {};
  if (res.headers && typeof res.headers === "object") for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers[k] = v;
  return { url: url(res.url), live: res.live === true || it.kind === "live", subtitles, headers };
}

// --- what people watch, told to the add-on (Stremio's Continue Watching, DR's) ---------------

const told = new Map<string, number>();

/** Someone watched an add-on's film or episode up to position (seconds): the add-on may keep it
 *  in step with its service. Told at most once a minute per thing, and when they stop. */
export function progress(id: string, pid: string, position: number, duration: number, stopped: boolean): void {
  const it = items.get(id);
  if (!it || (it.kind !== "film" && it.kind !== "episode")) return;
  const key = `${pid}|${id}`;
  if (!stopped && Date.now() - (told.get(key) ?? 0) < 60_000) return;
  told.set(key, Date.now());
  if (told.size > 2000) told.delete(told.keys().next().value!);
  const aid = aidOf(it.source);
  void (async () => {
    try {
      if (!(await addons.has(aid, "progress"))) return;
      const watched = duration > 0 && position >= duration * 0.92;
      await callFor(it.source, "progress", [{ id: it.sourceId, kind: it.kind, title: it.title, data: it.data, series: it.series ? items.get(it.series)?.sourceId ?? null : null }, { position, duration, watched, stopped }], pid);
      if (stopped) staleMine(aid, pid);
    } catch (e) {
      log("browse", `${aid} progress(): ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
}
