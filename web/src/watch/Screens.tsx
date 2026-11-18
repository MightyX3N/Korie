// Home, Films and Series, Live TV, Games and an add-on's page (a category).
import { api } from "../api";
import { go, type Route } from "../router";
import { useEffect, useRef, useState } from "react";
import { ui, useData } from "../ui";
import type { Card, Programme, Row } from "../types";
import { Grid, Loading, RowView, Status } from "./Cards";

export function Home() {
  const { data, error, reload } = useData(() => api<{ rows: Row[]; empty: boolean; scanning: boolean; status: string }>("/api/home"), [], ["library", "browse", "progress", "favourites"]);
  return (
    <div className="page">
      <h1 className="sr">Home</h1>
      <Status error={error} />
      {!data && !error && <Loading />}
      {data?.empty && (
        <div className="empty">
          <h2>Nothing here yet</h2>
          <p className="soft">{data.scanning ? data.status || "Korie is looking through your folders." : "An admin adds folders with films, series and music in Admin → Libraries, and add-ons in Admin → Add-ons."}</p>
        </div>
      )}
      {data?.rows.map((r) => <RowView key={r.id} row={r} onChanged={reload} />)}
    </div>
  );
}

const SORTS: [string, string][] = [["added", "Newest"], ["title", "A–Z"], ["year", "Year"], ["rating", "Rating"]];
const SHOWS: [string, string][] = [["categories", "Categories"], ["all", "All"], ["unwatched", "Not watched"], ["progress", "Half watched"]];

