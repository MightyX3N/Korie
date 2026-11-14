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
import fs from "node:fs";
import path from "node:path";
import { DATA, log } from "../config.ts";
import { emit } from "../events.ts";
import * as addons from "./manager.ts";

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
}
export interface ASeason { n: number; title: string; episodes: AItem[] }
export interface ARow { id: string; title: string; items: AItem[] }

interface Sections { at: number; loading: boolean; error: string; rows: Record<Section, ARow[]> }

const sections = new Map<string, Sections>();
const items = new Map<string, AItem>();
const pages = new Map<string, { at: number; loading: boolean; error: string; title: string; rows: ARow[] }>();

// --- checking what add-ons send -----------------------------------------------------

function s(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "";
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
    id: `${aid}/${sid}`, source: aid, sourceId: sid, kind, title: s(r.title, 300) || "Untitled", subtitle: s(r.subtitle, 300),
    year: s(r.year, 10), runtime: n(r.runtime), overview: s(r.overview, 5000), poster: url(r.poster), backdrop: url(r.backdrop),
    thumb: url(r.thumb) || url(r.still), genres: list(r.genres).map((g) => s(g, 60)).filter(Boolean).slice(0, 10),
    rating: n(r.rating), director: s(r.director, 200),
    cast: list(r.cast).map((c: any) => Array.isArray(c) ? { name: s(c[0], 100), role: s(c[1], 100), photo: "" } : { name: s(c?.name, 100), role: s(c?.role, 100), photo: url(c?.photo) }).filter((c) => c.name).slice(0, 12),
    data: r.data ?? null,
  };
  if (kind === "episode" && r.series) it.series = `${aid}/${s(r.series, 500)}`;
  const old = items.get(it.id);
  if (old?.seasons && !it.seasons) it.seasons = old.seasons; // keep what's known already
  items.set(it.id, it);
  return it;
}

