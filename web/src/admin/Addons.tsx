// Add-ons: what's installed, the Store, and each add-on's own page.
import { useState } from "react";
import { api } from "../api";
import { follow, go, href } from "../router";
import { ui, useData } from "../ui";
import type { AddonView } from "../types";
import { ago } from "./Admin";
import { AboutPart, AccountsPart, ChannelsPart, ShowsPart } from "./AddonParts";

interface List { addons: AddonView[]; store: { loading: boolean; error: string }; admin: boolean; canInstall: boolean }
interface Stats { stats: { films: number; series: number; live: number; games: number; categories: number; at: number; loading: boolean; error: string }; channels: { id: string; title: string; hidden: boolean }[] }

/** Turns an add-on on, asking first about the internet when it wants it. */
export async function turnOn(a: AddonView): Promise<boolean> {
  let r = await ui.attempt(`Couldn't turn ${a.name} on`, () => api<{ ok?: boolean; needsInternet?: boolean; hosts?: string[]; hostsFromSettings?: boolean; hostsFromAccount?: boolean }>("/api/addon/enable", { id: a.id }));
  if (r?.needsInternet) {
    const where = [...(r.hosts ?? []), ...(r.hostsFromSettings ? ["the addresses you type in its settings"] : []), ...(r.hostsFromAccount ? ["the Stremio add-ons added on its page or in someone's account"] : [])].join(", ");
    if (!(await ui.confirm(`Let ${a.name} use the internet?`, `It fetches from: ${where || "the internet"}. It can't reach anything else.`, "Allow"))) return false;
    r = await ui.attempt(`Couldn't turn ${a.name} on`, () => api("/api/addon/enable", { id: a.id, internet: true }));
  }
  return !!r;
}

function pill(a: AddonView): { text: string; cls: string } {
  if (a.error) return { text: "Can't run", cls: "bad" };
  if (!a.installed) return { text: "", cls: "" };
  if (!a.enabled) return { text: "Off", cls: "" };
  const unset = a.settings.some((s) => (s.type === "list" ? !(s.value as string[])?.length : !s.value) && (s.type === "text" || s.type === "list"));
  if (unset) return { text: "Needs setting up", cls: "busy" };
  if (a.trouble) return { text: "Not working", cls: "bad" };
  return { text: "On", cls: "good" };
}

