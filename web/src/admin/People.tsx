// People: everyone in the house, and for each their name, colour, PIN, age limit, what they may
// do and use, and where they're signed in.
import { useEffect, useState } from "react";
import { api } from "../api";
import { follow, go, href } from "../router";
import { ui, useData } from "../ui";
import type { Me, Person } from "../types";
import { COLOURS } from "../watch/You";
import { ago } from "./Admin";

interface All { people: Person[]; addons: { id: string; name: string }[]; apps: { pkg: string; label: string }[]; devices: { id: string; name: string; seen: number }[] }

const AGES: [number | null, string][] = [[null, "Anything"], [0, "A"], [7, "7"], [11, "11"], [15, "15"]];

function note(p: Person): string {
  return [p.admin ? "Admin" : "", p.hasPin ? "PIN" : "No PIN", p.maxAge !== null ? `up to ${p.maxAge === 0 ? "A" : p.maxAge + " years"}` : ""].filter(Boolean).join(" · ");
}

export function People({ me, picked }: { me: Me; picked: string }) {
  const { data, error, reload } = useData(() => api<All>("/api/people/all"), [], ["people", "addons"]);
  const current = data?.people.find((p) => p.id === picked) ?? data?.people[0];

  const add = async () => {
    const name = await ui.prompt("Add a person", "Name");
    if (!name?.trim()) return;
    const p = await ui.attempt("Couldn't add them", () => api<Person>("/api/people", { name: name.trim() }));
    if (p) {
      reload();
      go(`/admin/people/${p.id}`, true);
    }
  };
  return (
    <>
      <header className="adm-head">
        <div>
          <h1 className="adm-h1">People</h1>
          <p className="adm-soft max">Everyone in the house. They're on Who's watching on every TV and in Jellyfin's apps; a PIN keeps a profile to its owner.</p>
        </div>
        <button className="adm-btn primary" onClick={() => void add()}>Add a person</button>
      </header>
      {error && <p className="adm-bad">{error}</p>}
      {data && current && (
        <div className="adm-split">
          <section aria-label="Everyone" className="adm-people">
            {data.people.map((p) => {
              const on = p.id === current.id;
              return (
                <button key={p.id} className={`adm-person${on ? " on" : ""}`} aria-pressed={on} onClick={() => go(`/admin/people/${p.id}`, true)}>
                  <span className="adm-dot big" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>
                  <span className="adm-line-text"><strong>{p.name}</strong><span className="adm-soft small">{note(p)}</span></span>
                </button>
              );
            })}
          </section>
          <Editor key={current.id} p={current} all={data} me={me} saved={reload} />
        </div>
      )}
    </>
  );
}

