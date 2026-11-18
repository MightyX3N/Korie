// Server: its name, TMDb, being found on the network, its addresses, and what it did.
import { useState } from "react";
import { api } from "../api";
import { ui, useData } from "../ui";
import { Dot, GOOD, BAD } from "./Admin";

interface ServerInfo { name: string; version: string; addresses: string[]; discovery: { korie: string; jellyfin: string }; tmdb: { works: boolean; own: boolean }; language: string; scanOnStart: boolean }
interface Line { at: number; area: string; text: string; bad: boolean }

const LANGS: [string, string][] = [["en-US", "English"], ["da-DK", "Danish"], ["sv-SE", "Swedish"], ["nb-NO", "Norwegian"], ["de-DE", "German"], ["fr-FR", "French"], ["es-ES", "Spanish"], ["nl-NL", "Dutch"], ["fi-FI", "Finnish"]];

export function Server() {
  const { data: s, error, reload } = useData(() => api<ServerInfo>("/api/admin/server"), []);
  const log = useData(() => api<{ lines: Line[] }>("/api/admin/log"), [], ["library", "browse", "addons", "status"]);
  const [filter, setFilter] = useState<"all" | "problems">("all");
  const [name, setName] = useState<string | null>(null);

  const setting = async (key: string, value: unknown) => {
    await ui.attempt("Couldn't save", () => api("/api/settings", { key, value }));
    reload();
  };
  const ownKey = async () => {
    const k = await ui.prompt("Your own TMDb key", "API key (v3) or read access token, from themoviedb.org → Settings → API", "", true);
    if (k === null) return;
    await setting("tmdb_key", k.trim());
  };
  const lines = (log.data?.lines ?? []).filter((l) => filter === "all" || l.bad);
  const jellyfinOk = s && !s.discovery.jellyfin;
  return (
    <>
      <header className="adm-head">
        <div>
          <h1 className="adm-h1">Server</h1>
          <p className="adm-soft">How Korie runs on the NAS{s ? ` · version ${s.version}` : ""}.</p>
        </div>
      </header>
      {error && <p className="adm-bad">{error}</p>}
      {s && (
        <section aria-label="Settings" className="adm-card adm-grid wide-gap">
          <form className="adm-field" onSubmit={(e) => { e.preventDefault(); if (name?.trim()) void setting("server_name", name.trim()); }}>
            <label htmlFor="sname">Name</label>
            <input id="sname" className="adm-input" value={name ?? s.name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name?.trim() && name.trim() !== s.name) void setting("server_name", name.trim()); }} />
            <span className="adm-soft small">What the TVs and Jellyfin's apps call this server.</span>
          </form>
          <div className="adm-field">
            <span className="adm-label">Posters and descriptions</span>
            <span className="adm-state" style={{ color: s.tmdb.works ? GOOD : BAD }}><Dot color={s.tmdb.works ? GOOD : BAD} />{s.tmdb.works ? `TMDb works (${s.tmdb.own ? "your own key" : "Korie's own key"})` : "No TMDb key: only names from the files"}</span>
            <div className="adm-row">
              <button className="adm-btn small" onClick={() => void ownKey()}>{s.tmdb.own ? "Change my key" : "Use my own key"}</button>
              {s.tmdb.own && <button className="adm-btn small" onClick={() => void setting("tmdb_key", "")}>Use Korie's key</button>}
            </div>
          </div>
          <div className="adm-field">
            <label htmlFor="lang" className="adm-label">Language of descriptions</label>
            <select id="lang" className="adm-input" value={s.language} onChange={(e) => void setting("language", e.target.value)}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="adm-field">
            <span className="adm-label">Found by itself on the network</span>
            <span className="adm-state" style={{ color: jellyfinOk ? GOOD : BAD }}><Dot color={jellyfinOk ? GOOD : BAD} />{jellyfinOk ? "Jellyfin's apps find Korie" : "Jellyfin's apps can't find Korie by themselves"}</span>
            <span className="adm-soft small">{s.discovery.jellyfin || "Answering on UDP 7359."}</span>
            <span className="adm-state" style={{ color: !s.discovery.korie ? GOOD : BAD }}><Dot color={!s.discovery.korie ? GOOD : BAD} />{!s.discovery.korie ? "Korie's TV app finds Korie" : s.discovery.korie}</span>
          </div>
          <div className="adm-field">
            <span className="adm-label">Addresses</span>
            {s.addresses.map((a) => <span key={a} className="adm-mono">{a}</span>)}
            <span className="adm-soft small">Type this in an app that doesn't find Korie by itself.</span>
          </div>
          <div className="adm-field">
            <span className="adm-label">When Korie starts</span>
            <label className="adm-check">
              <span>Look for new files in the folders</span>
              <input type="checkbox" checked={s.scanOnStart} onChange={() => void setting("scan_on_start", !s.scanOnStart)} />
            </label>
          </div>
        </section>
      )}

      <section aria-labelledby="logs" className="adm-card adm-list">
        <div className="adm-row between">
          <h2 id="logs" className="adm-h2">What happened</h2>
          <div className="adm-row">
            {(["all", "problems"] as const).map((f) => <button key={f} aria-pressed={filter === f} className={`adm-toggle${filter === f ? " on" : ""}`} onClick={() => setFilter(f)}>{f === "all" ? "Everything" : "Only problems"}</button>)}
            <button className="adm-btn small" onClick={log.reload}>Refresh</button>
          </div>
        </div>
        <div className="adm-logtable">
          {!lines.length && <div className="adm-soft pad">{filter === "problems" ? "No problems." : "Nothing yet."}</div>}
          {lines.map((l, i) => (
            <div key={i} className="adm-logline">
              <span className="adm-soft">{new Date(l.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className={l.bad ? "adm-tag bad" : "adm-tag"}>{l.area}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