export function Addons({ tab }: { tab: string }) {
  const { data, error, reload } = useData(() => api<List>("/api/addons"), [], ["addons", "store", "browse"]);
  const [q, setQ] = useState("");
  const installed = data?.addons.filter((a) => a.installed) ?? [];
  const inStore = (data?.addons.filter((a) => !a.installed) ?? []).filter((a) => !q || (a.name + " " + a.description).toLowerCase().includes(q.toLowerCase()));
  const install = async (a: AddonView) => {
    const ok = await ui.attempt(`Couldn't install ${a.name}`, () => api("/api/addon/install", { id: a.id }));
    if (ok && (await turnOn(a))) go(`/admin/addons/${a.id}`);
    reload();
  };
  const tabs: [string, string][] = [["installed", `Installed (${installed.length})`], ["store", "Store"]];
  return (
    <>
      <header className="adm-head">
        <div>
          <h1 className="adm-h1">Add-ons</h1>
          <p className="adm-soft max">What they offer shows up in Films, Series, Live TV and Games on every TV and in Jellyfin's apps. Installing takes a second, no restart.</p>
        </div>
      </header>
      <div role="tablist" aria-label="Add-ons" className="adm-tabs">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => go(id === "installed" ? "/admin/addons" : "/admin/addons?tab=store", true)}>{label}</button>)}
      </div>
      {error && <p className="adm-bad">{error}</p>}
      {tab !== "store" && (
        <section aria-label="Installed" className="adm-cards">
          {data && !installed.length && <p className="adm-soft">No add-ons yet. Get some in the Store.</p>}
          {installed.map((a) => {
            const pl = pill(a);
            const update = a.update;
            return (
              <div key={a.id} className={`adm-card adm-addon${pl.cls === "busy" ? " busy" : ""}`}>
                <div className="adm-addon-head">
                  <div className="adm-line-text"><strong className="big">{a.name}</strong><span className="adm-soft small">{a.version} · {a.author}{a.builtin ? " · comes with Korie" : ""}</span></div>
                  {pl.text && <span className={`adm-pill ${pl.cls}`}>{pl.text}</span>}
                </div>
                <p className="adm-text2">{a.error || a.description}</p>
                {a.trouble && <p className="adm-bad small">{a.trouble}</p>}
                <div className="adm-row adm-addon-foot">
                  <a className="adm-btn primary" href={href(`/admin/addons/${a.id}`)} onClick={(e) => follow(e, `/admin/addons/${a.id}`)}>{pl.cls === "busy" ? "Set up" : "Open"}</a>
                  {a.enabled ? <button className="adm-btn" onClick={async () => { await ui.attempt("Couldn't turn it off", () => api("/api/addon/disable", { id: a.id })); reload(); }}>Turn off</button>
                    : !a.error && <button className="adm-btn" onClick={async () => { await turnOn(a); reload(); }}>Turn on</button>}
                  {update && <button className="adm-btn" onClick={() => void install(a)}>Update to {a.storeVersion}</button>}
                </div>
              </div>
            );
          })}
        </section>
      )}
      {tab === "store" && (
        <section aria-label="Store" className="adm-stack">
          <div className="adm-field narrow">
            <label htmlFor="storesearch">Search the Store</label>
            <input id="storesearch" className="adm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="DR, Stremio, games ..." />
          </div>
          {data?.store.loading && <p className="adm-soft">Getting the Store…</p>}
          {data?.store.error && <p className="adm-bad">{data.store.error}</p>}
          <div className="adm-cards">
            {inStore.map((a) => (
              <div key={a.id} className="adm-card adm-addon">
                <div className="adm-line-text"><strong className="big">{a.name}</strong><span className="adm-soft small">{a.version} · {a.author}</span></div>
                <p className="adm-text2">{a.description}</p>
                <button className="adm-btn primary start" disabled={a.busy} onClick={() => void install(a)}>{a.busy ? "Installing…" : "Install"}</button>
              </div>
            ))}
            {data && !inStore.length && !data.store.loading && <p className="adm-soft">{q ? `Nothing in the Store for "${q}".` : "You have everything in the Store."}</p>}
          </div>
        </section>
      )}
    </>
  );
}

