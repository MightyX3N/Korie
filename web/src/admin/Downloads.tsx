// Downloads: what's being saved from DRTV and Stremio into the libraries, where it goes, and the
// series whose new episodes are downloaded as they come out.
import { api } from "../api";
import { ui, useData } from "../ui";
import { ago } from "./Admin";

interface D { id: number; item: string; kind: string; title: string; series: string | null; status: string; progress: number; file: string; error: string; created: number; finished: number }
interface All {
  downloads: D[]; follows: { series: string; title: string; created: number }[];
  to: { films: { id: number; path: string } | null; series: { id: number; path: string } | null };
  folders: { id: number; path: string; kind: "films" | "series" }[];
}

export function DownloadsPart() {
  const { data, reload } = useData(() => api<All>("/api/downloads"), [], ["downloads"]);
  if (!data) return null;
  const active = data.downloads.filter((d) => d.status === "queued" || d.status === "downloading");
  const rest = data.downloads.filter((d) => d.status !== "queued" && d.status !== "downloading").slice(0, 30);
  const setTo = async (kind: "films" | "series", id: number) => {
    await ui.attempt("Couldn't change it", () => api("/api/download/folder", { kind, id }));
    reload();
  };
  const line = (d: D) => (
    <div key={d.id} className="adm-line">
      <span className="adm-line-text">
        <strong>{d.title}</strong>
        <span className={`small ${d.status === "failed" ? "adm-bad" : "adm-soft"}`}>
          {d.status === "downloading" ? `Downloading · ${Math.round(d.progress * 100)}%` : d.status === "queued" ? "Waiting" : d.status === "done" ? `Downloaded ${ago(d.finished * 1000)} · ${d.file}` : d.status === "failed" ? `Didn't download: ${d.error}` : "Cancelled"}
        </span>
        {d.status === "downloading" && <span className="adm-meter"><i style={{ width: `${Math.round(d.progress * 100)}%` }} /></span>}
      </span>
      {(d.status === "queued" || d.status === "downloading") && <button className="adm-btn small" onClick={async () => { await ui.attempt("Couldn't cancel it", () => api("/api/download/cancel", { id: d.id })); reload(); }}>Cancel</button>}
      {d.status === "failed" && <button className="adm-btn small" onClick={async () => { await ui.attempt("Couldn't try again", () => api("/api/download", { id: d.item })); reload(); }}>Try again</button>}
    </div>
  );
  return (
    <section className="adm-card adm-list" aria-labelledby="dl">
      <h2 id="dl" className="adm-h2">Downloads</h2>
      <p className="adm-soft small">Films and episodes downloaded from DRTV and Stremio (Download on their page), with subtitles, into these libraries.</p>
      <div className="adm-grid">
        {(["films", "series"] as const).map((k) => (
          <div key={k} className="adm-field">
            <label htmlFor={`dlto-${k}`}>{k === "films" ? "Films go to" : "Series go to"}</label>
            {data.folders.some((f) => f.kind === k)
              ? <select id={`dlto-${k}`} className="adm-input" value={data.to[k]?.id ?? ""} onChange={(e) => void setTo(k, Number(e.target.value))}>
                  {data.folders.filter((f) => f.kind === k).map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
                </select>
              : <span className="adm-soft small">Add a {k === "films" ? "Films" : "Series"} folder first.</span>}
          </div>
        ))}
      </div>
      {active.map(line)}
      {!!data.follows.length && (
        <div className="adm-stack small-gap">
          <div className="adm-row between"><strong>New episodes downloaded as they come out</strong>
            <button className="adm-btn small" onClick={async () => { await ui.attempt("Couldn't look", () => api("/api/download/check", {})); reload(); }}>Look for new episodes now</button></div>
          <span className="adm-soft small">Korie looks every 6 hours.</span>
          {data.follows.map((f) => (
            <div key={f.series} className="adm-line">
              <span className="adm-line-text"><strong>{f.title}</strong><span className="adm-soft small">Since {ago(f.created * 1000)}</span></span>
              <button className="adm-btn small" onClick={async () => { await ui.attempt("Couldn't stop it", () => api("/api/download/follow", { id: f.series, on: false })); reload(); }}>Stop</button>
            </div>
          ))}
        </div>
      )}
      {!!rest.length && (
        <details className="adm-more">
          <summary>Earlier ({rest.length})</summary>
          <div className="adm-stack small-gap">{rest.map(line)}</div>
          {rest.some((d) => d.status === "failed" || d.status === "cancelled") && <button className="adm-btn small start" onClick={async () => { await api("/api/download/clear", {}); reload(); }}>Clear the failed and cancelled ones</button>}
        </details>
      )}
      {!data.downloads.length && <p className="adm-soft small">Nothing downloaded yet.</p>}
    </section>
  );
}
