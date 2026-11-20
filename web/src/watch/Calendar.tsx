// The calendar: new episodes of the series in the library and in My list, out and coming. A month
// on a wide screen; on a narrow one, the days one under the other.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, pic } from "../api";
import { go, itemPath } from "../router";
import { useData } from "../ui";
import { Loading, Status } from "./Cards";

export interface CalEntry {
  date: string; series: string; seriesTitle: string; poster: string; backdrop: string; season: number; episode: number;
  title: string; overview: string; still: string; item: string | null; ready: boolean; source: string;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function open(e: CalEntry) {
  go(e.item ? `${itemPath(e.series)}?ep=${encodeURIComponent(e.item)}` : itemPath(e.series));
}

function state(e: CalEntry, today: string): string {
  return e.ready ? "Ready to watch" : e.date > today ? "Coming" : "Not in your library";
}

export function Calendar() {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [narrow, setNarrow] = useState(() => window.innerWidth < 760);
  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 760);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  // the weeks shown: from the Monday on or before the 1st to the Sunday on or after the last day
  const first = new Date(month);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const end = new Date(last); end.setDate(last.getDate() + (7 - ((last.getDay() + 6) % 7) - 1));
  const { data, error } = useData(() => api<{ today: string; entries: CalEntry[] }>(`/api/calendar?from=${iso(start)}&to=${iso(end)}`), [iso(start)], ["calendar", "library"]);
  const byDay = new Map<string, CalEntry[]>();
  for (const e of data?.entries ?? []) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const days: Date[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const today = data?.today ?? iso(new Date());
  // narrow: opens at today
  const loaded = !!data;
  useEffect(() => {
    if (loaded && narrow) document.querySelector(".cal-list .today")?.scrollIntoView({ block: "start" });
  }, [loaded, narrow]);
  const step = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const title = month.toLocaleDateString([], { month: "long", year: "numeric" });
  return (
    <div className="page">
      <header className="page-head">
        <h1>Calendar</h1>
        <div className="cal-nav">
          <button className="btn small" aria-label="Month before" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
          <strong>{title}</strong>
          <button className="btn small" aria-label="Month after" onClick={() => step(1)}><ChevronRight size={18} /></button>
          <button className="btn small" onClick={() => { const d = new Date(); d.setDate(1); setMonth(d); }}>Today</button>
        </div>
      </header>
      <Status error={error} text={data && !data.entries.length ? "Nothing this month. Series in your library, and series in My list, show their new episodes here." : ""} />
      {!data && !error && <Loading />}
      {data && !narrow && (
        <div className="cal-grid" role="grid" aria-label={title}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} className="cal-wd" role="columnheader">{w}</div>)}
          {days.map((d) => {
            const k = iso(d);
            const es = byDay.get(k) ?? [];
            return (
              <div key={k} role="gridcell" className={`cal-day${d.getMonth() !== month.getMonth() ? " other" : ""}${k === today ? " today" : ""}`}>
                <span className="cal-n">{d.getDate()}</span>
                {es.map((e) => (
                  <button key={e.series + e.season + ":" + e.episode} className={`cal-ep${e.ready ? " ready" : ""}`} onClick={() => open(e)} title={`${e.seriesTitle} S${e.season} E${e.episode}${e.title ? ": " + e.title : ""} · ${state(e, today)}`}>
                    <strong>{e.seriesTitle}</strong>
                    <span>S{e.season} E{e.episode}{e.title ? " · " + e.title : ""}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {data && narrow && (
        <div className="cal-list">
          {days.filter((d) => byDay.has(iso(d))).map((d) => {
            const k = iso(d);
            return (
              <section key={k} className={k === today ? "today" : ""}>
                <h2 className="row-title">{k === today ? "Today" : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</h2>
                {byDay.get(k)!.map((e) => (
                  <button key={e.series + e.season + ":" + e.episode} className="cal-row" onClick={() => open(e)}>
                    <span className="cal-pic">{e.still || e.backdrop ? <img src={pic(e.still || e.backdrop, 360)} alt="" loading="lazy" /> : null}</span>
                    <span className="cal-text">
                      <strong>{e.seriesTitle}</strong>
                      <span>S{e.season} E{e.episode}{e.title ? " · " + e.title : ""}</span>
                      <small className={e.ready ? "ready" : ""}>{state(e, today)}</small>
                    </span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
