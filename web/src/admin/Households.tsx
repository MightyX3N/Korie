// Households: who belongs together, watching from outside the home (playit.gg), and signing up.
import { useEffect, useState } from "react";
import { api } from "../api";
import { follow, href } from "../router";
import { ui, useData } from "../ui";
import { Dot, GOOD, BUSY, BAD } from "./Admin";

interface Household { id: string; name: string; hasPassword: boolean; created: number; state: "active" | "pending" | "blocked"; people: number; home: boolean }
interface Info { households: Household[]; register: "off" | "open" | "approval"; registerNote: string; outsidePort: number; guards: { id: string; name: string }[] }
interface Playit { installed: boolean; phase: "missing" | "off" | "linking" | "running" | "stopped" | "failed"; linked: boolean; claimUrl: string; problem: string; address: string; tunnel: string; outsidePort: number; on: boolean; screen: string[]; log: string[] }

const MODES: [Info["register"], string, string][] = [
  ["off", "Off", "Only you make households"],
  ["approval", "With approval", "New households wait until you let them in"],
  ["open", "Open", "Anyone with the address can sign up and watch"],
];

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="adm-btn small" onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
    }}>{done ? "Copied" : "Copy"}</button>
  );
}

export function Households() {
  const { data, error, reload } = useData(() => api<Info>("/api/admin/households"), [], ["households", "people", "addons"]);
  const pl = useData(() => api<Playit>("/api/admin/playit"), [], ["playit"]);
  const [note, setNote] = useState<string | null>(null);
  // while it's being linked, look again now and then (the approval happens on playit.gg)
  useEffect(() => {
    if (pl.data?.phase !== "linking") return;
    const t = setInterval(pl.reload, 3000);
    return () => clearInterval(t);
  }, [pl.data?.phase]);

  const add = async () => {
    const name = await ui.prompt("A new household", "Its name, like The Smiths");
    if (!name?.trim()) return;
    const pw = await ui.prompt(`A password for ${name.trim()}`, "At least 6 characters. They sign in with the household's name and this, once per device, when they're away from home.", "", true);
    if (pw === null) return;
    await ui.attempt("Couldn't add it", () => api("/api/admin/households", { name: name.trim(), password: pw || null }));
    reload();
  };
  const patch = async (h: Household, change: Record<string, unknown>) => {
    await ui.attempt("Couldn't change it", () => api(`/api/admin/households/${h.id}`, change, "PATCH"));
    reload();
  };
  const rename = async (h: Household) => {
    const n = await ui.prompt("Rename the household", "Name", h.name);
    if (n?.trim() && n.trim() !== h.name) await patch(h, { name: n.trim() });
  };
  const password = async (h: Household) => {
    const pw = await ui.prompt(`${h.hasPassword ? "A new password" : "A password"} for ${h.name}`, "At least 6 characters. Devices signed in with the old one sign in again.", "", true);
    if (pw === null) return;
    await patch(h, { password: pw || null });
  };
  const remove = async (h: Household) => {
    if (!(await ui.confirm(`Remove ${h.name}?`, h.people ? `Its ${h.people === 1 ? "person moves" : `${h.people} people move`} to ${data?.households.find((x) => x.home)?.name ?? "the home household"}; remove them in People if they should go too.` : "", "Remove", true))) return;
    await ui.attempt("Couldn't remove it", () => api(`/api/admin/households/${h.id}`, undefined, "DELETE"));
    reload();
  };
  const register = async (change: { mode?: string; note?: string }) => {
    await ui.attempt("Couldn't save", () => api("/api/admin/register", change, "PUT"));
    reload();
  };
  const playit = async (what: string, b?: unknown) => {
    const r = await ui.attempt("playit.gg", () => api<Playit & { url?: string }>(`/api/admin/playit/${what}`, b ?? {}));
    if (r?.url) window.open(r.url, "_blank", "noopener");
    pl.reload();
  };

  const p = pl.data;
  const signUp = `${location.origin}/web/register`;
  const outside = p?.address ? `http://${p.address}` : "";
  return (
    <>
      <header className="adm-head">
        <div>
          <h1 className="adm-h1">Households</h1>
          <p className="adm-soft max">People who belong together. At home, Who's watching shows the home household. Away from home, a device signs in to its household once, with its name and password, and then shows only its people.</p>
        </div>
        <button className="adm-btn primary" onClick={() => void add()}>Add a household</button>
      </header>
      {error && <p className="adm-bad">{error}</p>}

      {data && (
        <section aria-label="Households" className="adm-card adm-list">
          {data.households.map((h) => {
            const color = h.state === "active" ? GOOD : h.state === "pending" ? BUSY : BAD;
            const state = h.state === "pending" ? "Waiting for you to let it in" : h.state === "blocked" ? "Stopped: it can't watch" : h.home ? "At home" : "Can watch";
            return (
              <div key={h.id} className="adm-line wrap">
                <div className="adm-line-text">
                  <strong>{h.name}</strong>
                  <span className="adm-soft small">
                    {h.people === 1 ? "1 person" : `${h.people} people`} · <span style={{ color }}><Dot color={color} />{state}</span> · {h.hasPassword ? "has a password" : h.home ? "no password: can't sign in from outside" : "no password yet"}
                  </span>
                </div>
                <div className="adm-row">
                  {h.state === "pending" && <button className="adm-btn small primary" onClick={() => void patch(h, { state: "active" })}>Let in</button>}
                  <a className="adm-btn small" href={href("/admin/people")} onClick={(e) => follow(e, "/admin/people")}>People</a>
                  <button className="adm-btn small" onClick={() => void rename(h)}>Rename</button>
                  <button className="adm-btn small" onClick={() => void password(h)}>{h.hasPassword ? "New password" : "Set a password"}</button>
                  {!h.home && h.state === "active" && <button className="adm-btn small" onClick={() => void patch(h, { state: "blocked" })}>Stop</button>}
                  {!h.home && h.state === "blocked" && <button className="adm-btn small" onClick={() => void patch(h, { state: "active" })}>Allow again</button>}
                  {!h.home && <button className="adm-btn small danger" onClick={() => void remove(h)}>Remove</button>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section aria-labelledby="away" className="adm-card adm-grid wide-gap">
        <div className="adm-field">
          <h2 id="away" className="adm-h2">Watching away from home</h2>
          <span className="adm-soft">With playit.gg, Korie can be reached from outside without opening anything on your router. Everything that comes in through it counts as outside the home.</span>
          {p && !p.installed && <span className="adm-soft small">playit.gg's program isn't in this install of Korie. It comes with Korie's Docker image; otherwise put playit's <span className="adm-mono">playitd</span> and <span className="adm-mono">playit-cli</span> on the PATH.</span>}
          {p?.installed && (
            <>
              <span className="adm-state" style={{ color: p.phase === "running" ? GOOD : p.phase === "failed" ? BAD : BUSY }}>
                <Dot color={p.phase === "running" ? GOOD : p.phase === "failed" ? BAD : BUSY} />
                {p.phase === "running" ? "Running" : p.phase === "linking" ? "Waiting for you to approve it on playit.gg" : p.phase === "failed" ? "Not running" : p.linked ? "Stopped" : "Not set up"}
              </span>
              {p.problem && <span className="adm-bad small">{p.problem}</span>}
              <div className="adm-row">
                {!p.linked && p.phase !== "linking" && <button className="adm-btn primary small" onClick={() => void playit("link")}>Set up playit.gg</button>}
                {p.phase === "linking" && p.claimUrl && <a className="adm-btn primary small" href={p.claimUrl} target="_blank" rel="noreferrer">Open playit.gg to approve</a>}
                {p.linked && p.phase !== "running" && <button className="adm-btn small" onClick={() => void playit("start")}>Start</button>}
                {(p.phase === "running" || p.phase === "linking") && <button className="adm-btn small" onClick={() => void playit("stop")}>Stop</button>}
                {p.linked && <button className="adm-btn small" onClick={async () => { if (await ui.confirm("Unlink playit.gg?", "Korie can't be reached from outside until it's set up again.", "Unlink", true)) void playit("forget"); }}>Unlink</button>}
              </div>
            </>
          )}
        </div>
        <div className="adm-field">
          <span className="adm-label">How it works</span>
          <ol className="adm-steps">
            <li>Set up playit.gg here and approve it on the page that opens (make a free account there if you have none).</li>
            <li>Korie makes a tunnel on your playit.gg account to its outside port ({p?.outsidePort ?? data?.outsidePort ?? 8101}) and shows its address here.</li>
            <li>Give each household that address, its name and its password.</li>
          </ol>
          <span className="adm-soft small">Only that port counts as outside. People at home keep using Korie's usual address.</span>
        </div>
        <div className="adm-field">
          <span className="adm-label">The address to give out</span>
          {p?.address && p.tunnel && <span className="adm-bad small">{p.tunnel}</span>}
          {p?.address ? (
            <>
              <div className="adm-row">
                <span className="adm-mono adm-address">{p.address}</span>
                <CopyButton text={p.address} />
              </div>
              <span className="adm-soft small">In a browser: <span className="adm-mono">{outside}/web</span>. In Korie's TV app and Jellyfin's apps: <span className="adm-mono">{outside}</span>.</span>
            </>
          ) : (
            <span className="adm-soft small">{p?.tunnel || (p?.linked ? "It shows here once playit.gg has made the tunnel." : "It shows here once playit.gg is set up.")}</span>
          )}
        </div>
        {p?.installed && (!!p.screen.length || !!p.log.length) && (
          <div className="adm-field span-all">
            <span className="adm-label">{p.screen.length ? "What playit.gg says" : "What playit.gg said"}</span>
            <pre className="adm-screen">{(p.screen.length ? p.screen : p.log.slice(-12)).join("\n")}</pre>
          </div>
        )}
      </section>

      {data && (
        <section aria-labelledby="signup" className="adm-card adm-grid wide-gap">
          <div className="adm-field">
            <h2 id="signup" className="adm-h2">Signing up</h2>
            <span className="adm-soft">A page where a new household signs up with its name, a password and its people.</span>
            <div className="adm-checks">
              {MODES.map(([m, label, help]) => (
                <label key={m} className="adm-check">
                  <span className="adm-line-text"><span>{label}</span><span className="adm-soft small">{help}</span></span>
                  <input type="radio" name="reg" checked={data.register === m} onChange={() => void register({ mode: m })} />
                </label>
              ))}
            </div>
            {data.register !== "off" && <span className="adm-soft small">The page: <span className="adm-mono">{outside ? `${outside}/web/register` : signUp}</span></span>}
          </div>
          <form className="adm-field" onSubmit={(e) => { e.preventDefault(); if (note !== null) void register({ note }); }}>
            <label htmlFor="note" className="adm-label">Text on the sign-up page</label>
            <textarea id="note" className="adm-input" rows={4} value={note ?? data.registerNote} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== null && note !== data.registerNote) void register({ note }); }} placeholder="Who may sign up, and anything they should know." />
          </form>
          <div className="adm-field">
            <span className="adm-label">Add-ons that look after households</span>
            {data.guards.length
              ? data.guards.map((g) => <a key={g.id} href={href(`/admin/addons/${g.id}`)} onClick={(e) => follow(e, `/admin/addons/${g.id}`)}>{g.name}</a>)
              : <span className="adm-soft small">None. An add-on with permission to look after households can decide who may come in (a membership, say). Korie comes with none; what such an add-on does is up to whoever installs it.</span>}
          </div>
        </section>
      )}
    </>
  );
}
