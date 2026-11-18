// Your own settings: name, colour, PIN, and which sound track and subtitles you get.
import { useState } from "react";
import { api } from "../api";
import { ui } from "../ui";
import type { Me } from "../types";
import { Face } from "../App";

export const COLOURS = ["#e8a33d", "#2fb0ea", "#6cc28a", "#d96fa5", "#9b8cf0", "#e86a5c", "#4fc1b0", "#c9b458"];

export function You({ me, refresh, signOut }: { me: Me; refresh: () => void; signOut: () => void }) {
  const p = me.person;
  const [name, setName] = useState(p.name);
  const save = async (change: Record<string, unknown>) => {
    await ui.attempt("Couldn't save it", () => api(`/api/people/${p.id}`, change, "PATCH"));
    refresh();
  };
  const playback = async (change: Record<string, string>) => {
    await ui.attempt("Couldn't save it", () => api("/api/me/playback", change));
    refresh();
  };
  const pin = async () => {
    const a = await ui.pin(p.hasPin ? "New PIN" : "Choose a PIN", "Four digits.");
    if (!a) return;
    const b = await ui.pin("Once more", "Type the same four digits again.");
    if (!b) return;
    if (a !== b) return ui.message("The PINs weren't the same", "Nothing was changed.");
    await ui.attempt("Couldn't set the PIN", () => api(`/api/people/${p.id}/pin`, { pin: a }));
    refresh();
  };
  const noPin = async () => {
    if (!(await ui.confirm("Remove your PIN?", "Anyone can then pick you on Who's watching.", "Remove"))) return;
    await ui.attempt("Couldn't remove it", () => api(`/api/people/${p.id}/pin`, { pin: null }));
    refresh();
  };
  return (
    <div className="page narrowpage">
      <header className="page-head"><h1>You</h1></header>
      <section className="panel">
        <div className="you-top">
          <Face name={name || p.name} color={p.color} size="l" />
          <form className="grow" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== p.name) void save({ name: name.trim() }); }}>
            <label className="field"><span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== p.name) void save({ name: name.trim() }); }} />
            </label>
          </form>
        </div>
        <div className="field"><span>Colour</span>
          <div className="swatches">
            {COLOURS.map((c) => <button key={c} className={`swatch${c.toLowerCase() === p.color.toLowerCase() ? " on" : ""}`} style={{ background: c }} aria-label={c} aria-pressed={c.toLowerCase() === p.color.toLowerCase()} onClick={() => void save({ color: c })} />)}
          </div>
        </div>
        <div className="field"><span>PIN</span>
          <div className="buttons left">
            <span className="soft">{p.hasPin ? "You have a PIN." : "No PIN: anyone can pick you."}</span>
            <button className="btn" onClick={() => void pin()}>{p.hasPin ? "Change" : "Set a PIN"}</button>
            {p.hasPin && <button className="btn" onClick={() => void noPin()}>Remove</button>}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Playing</h2>
        <label className="field"><span>Sound track</span>
          <select value={p.audio} onChange={(e) => void playback({ audio: e.target.value })}>
            <option value="">The film's own language</option>
            {me.languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
          <small>When a film has this language, you get it.</small>
        </label>
        <label className="field"><span>Subtitles</span>
          <select value={p.subs} onChange={(e) => void playback({ subs: e.target.value })}>
            <option value="">As the file says</option>
            <option value="off">Off</option>
            {me.languages.map(([code, label]) => <option key={code} value={code}>{label}, when the sound is another language</option>)}
          </select>
        </label>
        <label className="field"><span>An episode's intro</span>
          <select value={p.skipIntro} onChange={(e) => void playback({ skipIntro: e.target.value })}>
            <option value="button">Show a Skip intro button</option>
            <option value="auto">Skip it by itself</option>
            <option value="off">Play it</option>
          </select>
        </label>
      </section>

      <div className="buttons left">
        <button className="btn" onClick={signOut}>Switch person</button>
      </div>
      <p className="soft small">Korie {me.server.version} · {me.server.name}</p>
    </div>
  );
}