function rows(aid: string, v: unknown, from: string): ARow[] {
  const out: ARow[] = [];
  for (const [i, r] of list(v).entries()) {
    if (!r || typeof r !== "object") {
      addons.logs.get(aid)?.push(`${from}: row ${i + 1} isn't a table, left out`);
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
      out.live = its.length ? [{ id: "live", title: addons.manifests.get(aid)?.name ?? aid, items: its }] : [];
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
  for (const aid of addons.enabledIds()) {
    try {
      const saved = JSON.parse(fs.readFileSync(file(aid), "utf8"));
      sections.set(aid, { at: saved.at ?? 0, loading: false, error: "", rows: sectionsFrom(aid, saved.res) });
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
      if (!(await addons.has(aid, "browse"))) {
        st.at = Date.now();
        return;
      }
      const res = await addons.call(aid, "browse", [addons.ctx(aid)]);
      if (res && typeof res === "object" && !res.error) {
        st.rows = sectionsFrom(aid, res);
        st.at = Date.now();
        st.error = "";
        fs.writeFileSync(file(aid), JSON.stringify({ at: st.at, res }));
        log("browse", `${aid}: fresh rows in ${Date.now() - t0} ms`);
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

export function refreshAll(force = false): void {
  for (const aid of addons.enabledIds()) refresh(aid, force);
}

export function forget(aid: string): void {
  sections.delete(aid);
  try {
    fs.unlinkSync(file(aid));
  } catch {
    /* none */
  }
  for (const k of [...searches.keys()]) searches.delete(k);
  emit("browse");
}

export interface SectionView { addon: string; name: string; rows: ARow[]; loading: boolean; error: string }

export function section(sec: Section, allowed: (aid: string) => boolean): SectionView[] {
  const out: SectionView[] = [];
  for (const aid of addons.enabledIds()) {
    if (!allowed(aid)) continue;
    refresh(aid);
    const st = sections.get(aid)!;
    out.push({ addon: aid, name: addons.manifests.get(aid)?.name ?? aid, rows: st.rows[sec] ?? [], loading: st.loading && !(st.rows[sec] ?? []).length, error: st.error });
  }
  return out;
}

export function get(id: string): AItem | null {
  return items.get(id) ?? null;
}

// --- pages (an add-on's categories) -------------------------------------------------

export async function page(id: string): Promise<{ title: string; rows: ARow[]; error: string }> {
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
    const res = await addons.call(it.source, "page", [{ id: it.sourceId, kind: "page", title: it.title, data: it.data }, addons.ctx(it.source)]);
    const fresh = { at: Date.now(), loading: false, error: s(res?.error), title: s(res?.title) || it.title, rows: rows(it.source, res?.rows, "page()") };
    pages.set(id, fresh);
    fs.writeFileSync(file("page-" + id), JSON.stringify({ at: fresh.at, title: fresh.title, rows: res?.rows ?? [] }));
    return fresh;
  } catch (e) {
    if (p) return p; // old rows beat an error
    return { title: it.title, rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// --- search ------------------------------------------------------------------------------

const searches = new Map<string, Map<string, AItem[] | null>>();

export function search(q: string, allowed: (aid: string) => boolean): Map<string, AItem[] | null> {
  const key = q.toLowerCase().trim();
  let found = searches.get(key);
  if (!found) {
    found = new Map();
    searches.set(key, found);
    if (searches.size > 50) searches.delete(searches.keys().next().value!);
    for (const aid of addons.enabledIds()) {
      found.set(aid, null);
      const f = found;
      void (async () => {
        try {
          if (!(await addons.has(aid, "search"))) {
            f.delete(aid);
            return;
          }
          const res = await addons.call(aid, "search", [q, addons.ctx(aid)]);
          f.set(aid, list(res?.items).map((x) => item(aid, x)).filter((x): x is AItem => !!x));
        } catch {
          f.set(aid, []);
        }
        emit("search");
      })();
    }
  }
  const out = new Map<string, AItem[] | null>();
  for (const [k, v] of found) if (allowed(k)) out.set(k, v);
  return out;
}

// --- a series' seasons -----------------------------------------------------------------

export async function open(id: string): Promise<AItem> {
  const it = items.get(id);
  if (!it) throw new Error("This isn't known any more. Go back and open it again.");
  if (it.seasons?.length) return it;
  const res = await addons.call(it.source, "open", [{ id: it.sourceId, kind: it.kind, title: it.title, data: it.data }, addons.ctx(it.source)]);
  if (res?.error) throw new Error(s(res.error));
  for (const k of ["overview", "poster", "backdrop", "year"] as const) {
    const v = k === "poster" || k === "backdrop" ? url(res?.[k]) : s(res?.[k]);
    if (v && !it[k]) (it as any)[k] = v;
  }
  if (!it.genres.length) it.genres = list(res?.genres).map((g) => s(g, 60)).filter(Boolean);
  it.seasons = list(res?.seasons).map((sn: any, i) => ({
    n: n(sn?.n) || (sn?.n === 0 ? 0 : i + 1),
    title: s(sn?.title, 100),
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

export async function play(id: string): Promise<PlayAnswer> {
  const it = items.get(id);
  if (!it) throw new Error("This isn't known any more. Go back and open it again.");
  const res = await addons.call(it.source, "play", [{ id: it.sourceId, kind: it.kind, title: it.title, data: it.data }, addons.ctx(it.source)]);
  if (!res || typeof res !== "object") throw new Error("the add-on gave no answer");
  if (res.error) throw new Error(s(res.error));
  if (url(res.web)) return { web: url(res.web), live: false, subtitles: [] };
  if (!url(res.url)) throw new Error("the add-on gave no address to play");
  const subtitles = list(res.subtitles).map((x: any) => ({ url: url(x?.url), title: s(x?.title, 100), language: s(x?.language, 20), default: x?.default === true })).filter((x) => x.url);
  const headers: Record<string, string> = {};
  if (res.headers && typeof res.headers === "object") for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers[k] = v;
  return { url: url(res.url), live: res.live === true || it.kind === "live", subtitles, headers };
}
