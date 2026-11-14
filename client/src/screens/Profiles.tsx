// Who's watching? Pick yourself (and type your PIN if you have one).
import { useEffect, useState } from "react";
import { api, deviceName, type Person } from "../api.ts";
import { F, G, useFocusOnMount } from "../focus.tsx";
import { useUI } from "../ui.tsx";

export const COLORS = ["#e8a33d", "#2fb0ea", "#6cc28a", "#d96fa5", "#9b8cf0", "#e86a5c"];

export function Profiles({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const ui = useUI();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState("");
  const [server, setServer] = useState("Korie");
  const load = () => {
    setError("");
    api<Person[]>("/api/people").then(setPeople).catch((e) => setError(e.message));
    api<{ name: string }>("/api/hello").then((h) => setServer(h.name)).catch(() => {});
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
      const r = await api<{ token: string }>("/api/login", { person: p.id, pin, device: deviceName() });
      onSignedIn(r.token);
    } catch (e: any) {
      ui.toast(e.message);
    }
  };
  return (
    <div className="scroll">
      <div className="profiles">
        <div className="brand" style={{ padding: 0, fontSize: "2.4rem" }}><i style={{ width: "1rem", height: "1rem" }} />korie</div>
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
                <span className="avatar" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>
                <span style={{ fontSize: "1.2rem" }}>{p.name}</span>
              </F>
            ))}
          </G>
        )}
        <p className="note">{server}</p>
      </div>
    </div>
  );
}