export function Library({ kind, route }: { kind: "films" | "series"; route: Route }) {
  const source = route.query.get("source") ?? "";
  const sort = route.query.get("sort") ?? "added";
  const show = route.query.get("show") ?? "categories";
  const { data, error, reload } = useData(
    () => api<{ sources: { id: string; name: string }[]; source: string; items?: Card[]; rows?: Row[]; status: string; count?: number }>(`/api/${kind}?source=${encodeURIComponent(source)}&sort=${sort}&show=${show}`),
    [kind, source, sort, show], ["library", "browse", "progress"],
  );
  const set = (k: string, v: string) => {
    const q = new URLSearchParams(route.query);
    if (v) q.set(k, v);
    else q.delete(k);
    if (k === "source") {
      q.delete("sort");
      q.delete("show");
    }
    const s = q.toString();
    go(`/${kind}${s ? "?" + s : ""}`, true);
  };
  return (
    <div className="page">
      <header className="page-head">
        <h1>{kind === "films" ? "Films" : "Series"}</h1>
        {data && data.sources.length > 1 && (
          <div className="chips" role="tablist">
            {data.sources.map((s) => (
              <button key={s.id} role="tab" aria-selected={s.id === source} className={`chip${s.id === source ? " on" : ""}`} onClick={() => set("source", s.id)}>{s.name}</button>
            ))}
          </div>
        )}
      </header>
      {!source && (
        <div className="tools">
          {show !== "categories" && <label className="select"><span>Sort</span>
            <select value={sort} onChange={(e) => set("sort", e.target.value === "added" ? "" : e.target.value)}>
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>}
          <label className="select"><span>Show</span>
            <select value={show} onChange={(e) => set("show", e.target.value === "categories" ? "" : e.target.value)}>
              {SHOWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {(data?.items || data?.count !== undefined) && <span className="soft count">{data.items?.length ?? data.count} {(data.items?.length ?? data.count) === 1 ? (kind === "films" ? "film" : "series") : kind}</span>}
        </div>
      )}
      <Status error={error} text={data?.status} />
      {!data && !error && <Loading />}
      {data?.items && <Grid items={data.items} shape="poster" onChanged={reload} />}
      {data?.rows?.map((r) => <RowView key={r.id} row={r} onChanged={reload} />)}
    </div>
  );
}

function RowsPage({ title, path, topics }: { title: string; path: string; topics: string[] }) {
  const { data, error, reload } = useData(() => api<{ rows: Row[]; status: string }>(path), [path], topics);
  return (
    <div className="page">
      <header className="page-head"><h1>{title}</h1></header>
      <Status error={error} text={data?.status} />
      {!data && !error && <Loading />}
      {data?.rows.map((r) => <RowView key={r.id} row={r} onChanged={reload} />)}
    </div>
  );
}

/** Live TV: the channels as rows, or the guide (what's on each channel, through the week). */
export function Live({ route }: { route: Route }) {
  const guide = route.query.get("view") === "guide";
  const { data, error, reload } = useData(() => api<{ rows: Row[]; status: string }>("/api/live"), [], ["browse", "channels"]);
  const hasChannels = !!data?.rows.some((r) => r.id === "channels");
  return (
    <div className="page">
      <header className="page-head">
        <h1>Live TV</h1>
        {(hasChannels || guide) && (
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={!guide} className={!guide ? "on" : ""} onClick={() => go("/live", true)}>Channels</button>
            <button role="tab" aria-selected={guide} className={guide ? "on" : ""} onClick={() => go("/live?view=guide", true)}>Guide</button>
          </div>
        )}
      </header>
      {guide ? <Guide /> : (
        <>
          <Status error={error} text={data?.status} />
          {!data && !error && <Loading />}
          {data?.rows.map((r) => <RowView key={r.id} row={r} onChanged={reload} />)}
        </>
      )}
    </div>
  );
}

interface GuideData { now: number; channels: { id: string; name: string; programmes: Programme[] }[] }

const PX_MIN = 6; // a minute is this wide
const hm = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The guide: channels down the side, time across; the line is now. Today and the days ahead. */
function Guide() {
  const [day, setDay] = useState(0);
  const start = (() => {
    const d = new Date();
    if (day > 0) { d.setDate(d.getDate() + day); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000); }
    return Math.floor(Date.now() / 1000 / 1800) * 1800 - 1800;
  })();
  const hours = day > 0 ? 24 : Math.ceil((new Date(new Date().setHours(24, 0, 0, 0)).getTime() / 1000 - start) / 3600);
  const { data, error } = useData(() => api<GuideData>(`/api/guide?from=${start}&hours=${hours}`), [day], ["channels"]);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const now = Date.now() / 1000;
  const x = (t: number) => ((t - start) / 60) * PX_MIN;
  const width = hours * 60 * PX_MIN;
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "long" });
  });
  // opened on today: now is a little in from the left
  const loaded = !!data;
  useEffect(() => {
    if (loaded && day === 0 && scroller.current) scroller.current.scrollLeft = Math.max(0, x(Date.now() / 1000) - 60);
  }, [loaded, day]);
  const open = (c: GuideData["channels"][number], p: Programme) => {
    if (p.start <= now && p.end > now) go(`/play/${encodeURIComponent(c.id)}`);
    else void ui.message(p.locked ? "For older viewers" : p.title, `${c.name} · ${hm(p.start)}–${hm(p.end)}${p.subtitle ? " · " + p.subtitle : ""}${p.overview ? "\n\n" + p.overview : ""}`);
  };
  return (
    <div className="guide-wrap">
      <div className="tools">
        <label className="select"><span>Day</span>
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {days.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </label>
      </div>
      <Status error={error} text={data && !data.channels.length ? "No channels yet. They're made from the films and series in your library: an admin turns them on and off in Admin, Libraries." : ""} />
      {!data && !error && <Loading />}
      {data && data.channels.length > 0 && (
        <div className="guide" ref={scroller}>
          <div className="guide-grid" style={{ width: `calc(var(--guide-side) + ${width}px)` }}>
            <div className="guide-row guide-times">
              <div className="guide-side" />
              <div className="guide-line" style={{ width }}>
                {[...Array(hours * 2)].map((_, i) => <span key={i} className="guide-time" style={{ left: i * 30 * PX_MIN }}>{hm(start + i * 1800)}</span>)}
              </div>
            </div>
            {data.channels.map((c) => (
              <div key={c.id} className="guide-row">
                <button className="guide-side" onClick={() => go(`/play/${encodeURIComponent(c.id)}`)}>{c.name}</button>
                <div className="guide-line" style={{ width }}>
                  {c.programmes.map((p) => {
                    const l = Math.max(0, x(p.start));
                    const w = Math.min(width, x(p.end)) - l;
                    if (w <= 0) return null;
                    const on = p.start <= now && p.end > now;
                    return (
                      <button key={p.start} className={`guide-prog${on ? " on" : ""}${p.locked ? " locked" : ""}`} style={{ left: l, width: w }} onClick={() => open(c, p)} title={`${hm(p.start)}–${hm(p.end)} ${p.locked ? "For older viewers" : p.title}`}>
                        <strong>{p.locked ? "For older viewers" : p.title}</strong>
                        <span>{hm(p.start)}{p.subtitle && !p.locked ? " · " + p.subtitle : ""}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {day === 0 && <div className="guide-now" style={{ left: `calc(var(--guide-side) + ${x(now)}px)` }} />}
          </div>
        </div>
      )}
    </div>
  );
}
export const Games = () => <RowsPage title="Games" path="/api/games" topics={["browse", "addons"]} />;

export function AddonPage({ id, only }: { id: string; only?: string }) {
  const { data, error, reload } = useData(() => api<{ title: string; rows: Row[]; status: string }>(`/api/page?id=${encodeURIComponent(id)}${only ? `&only=${only}` : ""}`), [id, only], ["browse"]);
  return (
    <div className="page">
      <header className="page-head"><h1>{data?.title ?? ""}</h1></header>
      <Status error={error} text={data?.status} />
      {!data && !error && <Loading />}
      {data?.rows.map((r) => <RowView key={r.id} row={r} onChanged={reload} />)}
    </div>
  );
}
