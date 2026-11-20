// TV channels made from the library: one per genre, plus Classics and Kids. Each one's week is worked
// out once (on Monday) and kept; something added during the week joins the next week, or straight
// away with Make the schedules again.
import { useState } from "react";
import { api } from "../api";
import { ui, useData } from "../ui";

interface Ch { id: string; name: string; kind: "genre" | "classics" | "kids"; enabled: boolean; titles: number; now: string }

const ABOUT: Record<Ch["kind"], string> = {
  kids: "Rated for 7 and under, and family and animation rated for 11 and under",
  classics: "Films at least 30 years old that TMDb's viewers rate 7 or more",
  genre: "",
};

export function ChannelsPart() {
  const { data, reload } = useData(() => api<{ channels: Ch[] }>("/api/admin/channels"), [], ["channels", "library"]);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const flip = async (c: Ch) => {
    await ui.attempt("Couldn't change it", () => api("/api/admin/channels", { id: c.id, enabled: !c.enabled }));
    reload();
  };
  const redo = async () => {
    setBusy(true);
    await ui.attempt("Couldn't make the schedules", () => api("/api/admin/channels", { redo: true }));
    setBusy(false);
    reload();
  };
  return (
    <section className="adm-card adm-list" aria-labelledby="tvch">
      <div className="adm-row between">
        <h2 id="tvch" className="adm-h2">TV channels</h2>
        {data.channels.length > 0 && <button className="adm-btn small" disabled={busy} onClick={() => void redo()}>{busy ? "Making them…" : "Make the schedules again"}</button>}
      </div>
      <p className="adm-soft small">
        Channels in Live that play your own films and series around the clock: one for each genre with 3 or more titles, plus Classics and Kids.
        Each week's schedule is worked out on Monday; something added during the week joins next week's, or now with Make the schedules again.
        Something above a person's age limit is covered until someone who may watch it types their PIN.
      </p>
      {!data.channels.length && <p className="adm-soft">No channels yet: they come from the genres of the films and series in your libraries.</p>}
      {data.channels.map((c) => (
        <div key={c.id} className="adm-line">
          <span className="adm-line-text">
            <strong>{c.name}</strong>
            <span className="adm-soft small">{[ABOUT[c.kind], `${c.titles} ${c.titles === 1 ? "title" : "titles"}`, c.enabled && c.now ? `On now: ${c.now}` : c.enabled ? "" : "Off"].filter(Boolean).join(" · ")}</span>
          </span>
          <button type="button" role="switch" aria-checked={c.enabled} aria-label={`${c.name} on`} className={`adm-switch${c.enabled ? " on" : ""}`} onClick={() => void flip(c)}><span /></button>
        </div>
      ))}
    </section>
  );
}
