// The parts of an add-on's page that the add-on describes and Korie draws: its accounts (one for the
// house with a profile per person, or each person's own), what shows up (its switches and choices),
// its live channels (show/hide, order, test) and what it says about one person's view of it.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ui, useData } from "../ui";
import type { AddonView } from "../types";
import { ago } from "./Admin";

interface Field { key: string; label: string; type: string }
interface Accounts {
  who: "house" | "person"; label: string; help: string; fields: Field[]; profiles: boolean;
  house: { name: string; profiles: { id: string; name: string; kid: boolean }[]; mapping: Record<string, string>; at: number } | null;
  people: { id: string; name: string; color: string; account: { name: string; at: number } | null; mayUse: boolean }[];
}

function Signal({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={`adm-signal${on ? " on" : ""}`}><span className="adm-signal-dot" />{children}</span>;
}

function SignIn({ title, fields, help, busy, send, cancel }: { title: string; fields: Field[]; help: string; busy: boolean; send: (v: Record<string, string>) => void; cancel?: () => void }) {
  const [v, setV] = useState<Record<string, string>>({});
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <form className="adm-signin" aria-label={title} onSubmit={(e) => { e.preventDefault(); send(v); }}>
      <h3 className="adm-h3">{title}</h3>
      {fields.map((f, i) => (
        <div key={f.key} className="adm-field">
          <label htmlFor={`acc-${f.key}`}>{f.label}</label>
          <input ref={i === 0 ? first : undefined} id={`acc-${f.key}`} className="adm-input" type={f.type === "password" ? "password" : f.key === "email" ? "email" : "text"}
            autoComplete={f.type === "password" ? "current-password" : "username"} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
        </div>
      ))}
      {help && <span className="adm-soft small">{help}</span>}
      <div className="adm-row end">
        {cancel && <button type="button" className="adm-btn" onClick={cancel}>Cancel</button>}
        <button type="submit" className="adm-btn primary" disabled={busy || fields.some((f) => !(v[f.key] ?? "").trim())}>{busy ? "Signing in…" : "Sign in"}</button>
      </div>
    </form>
  );
}