export function AddonPage({ id }: { id: string }) {
  const a = useData(() => api<AddonView>(`/api/addon?id=${encodeURIComponent(id)}`), [id], ["addons", "browse"]);
  const s = useData(() => api<Stats>(`/api/admin/addon?id=${encodeURIComponent(id)}`), [id], ["browse", "addons"]);
  const ppl = useData(() => api<{ id: string; name: string }[]>("/api/people"), [], ["people"]);
  const [signedIn, setSignedIn] = useState<string[]>([]);
  const [whose, setWhose] = useState<string | null>(null);
  const v = a.data;
  const st = s.data?.stats;
  const reload = () => {
    a.reload();
    s.reload();
  };
  if (a.error) return <><a className="adm-back" href={href("/admin/addons")} onClick={(e) => follow(e, "/admin/addons")}>Add-ons</a><p className="adm-bad">{a.error}</p></>;
  if (!v) return null;
  const refresh = async () => {
    await ui.attempt("Couldn't refresh", () => api("/api/addon/refresh", { id }));
    window.setTimeout(reload, 1500);
  };
  const place = async (where: "mixed" | "own") => {
    await ui.attempt("Couldn't change it", () => api("/api/addon/place", { id, place: where }));
    reload();
  };
  const removeIt = async () => {
    if (!(await ui.confirm(`Remove ${v.name}?`, "Its films, series and channels go from Korie. You can install it again from the Store.", "Remove", true))) return;
    if (await ui.attempt("Couldn't remove it", () => api("/api/addon/remove", { id }))) go("/admin/addons", true);
  };
  const forms = v.settings.filter((x) => x.type === "text" || x.type === "password" || x.type === "list");
  const perPerson = v.accounts?.who === "person";
  // whose view the add-on describes: a person with their own account (the one picked, or the first)
  const person = perPerson ? (whose && signedIn.includes(whose) ? whose : signedIn[0] ?? null) : null;
  const nameOf = (pid: string | null) => ppl.data?.find((p) => p.id === pid)?.name ?? "";
  const pick = perPerson && signedIn.length > 1 ? (
    <label className="adm-row small-gap"><span className="adm-soft small">Whose</span>
      <select className="adm-input adm-select" value={person ?? ""} onChange={(e) => setWhose(e.target.value)}>
        {signedIn.map((pid) => <option key={pid} value={pid}>{nameOf(pid)}</option>)}
      </select>
    </label>
  ) : null;
  const where = [...v.hosts, ...(v.hostsFromSettings ? ["the addresses in its settings"] : []), ...(v.hostsFromAccount ? ["the Stremio add-ons added on its page or in someone's account"] : [])];
  return (
    <>
      <a className="adm-back" href={href("/admin/addons")} onClick={(e) => follow(e, "/admin/addons")}>Add-ons</a>
      <header className="adm-head">
        <div>
          <h1 className="adm-h1">{v.name}</h1>
          <p className="adm-soft max">{v.description}</p>
          <p className="adm-soft small">{v.version} · {v.author}{v.internet ? ` · fetches from ${where.join(", ")}` : ""}</p>
        </div>
        <div className="adm-row">
          {v.enabled ? <button className="adm-btn" onClick={async () => { await ui.attempt("Couldn't turn it off", () => api("/api/addon/disable", { id })); reload(); }}>Turn off</button>
            : <button className="adm-btn" onClick={async () => { await turnOn(v); reload(); }}>Turn on</button>}
          <button className="adm-btn primary" disabled={!v.enabled} onClick={() => void refresh()}>Refresh now</button>
        </div>
      </header>
      {v.error && <p className="adm-bad">{v.error}</p>}
      {st?.error && !st.loading && <div className="adm-alert bad"><span className="adm-alert-bar" /><div><strong>{v.name} couldn't get its {v.games ? "games" : "films and series"}</strong><p>{st.error}</p></div></div>}

      {v.installed && v.enabled && perPerson && <AboutPart v={v} person={null} personName="" tag="house" />}
      {v.installed && v.accounts && <AccountsPart v={v} onPeople={setSignedIn} />}
      {v.installed && v.enabled && (!perPerson || person) && <AboutPart v={v} person={person} personName={nameOf(person)} pick={pick} tag="person" />}

      {forms.length > 0 && <Settings v={v} forms={forms} saved={reload} />}

      {!v.games && (
        <section aria-labelledby="placing" className="adm-card adm-list">
          <h2 id="placing" className="adm-h2">Where it shows</h2>
          <div role="radiogroup" aria-labelledby="placing" className="adm-choices">
            <label className={`adm-choice${v.place === "mixed" ? " on" : ""}`}>
              <input type="radio" name="place" checked={v.place === "mixed"} onChange={() => void place("mixed")} />
              <span className="adm-line-text"><strong>In Films and Series</strong><span className="adm-soft small">{v.name}'s films and series sit among your own. Its categories are rows under Genres.</span></span>
            </label>
            <label className={`adm-choice${v.place === "own" ? " on" : ""}`}>
              <input type="radio" name="place" checked={v.place === "own"} onChange={() => void place("own")} />
              <span className="adm-line-text"><strong>A tile of its own</strong><span className="adm-soft small">A {v.name} tile on the TV's home screen in Jellyfin's apps, with its categories as folders inside. Films and Series stay yours alone.</span></span>
            </label>
          </div>
        </section>
      )}

      {st && (
        <section aria-label="Status" className="adm-stats small">
          {(st.films > 0 || !v.games) && <div className="adm-card adm-stat"><span className="adm-soft small">Films</span><span className="adm-num">{st.films}</span></div>}
          {(st.series > 0 || !v.games) && <div className="adm-card adm-stat"><span className="adm-soft small">Series</span><span className="adm-num">{st.series}</span></div>}
          {st.live > 0 && <div className="adm-card adm-stat"><span className="adm-soft small">Live channels</span><span className="adm-num">{st.live}</span></div>}
          {(st.games > 0 || v.games) && <div className="adm-card adm-stat"><span className="adm-soft small">Games</span><span className="adm-num">{st.games}</span></div>}
          {st.categories > 0 && <div className="adm-card adm-stat"><span className="adm-soft small">Categories</span><span className="adm-num">{st.categories}</span></div>}
          <div className="adm-card adm-stat"><span className="adm-soft small">Last refreshed</span><span className="adm-strong">{st.loading ? "Refreshing…" : ago(st.at)}</span></div>
        </section>
      )}

      <div className="adm-halves">
        <ShowsPart v={v} saved={reload} />
        {!!s.data?.channels.length && <ChannelsPart v={v} channels={s.data.channels} changed={s.reload} />}
      </div>

      {v.log.length > 0 && (
        <section className="adm-card adm-list">
          <h2 className="adm-h2">What it said</h2>
          <div className="adm-log">{[...v.log].reverse().map((l, i) => <div key={i} className="adm-mono small">{l}</div>)}</div>
        </section>
      )}

      {!v.builtin && v.installed && <div className="adm-row"><button className="adm-btn danger" onClick={() => void removeIt()}>Remove {v.name}</button></div>}
      <p className="adm-faded small">This page is described by the {v.name} add-on and drawn by Korie.</p>
    </>
  );
}

function Settings({ v, forms, saved }: { v: AddonView; forms: AddonView["settings"]; saved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(forms.map((s) => [s.key, s.type === "list" ? ((s.value as string[]) ?? []).join("\n") : s.type === "password" ? "" : String(s.value ?? "")])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    for (const s of forms) {
      const raw = vals[s.key] ?? "";
      if (s.type === "password" && !raw) continue; // left empty: keep the one that's saved
      const value = s.type === "list" ? raw.split("\n").map((x) => x.trim()).filter(Boolean) : raw.trim();
      const ok = await ui.attempt(`Couldn't save ${s.label}`, () => api("/api/addon/setting", { id: v.id, key: s.key, value }));
      if (!ok) break;
    }
    setBusy(false);
    saved();
  };
  return (
    <section className="adm-card adm-list" aria-labelledby="settings">
      <h2 id="settings" className="adm-h2">Settings</h2>
      <form className="adm-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {forms.map((s) => (
          <div key={s.key} className={`adm-field${s.type === "list" ? " wide" : ""}`}>
            <label htmlFor={`set-${s.key}`}>{s.label}</label>
            {s.type === "list"
              ? <textarea id={`set-${s.key}`} className="adm-input mono" rows={4} value={vals[s.key]} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} />
              : <input id={`set-${s.key}`} className="adm-input" type={s.type === "password" ? "password" : "text"} value={vals[s.key]} placeholder={s.type === "password" && s.value ? "Saved (type to change)" : ""} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} autoComplete="off" />}
            {s.help && <span className="adm-soft small">{s.help}{s.type === "list" ? " One per line." : ""}</span>}
          </div>
        ))}
        <div className="adm-row end wide"><button className="adm-btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
      </form>
    </section>
  );
}