function Editor({ p, all, me, saved }: { p: Person; all: All; me: Me; saved: () => void }) {
  const [name, setName] = useState(p.name);
  const [draft, setDraft] = useState<Partial<Person>>({});
  const v = { ...p, ...draft } as Person;
  const dirty = name.trim() !== p.name || Object.keys(draft).length > 0;
  const accts = useData(() => api<{ accounts: { id: string; name: string; text: string; on: boolean }[] }>(`/api/admin/person-accounts?person=${p.id}`), [p.id], ["addons"]);
  const sessions = useData(() => api<{ sessions: { id: number; device: string; created: number; seen: number }[] }>(`/api/admin/sessions?person=${p.id}`), [p.id]);
  useEffect(() => setName(p.name), [p.name]);
  const set = (k: keyof Person, val: unknown) => setDraft((d) => ({ ...d, [k]: val }));

  const save = async () => {
    const change: Record<string, unknown> = { ...draft };
    if (name.trim() && name.trim() !== p.name) change.name = name.trim();
    const r = await ui.attempt("Couldn't save", () => api(`/api/people/${p.id}`, change, "PATCH"));
    if (r) {
      setDraft({});
      saved();
    }
  };
  const pin = async () => {
    const a = await ui.pin(p.hasPin ? `New PIN for ${p.name}` : `A PIN for ${p.name}`, "Four digits.");
    if (!a) return;
    const b = await ui.pin("Once more", "Type the same four digits again.");
    if (!b) return;
    if (a !== b) return ui.message("The PINs weren't the same", "Nothing was changed.");
    await ui.attempt("Couldn't set the PIN", () => api(`/api/people/${p.id}/pin`, { pin: a }));
    saved();
  };
  const noPin = async () => {
    if (!(await ui.confirm(`Remove ${p.name}'s PIN?`, "Anyone can then pick them on Who's watching.", "Remove"))) return;
    await ui.attempt("Couldn't remove it", () => api(`/api/people/${p.id}/pin`, { pin: null }));
    saved();
  };
  const remove = async () => {
    if (!(await ui.confirm(`Remove ${p.name}?`, "What they've watched and their favourites go too.", "Remove", true))) return;
    const r = await ui.attempt("Couldn't remove them", () => api(`/api/people/${p.id}`, undefined, "DELETE"));
    if (r) {
      go("/admin/people", true);
      saved();
    }
  };
  const addonsAll = v.addons === "all";
  const mayAddon = (id: string) => addonsAll || (v.addons as string[]).includes(id);
  const flipAddon = (id: string) => {
    const now = addonsAll ? all.addons.map((a) => a.id) : [...(v.addons as string[])];
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    set("addons", next.length === all.addons.length ? "all" : next);
  };
  const last = sessions.data?.sessions[0];
  return (
    <section aria-labelledby="edit" className="adm-card adm-editor">
      <div className="adm-editor-head">
        <span className="adm-dot huge" style={{ background: v.color }}>{(name || p.name).slice(0, 1).toUpperCase()}</span>
        <div>
          <h2 id="edit" className="adm-h2 big">{name || p.name}</h2>
          <span className="adm-soft">{last ? `Last used ${ago(last.seen * 1000)} on ${last.device}` : "Not signed in anywhere"}</span>
        </div>
      </div>

      <div className="adm-grid">
        <div className="adm-field">
          <label htmlFor="pname">Name</label>
          <input id="pname" className="adm-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="adm-field">
          <span className="adm-label">Colour</span>
          <div className="adm-row">
            {COLOURS.map((c) => <button key={c} type="button" className={`adm-swatch${c.toLowerCase() === v.color.toLowerCase() ? " on" : ""}`} style={{ background: c }} aria-label={c} aria-pressed={c.toLowerCase() === v.color.toLowerCase()} onClick={() => set("color", c)} />)}
          </div>
        </div>
        <div className="adm-field">
          <span className="adm-label">PIN</span>
          <div className="adm-row">
            {p.hasPin ? <span className="adm-pin">••••</span> : <span className="adm-soft">None</span>}
            <button className="adm-btn small" onClick={() => void pin()}>{p.hasPin ? "Change" : "Set a PIN"}</button>
            {p.hasPin && <button className="adm-btn small" onClick={() => void noPin()}>Remove</button>}
          </div>
        </div>
        <div className="adm-field">
          <span className="adm-label">Age limit</span>
          <div className="adm-row">
            {AGES.map(([age, label]) => <button key={label} type="button" aria-pressed={v.maxAge === age} className={`adm-toggle num${v.maxAge === age ? " on" : ""}`} onClick={() => set("maxAge", age)}>{label}</button>)}
          </div>
          <span className="adm-soft small">The Media Council's ages. Films without a rating are left out too.</span>
        </div>
      </div>

      <div className="adm-field">
        <span className="adm-label">What they may do</span>
        <div className="adm-checks">
          <Check label="Admin" help="Manage Korie here" on={v.admin} disabled={p.id === me.person.id && p.admin} flip={() => set("admin", !v.admin)} />
          <Check label="Change settings" help="Libraries, details and posters" on={v.canSettings} flip={() => set("canSettings", !v.canSettings)} />
          <Check label="Install add-ons" help="And turn them on and off" on={v.canInstall} flip={() => set("canInstall", !v.canInstall)} />
          <Check label="Remove things" help="From the library (the files stay)" on={v.canDelete} flip={() => set("canDelete", !v.canDelete)} />
          <Check label="Music" help="See and play music" on={v.music} flip={() => set("music", !v.music)} />
        </div>
      </div>

      {all.addons.length > 0 && (
        <div className="adm-field">
          <span className="adm-label">Add-ons they may use</span>
          <div className="adm-checks">
            {all.addons.map((a) => <Check key={a.id} label={a.name} on={mayAddon(a.id)} flip={() => flipAddon(a.id)} />)}
          </div>
        </div>
      )}

      {all.devices.length > 0 && (
        <div className="adm-field">
          <label htmlFor="auto" className="adm-label">A TV that signs in as {name || p.name} by itself</label>
          <select id="auto" className="adm-input" value={v.autoDevice ?? ""} onChange={(e) => set("autoDevice", e.target.value || null)}>
            <option value="">None: the TVs ask Who's watching</option>
            {all.devices.map((d) => <option key={d.id} value={d.id}>{d.name} (seen {ago(d.seen * 1000)})</option>)}
          </select>
          {v.autoDevice && p.hasPin && (
            <div className="adm-checks">
              <Check label={`Ask for ${name || p.name}'s PIN each time that TV starts or wakes up`} on={v.autoPin} flip={() => set("autoPin", !v.autoPin)} />
            </div>
          )}
        </div>
      )}

      {!!accts.data?.accounts.length && (
        <div className="adm-field">
          <span className="adm-label">Accounts</span>
          {accts.data.accounts.map((a) => (
            <div key={a.id} className="adm-line">
              <div className="adm-line-text"><span>{a.name}</span><span className="adm-soft small">{a.text}</span></div>
              <a className={`adm-btn small${a.on ? "" : " primary"}`} href={href(`/admin/addons/${a.id}`)} onClick={(e) => follow(e, `/admin/addons/${a.id}`)}>{a.on ? "Change" : "Sign in"}</a>
            </div>
          ))}
        </div>
      )}

      <div className="adm-field">
        <span className="adm-label">Signed in on</span>
        {!sessions.data?.sessions.length && <span className="adm-soft">Nowhere right now.</span>}
        {sessions.data?.sessions.map((s) => (
          <div key={s.id} className="adm-line">
            <div className="adm-line-text"><span>{s.device || "A device"}</span><span className="adm-soft small">Last seen {ago(s.seen * 1000)}</span></div>
            <button className="adm-btn small" onClick={async () => { await ui.attempt("Couldn't sign it out", () => api(`/api/admin/sessions/${p.id}/${s.id}`, undefined, "DELETE")); sessions.reload(); }}>Sign out</button>
          </div>
        ))}
      </div>

      <div className="adm-row between adm-foot">
        <button className="adm-btn danger" onClick={() => void remove()} disabled={p.id === me.person.id}>Remove {p.name}</button>
        <div className="adm-row">
          {dirty && <button className="adm-btn" onClick={() => { setDraft({}); setName(p.name); }}>Undo</button>}
          <button className="adm-btn primary" disabled={!dirty} onClick={() => void save()}>{dirty ? "Save" : "Saved"}</button>
        </div>
      </div>
    </section>
  );
}

function Check({ label, help, on, flip, disabled }: { label: string; help?: string; on: boolean; flip: () => void; disabled?: boolean }) {
  return (
    <label className={`adm-check${disabled ? " off" : ""}`}>
      <span className="adm-line-text"><span>{label}</span>{help && <span className="adm-soft small">{help}</span>}</span>
      <input type="checkbox" checked={on} disabled={disabled} onChange={flip} />
    </label>
  );
}