/** The add-on's accounts. onPeople: who's signed in (for the parts that are about one person). */
export function AccountsPart({ v, onPeople }: { v: AddonView; onPeople?: (ids: string[]) => void }) {
  const { data, error, reload } = useData(() => api<Accounts>(`/api/admin/accounts?id=${encodeURIComponent(v.id)}`), [v.id], ["addons"]);
  const [signing, setSigning] = useState<string | null>(null); // "house" or a person id
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const ids = data?.who === "person" ? data.people.filter((p) => p.account).map((p) => p.id) : [];
  const key = ids.join(",");
  useEffect(() => onPeople?.(ids), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="adm-bad">{error}</p>;
  if (!data) return null;
  const login = async (person: string, fields: Record<string, string>) => {
    setBusy(true);
    setWhy("");
    try {
      await api("/api/admin/accounts/login", { id: v.id, person: person === "house" ? undefined : person, fields });
      setSigning(null);
      reload();
    } catch (e) {
      setWhy(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const logout = async (person: string, name: string) => {
    if (!(await ui.confirm(`Sign ${name} out of ${v.name}?`, data.who === "house" ? `Korie forgets the ${data.label}. ${v.name} keeps working without it where it can.` : `${name}'s ${v.name} films and series go from their Korie until they sign in again.`, "Sign out"))) return;
    await ui.attempt("Couldn't sign out", () => api("/api/admin/accounts/logout", { id: v.id, person: person === "house" ? undefined : person }));
    reload();
  };
  const setProfile = async (person: string, profile: string) => {
    await ui.attempt("Couldn't change it", () => api("/api/admin/accounts/profile", { id: v.id, person, profile }));
    reload();
  };

  if (data.who === "house") {
    const h = data.house;
    return (
      <section aria-labelledby="acct" className="adm-card adm-list">
        <div className="adm-row between">
          <div className="adm-line-text">
            <h2 id="acct" className="adm-h2">{data.label}</h2>
            {h ? <Signal on>Signed in as {h.name}</Signal> : <Signal on={false}>Not signed in</Signal>}
          </div>
          {h && <button className="adm-btn" onClick={() => void logout("house", "the house")}>Sign out</button>}
        </div>
        {data.help && <p className="adm-soft max">{data.help}</p>}
        {!h && <SignIn title={`Sign in to ${v.name}`} fields={data.fields} help="" busy={busy} send={(f) => void login("house", f)} />}
        {why && <p className="adm-bad" role="alert">{why}</p>}
        {h && data.profiles && (
          <div className="adm-stack small-gap">
            <strong>Who uses which {v.name} profile</strong>
            {!h.profiles.length && <p className="adm-soft small">The account has no profiles. Make some on {v.name} and sign in again.</p>}
            {!!h.profiles.length && data.people.map((p) => (
              <div key={p.id} className="adm-line">
                <span className="adm-dot" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>
                <label htmlFor={`prof-${p.id}`} className="adm-who adm-bold">{p.name}</label>
                <select id={`prof-${p.id}`} className="adm-input adm-select" value={h.mapping[p.id] ?? ""} onChange={(e) => void setProfile(p.id, e.target.value)}>
                  {h.profiles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.kid ? " (child)" : ""}</option>)}
                  <option value="">No {v.name} profile</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  const who = data.people.find((p) => p.id === signing);
  return (
    <>
      <section aria-labelledby="acct" className="adm-card adm-list">
        <h2 id="acct" className="adm-h2">{data.label}s <span className="adm-soft small">(optional)</span></h2>
        {data.help && <p className="adm-soft max">{data.help}</p>}
        {data.people.map((p) => (
          <div key={p.id} className="adm-line">
            <span className="adm-dot big" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>
            <span className="adm-line-text">
              <strong>{p.name}</strong>
              {p.account ? <Signal on>Signed in as {p.account.name}{p.account.at ? ` · ${ago(p.account.at * 1000)}` : ""}</Signal>
                : <span className="adm-soft small">{p.mayUse ? `Not signed in: they get the add-ons for everyone` : `Not signed in. ${p.name} may not use ${v.name} (People).`}</span>}
            </span>
            {p.account ? <button className="adm-btn" onClick={() => void logout(p.id, p.name)}>Sign out</button>
              : <button className="adm-btn primary" onClick={() => { setWhy(""); setSigning(p.id); }}>Sign in</button>}
          </div>
        ))}
      </section>
      {who && (
        <section className="adm-card adm-list">
          <SignIn key={who.id} title={`Sign ${who.name} in to ${v.name}`} fields={data.fields} help="" busy={busy} send={(f) => void login(who.id, f)} cancel={() => setSigning(null)} />
          {why && <p className="adm-bad" role="alert">{why}</p>}
        </section>
      )}
    </>
  );
}

/** "What shows up": the add-on's switches, and its choices (Picture: Best / Save data). */
export function ShowsPart({ v, saved }: { v: AddonView; saved: () => void }) {
  const toggles = v.settings.filter((s) => s.type === "toggle");
  const choices = v.settings.filter((s) => s.type === "choice");
  if (!toggles.length && !choices.length) return null;
  const set = async (key: string, value: unknown) => {
    await ui.attempt("Couldn't change it", () => api("/api/addon/setting", { id: v.id, key, value }));
    saved();
  };
  return (
    <section aria-labelledby="show" className="adm-card adm-list flex-half">
      <h2 id="show" className="adm-h2">What shows up</h2>
      {toggles.map((t) => (
        <div key={t.key} className="adm-line between">
          <span className="adm-line-text"><strong>{t.label}</strong>{t.help && <span className="adm-soft small">{t.help}</span>}</span>
          <button type="button" role="switch" aria-checked={t.value === true} aria-label={t.label} className={`adm-switch${t.value === true ? " on" : ""}`} onClick={() => void set(t.key, t.value !== true)}><span /></button>
        </div>
      ))}
      {choices.map((c) => (
        <div key={c.key} className="adm-stack small-gap">
          <strong id={`ch-${c.key}`}>{c.label}</strong>
          {c.help && <span className="adm-soft small">{c.help}</span>}
          <div className="adm-row" role="group" aria-labelledby={`ch-${c.key}`}>
            {(c.options ?? []).map(([val, label]) => (
              <button key={val} type="button" aria-pressed={c.value === val} className={`adm-btn${c.value === val ? " picked" : ""}`} onClick={() => c.value !== val && void set(c.key, val)}>{label}</button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

interface Channel { id: string; title: string; hidden: boolean }

/** Live channels: which show, in which order (drag, or the arrow keys on the handle), and do they play. */
export function ChannelsPart({ v, channels, changed }: { v: AddonView; channels: Channel[]; changed: () => void }) {
  const [list, setList] = useState(channels);
  const [drag, setDrag] = useState<number | null>(null);
  const [test, setTest] = useState<{ busy: boolean; results: Record<string, { ok: boolean; error: string }> }>({ busy: false, results: {} });
  const key = channels.map((c) => c.id + (c.hidden ? "-" : "+")).join(",");
  useEffect(() => setList(channels), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveOrder = async (l: Channel[]) => {
    await ui.attempt("Couldn't move it", () => api("/api/admin/addon/order", { id: v.id, order: l.map((c) => c.id) }));
    changed();
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return list;
    const l = [...list];
    const [c] = l.splice(from, 1);
    l.splice(to, 0, c);
    setList(l);
    return l;
  };
  const show = async (c: Channel, on: boolean) => {
    const hidden = list.filter((x) => (x.id === c.id ? !on : x.hidden)).map((x) => x.id);
    setList(list.map((x) => (x.id === c.id ? { ...x, hidden: !on } : x)));
    await ui.attempt("Couldn't change it", () => api("/api/admin/addon/hidden", { id: v.id, hidden }));
    changed();
  };
  const runTest = async () => {
    setTest({ busy: true, results: {} });
    const r = await ui.attempt("Couldn't test the channels", () => api<{ results: { id: string; ok: boolean; error: string }[] }>("/api/admin/addon/test", { id: v.id }));
    setTest({ busy: false, results: Object.fromEntries((r?.results ?? []).map((x) => [x.id, x])) });
  };
  const bad = list.filter((c) => test.results[c.id] && !test.results[c.id].ok);
  return (
    <section aria-labelledby="chans" className="adm-card adm-list flex-half">
      <h2 id="chans" className="adm-h2">Live channels</h2>
      <p className="adm-soft small">In this order in Live TV. Drag to move. Untick one to hide it.</p>
      <ol className="adm-chans">
        {list.map((c, i) => {
          const r = test.results[c.id];
          return (
            <li key={c.id} className={`adm-line${drag === i ? " dragging" : ""}`} draggable
              onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i); } }}
              onDragEnd={() => { setDrag(null); void saveOrder(list); }}>
              <button type="button" className="adm-grip" aria-label={`Move ${c.title} (arrow keys)`}
                onKeyDown={(e) => {
                  const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -2;
                  if (to === -2) return;
                  e.preventDefault();
                  if (to < 0 || to >= list.length) return;
                  const l = move(i, to);
                  void saveOrder(l);
                  window.setTimeout(() => (document.querySelectorAll(".adm-grip")[to] as HTMLElement | undefined)?.focus(), 0);
                }}>⠿</button>
              <strong className={`grow${c.hidden ? " adm-faded" : ""}`}>{c.title}</strong>
              {test.busy && <span className="adm-soft small">Testing…</span>}
              {r && <span className={`small ${r.ok ? "adm-good" : "adm-bad"}`}>{r.ok ? "Plays" : "Doesn't play"}</span>}
              <input type="checkbox" className="adm-tick" checked={!c.hidden} aria-label={`Show ${c.title}`} onChange={(e) => void show(c, e.target.checked)} />
            </li>
          );
        })}
      </ol>
      <button type="button" className="adm-btn start" disabled={test.busy} onClick={() => void runTest()}>{test.busy ? "Testing the channels…" : "Test the channels"}</button>
      {bad.map((c) => (
        <div key={c.id} className="adm-alert"><span className="adm-alert-bar" /><p>{c.title} {/^said no/.test(test.results[c.id].error) ? "" : "doesn't play: "}{test.results[c.id].error}</p></div>
      ))}
    </section>
  );
}

interface Act { call: string; value: string; label: string }
interface About { about: null | { sections: { title: string; text: string; items: { title: string; subtitle: string; remove: Act | null }[]; add: { call: string; label: string; placeholder: string; help: string } | null }[]; rows: { id: string; title: string; section: string; hidden: boolean }[] }; error?: string }

/** What the add-on says about one person's view of it, and which of its rows show for them. */
export function AboutPart({ v, person, personName, pick, tag = "h" }: { v: AddonView; person: string | null; personName: string; pick?: React.ReactNode; tag?: string }) {
  const { data, reload } = useData(() => api<About>(`/api/admin/addon/about?id=${encodeURIComponent(v.id)}${person ? `&person=${encodeURIComponent(person)}` : ""}`), [v.id, person], ["addons"]);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState("");
  const [why, setWhy] = useState("");
  const a = data?.about;
  const act = async (call: string, value: string, what: string) => {
    setBusy(what);
    setWhy("");
    try {
      await api("/api/admin/addon/act", { id: v.id, person, call, value });
      if (what === "add") setTyped("");
      reload();
    } catch (e) {
      setWhy(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  };
  if (data?.error) return <p className="adm-bad">{v.name}: {data.error}</p>;
  if (!a) return null;
  const setRow = async (id: string, on: boolean) => {
    const hidden = a.rows.filter((r) => (r.id === id ? !on : r.hidden)).map((r) => r.id);
    await ui.attempt("Couldn't change it", () => api("/api/admin/addon/rows", { id: v.id, person, hidden }));
    reload();
  };
  return (
    <>
      {a.sections.map((s, i) => (
        <section key={i} className="adm-card adm-list" aria-label={s.title}>
          <div className="adm-row between"><h2 className="adm-h2">{s.title}</h2>{i === 0 && pick}</div>
          {s.text && <p className="adm-soft">{s.text}</p>}
          {s.items.map((x, j) => (
            <div key={j} className="adm-line">
              <span className="adm-line-text"><strong>{x.title}</strong><span className="adm-soft small">{x.subtitle}</span></span>
              {x.remove && <button className="adm-btn small" disabled={!!busy} onClick={async () => {
                if (await ui.confirm(`${x.remove!.label} ${x.title}?`, personName ? `It goes from ${personName}'s ${v.name} too.` : "", x.remove!.label)) void act(x.remove!.call, x.remove!.value, `rm${j}`);
              }}>{busy === `rm${j}` ? "…" : x.remove.label}</button>}
            </div>
          ))}
          {s.add && (
            <form className="adm-stack small-gap" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) void act(s.add!.call, typed.trim(), "add"); }}>
              <label htmlFor={`add-${tag}-${i}`} className="adm-bold">{s.add.label}</label>
              <div className="adm-row">
                <input id={`add-${tag}-${i}`} className="adm-input grow" value={typed} placeholder={s.add.placeholder} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
                <button type="submit" className="adm-btn primary" disabled={!typed.trim() || !!busy}>{busy === "add" ? "Adding…" : "Add"}</button>
              </div>
              {s.add.help && <span className="adm-soft small">{s.add.help}</span>}
            </form>
          )}
          {why && <p className="adm-bad" role="alert">{why}</p>}
        </section>
      ))}
      {a.rows.length > 0 && (
        <section className="adm-card adm-list" aria-labelledby={`rows-${tag}`}>
          <div className="adm-row between"><h2 id={`rows-${tag}`} className="adm-h2">Which catalogues show up{personName ? ` for ${personName}` : v.accounts?.who === "person" ? " for everyone" : ""}</h2>{!a.sections.length && pick}</div>
          <div className="adm-checks">
            {a.rows.map((r) => (
              <label key={r.id} className="adm-checkline"><input type="checkbox" className="adm-tick" checked={!r.hidden} onChange={(e) => void setRow(r.id, e.target.checked)} />{r.title}</label>
            ))}
          </div>
          <span className="adm-soft small">The list comes from {personName ? `${personName}'s` : "these"} {v.name} add-ons, so it changes with them.{!personName && v.accounts?.who === "person" ? ` Someone signed in to ${v.name} picks their own below.` : ""}</span>
        </section>
      )}
    </>
  );
}
