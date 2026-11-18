// Home, Films and Series, Live TV, Games and an add-on's page (a category).
import { api } from "../api";
import { go, type Route } from "../router";
import { useData } from "../ui";
import type { Card, Row } from "../types";
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

export const Live = () => <RowsPage title="Live TV" path="/api/live" topics={["browse"]} />;
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
