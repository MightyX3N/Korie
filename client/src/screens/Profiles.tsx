// Who's watching? Pick yourself (and type your PIN if you have one).
import { useEffect, useState } from "react";
import { api, deviceId, deviceName, type Person } from "../api.ts";
import { F, G, useFocusOnMount } from "../focus.tsx";
import { useUI } from "../ui.tsx";
import { Lock, Plus } from "lucide-react";
import { Clock } from "./common.tsx";

export const COLORS = ["#e8a33d", "#2fb0ea", "#6cc28a", "#d96fa5", "#9b8cf0", "#e86a5c"];

/** An admin says who they are (their PIN), for Add person and Manage people: their token, or null.
 *  This screen doesn't stay signed in as them. */
async function asAdmin(people: Person[], ui: ReturnType<typeof useUI>): Promise<string | null> {
  const admins = people.filter((p) => p.admin);
  if (!admins.length) return null;
  let who = admins[0];
  if (admins.length > 1) {
    const id = await ui.menu("Which admin are you?", admins.map((p) => ({ label: p.name, value: p.id })));
    who = admins.find((p) => p.id === id) ?? (null as unknown as Person);
    if (!who) return null;
  }
  let pin = "";
  if (who.hasPin) {
    const v = await ui.pin(`${who.name}'s PIN`);
    if (v === null) return null;
    pin = v;
  }
  try {
    return (await api<{ token: string }>("/api/login", { person: who.id, pin, device: deviceName(), deviceId: deviceId() })).token;
  } catch (e: any) {
    ui.toast(e.message);
    return null;
  }
}

async function asToken<T>(tok: string, path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { Authorization: `Bearer ${tok}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j as T;
}

export function Profiles({ onSignedIn, onManage }: { onSignedIn: (token: string) => void; onManage: (adminToken: string) => void }) {
  const ui = useUI();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    api<Person[]>("/api/people").then(setPeople).catch((e) => setError(e.message));
  };
  useEffect(load, []);
  useFocusOnMount(people?.length ? `face-${people[0].id}` : error ? "retry" : null, [people, error]);
  const pick = async (p: Person) => {
    let pin = "";
    if (p.hasPin) {
      const v = await ui.pin(`${p.name}'s PIN`);
      if (v === null) return;
      pin = v;
    }
    try {
      const r = await api<{ token: string }>("/api/login", { person: p.id, pin, device: deviceName(), deviceId: deviceId() });
      onSignedIn(r.token);
    } catch (e: any) {
      ui.toast(e.message);
    }
  };
  return (
    <div className="scroll">
      <div className="profiles">
        <div className="profiles-top">
          <div className="brand"><i />korie</div>
          <Clock />
        </div>
        <h1>Who's watching?</h1>
        {error ? (
          <G fk="err" className="dialog" style={{ alignItems: "center" }}>
            <p>{error}</p>
            <F fk="retry" className="btn primary" onEnter={load}>Try again</F>
          </G>
        ) : (
          <G fk="faces" className="faces">
            {people?.map((p) => (
              <F key={p.id} fk={`face-${p.id}`} className="face-btn" onEnter={() => pick(p)}>
                <span className="tile-face" style={{ background: p.color }}>
                  {p.name.slice(0, 1).toUpperCase()}
                  {p.hasPin ? <span className="lock"><Lock /></span> : null}
                </span>
                <span className="name">{p.name}</span>
              </F>
            ))}
            {people?.length ? (
              <F fk="face-add" className="face-btn add" onEnter={async () => {
                const t = await asAdmin(people, ui);
                if (!t) return;
                try {
                  const name = await ui.text("Name of the new person");
                  if (name?.trim()) await asToken(t, "/api/people", { name: name.trim() });
                } catch (e: any) {
                  ui.toast(e.message);
                } finally {
                  await asToken(t, "/api/logout", {}).catch(() => {});
                }
                load();
              }}>
                <span className="tile-face"><Plus /></span>
                <span className="name">Add person</span>
              </F>
            ) : null}
          </G>
        )}
        {people?.length ? (
          <F fk="manage" className="btn outline manage" onEnter={async () => { const t = await asAdmin(people, ui); if (t) onManage(t); }}>Manage people</F>
        ) : null}
        <p className="note">This TV can also sign in as one person by itself: Settings, This device.</p>
      </div>
    </div>
  );
}
