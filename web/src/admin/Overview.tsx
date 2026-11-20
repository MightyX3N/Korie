import { useEffect } from "react";
import { api } from "../api";
import { follow, href } from "../router";
import { useData } from "../ui";
import { Dot, GOOD, BAD } from "./Admin";
import { time } from "../watch/ItemPage";

interface Overview {
  name: string; version: string; addresses: string[]; counts: { films: number; series: number; albums: number };
  fromAddons: { films: number; series: number; live: number; liveFrom: string[] }; discovery: { korie: string; jellyfin: string };
  watching: { person: string; name: string; color: string; device: string; title: string; subtitle: string; live: boolean; position: number; duration: number; paused: boolean; at: number }[];
  problems: { title: string; text: string; addon?: string; link?: string; level: "bad" | "busy" }[]; folders: number;
}

export function Overview() {
  const { data: o, error, reload } = useData(() => api<Overview>("/api/admin/overview"), [], ["library", "browse", "addons", "status", "households", "playit"]);
  // who's watching changes all the time: look again every few seconds
  useEffect(() => {
    const t = window.setInterval(reload, 8000);
    return () => clearInterval(t);
  }, []);
  const findable = o && !o.discovery.jellyfin && !o.discovery.korie;
  return (
    <>
      <header className="adm-head">
        <div>
          <h1 className="adm-h1">Overview</h1>
          <p className="adm-soft">{o ? `${o.name} on ${o.addresses[0]} · version ${o.version}` : " "}</p>
        </div>
        <a className="adm-btn primary" href={href("/admin/libraries?add=1")} onClick={(e) => follow(e, "/admin/libraries?add=1")}>Add a folder</a>
      </header>
      {error && <p className="adm-bad">{error}</p>}
      {o && (
        <>
          <section aria-label="Status" className="adm-stats">
            <Stat label="Films" n={o.counts.films} note={o.fromAddons.films ? `+ ${o.fromAddons.films} from add-ons` : o.folders ? "in your folders" : "No folders yet"} />
            <Stat label="Series" n={o.counts.series} note={o.fromAddons.series ? `+ ${o.fromAddons.series} from add-ons` : "in your folders"} />
            <Stat label="Live channels" n={o.fromAddons.live} note={o.fromAddons.liveFrom.length ? `from ${o.fromAddons.liveFrom.join(", ")}` : "No add-on with live channels"} />
            <div className="adm-card adm-stat">
              <span className="adm-soft small">TVs can find Korie</span>
              <span className="adm-yes" style={{ color: findable ? GOOD : BAD }}><Dot color={findable ? GOOD : BAD} />{findable ? "Yes" : "Not by themselves"}</span>
              <span className="adm-soft small">{findable ? "Jellyfin's apps list it by itself" : o.discovery.jellyfin || o.discovery.korie}</span>
            </div>
          </section>
          <div className="adm-two">
            <section className="adm-card adm-list" aria-labelledby="now">
              <h2 id="now" className="adm-h2">Watching now</h2>
              {!o.watching.length && <p className="adm-soft">Nobody is watching anything right now.</p>}
              {o.watching.map((w, i) => (
                <div key={i} className="adm-line">
                  <span className="adm-dot" style={{ background: w.color }}>{w.name.slice(0, 1).toUpperCase()}</span>
                  <div className="adm-line-text">
                    <strong>{w.name} on {w.device}</strong>
                    <span className="adm-soft small">{[w.title, w.subtitle, !w.live && w.duration ? `${time(w.position)} of ${time(w.duration)}` : ""].filter(Boolean).join(" · ")}</span>
                  </div>
                  <span className={`adm-pill ${w.paused ? "" : "good"}`}>{w.paused ? "Paused" : "Playing"}</span>
                </div>
              ))}
            </section>
            <section className="adm-card adm-list" aria-labelledby="attention">
              <h2 id="attention" className="adm-h2">Needs a look</h2>
              {!o.problems.length && <p className="adm-soft">Nothing. Everything works.</p>}
              {o.problems.map((p, i) => (
                <div key={i} className={`adm-alert ${p.level}`}>
                  <span className="adm-alert-bar" />
                  <div>
                    <strong>{p.title}</strong>
                    <p>{p.text}</p>
                    {p.link && <a href={href(p.link)} onClick={(e) => follow(e, p.link!)}>Open</a>}
                    {p.addon && <a href={href(`/admin/addons/${p.addon}`)} onClick={(e) => follow(e, `/admin/addons/${p.addon}`)}>Open the add-on</a>}
                  </div>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, n, note }: { label: string; n: number; note: string }) {
  return (
    <div className="adm-card adm-stat">
      <span className="adm-soft small">{label}</span>
      <span className="adm-num">{n}</span>
      <span className="adm-soft small">{note}</span>
    </div>
  );
}
