// The frame: Who's watching first, then either the watching side (/web/...) or the admin
// (/web/admin/...). The admin needs an admin signed in.
import { useCallback, useEffect, useState } from "react";
import { api, closeEvents, deviceId, deviceName, onChange, pic, setToken, token } from "./api";
import { go, useRoute } from "./router";
import { ui, UiHost } from "./ui";
import type { Me, PersonBrief } from "./types";
import { Watch } from "./watch/Watch";
import { Admin } from "./admin/Admin";
import { Lock } from "lucide-react";

export function App() {
  const route = useRoute();
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    if (!token()) {
      setMe(null);
      setChecked(true);
      return;
    }
    try {
      setMe(await api<Me>("/api/me"));
    } catch {
      setToken("");
      setMe(null);
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    void load();
    const out = () => {
      setToken("");
      closeEvents();
      setMe(null);
    };
    window.addEventListener("korie:signedout", out);
    return () => window.removeEventListener("korie:signedout", out);
  }, [load]);

  // a change to people or add-ons can change what this person may do
  useEffect(() => {
    if (!me) return;
    return onChange((w) => {
      if (w.includes("people") || w.includes("addons")) void api<Me>("/api/me").then(setMe, () => {});
    });
  }, [me?.person.id]);

  const signOut = useCallback(() => {
    void api("/api/logout", {}).catch(() => {});
    setToken("");
    closeEvents();
    setMe(null);
  }, []);

  if (!checked) return <div className="splash" />;
  const wantsAdmin = route.parts[0] === "admin";
  let page;
  if (!me) page = <WhoIsWatching adminOnly={wantsAdmin} onIn={load} />;
  else if (wantsAdmin && !me.person.admin) page = <NotAdmin me={me} signOut={signOut} />;
  else if (wantsAdmin) page = <Admin me={me} route={route} signOut={signOut} />;
  else page = <Watch me={me} route={route} signOut={signOut} refresh={load} />;
  return (
    <>
      {page}
      <UiHost />
    </>
  );
}

function NotAdmin({ me, signOut }: { me: Me; signOut: () => void }) {
  return (
    <div className="who">
      <h1>Only an admin can manage Korie</h1>
      <p className="soft">{me.person.name} isn't an admin. Switch to a person who is.</p>
      <div className="buttons center">
        <button className="btn" onClick={() => go("/")}>Back to watching</button>
        <button className="btn primary" onClick={signOut}>Switch person</button>
      </div>
    </div>
  );
}

export function Face({ name, color, size = "m" }: { name: string; color: string; size?: "s" | "m" | "l" }) {
  return <span className={`face face-${size}`} style={{ background: color }}>{name.trim().slice(0, 1).toUpperCase()}</span>;
}

function WhoIsWatching({ onIn, adminOnly }: { onIn: () => void; adminOnly: boolean }) {
  const [people, setPeople] = useState<PersonBrief[] | null>(null);
  const [error, setError] = useState("");
  const [server, setServer] = useState("");
  useEffect(() => {
    api<PersonBrief[]>("/api/people").then(setPeople, (e) => setError(e.message));
    api<{ name: string }>("/api/hello").then((h) => setServer(h.name), () => {});
  }, []);

  const pick = async (p: PersonBrief) => {
    let pin: string | null = null;
    for (;;) {
      if (p.hasPin) {
        pin = await ui.pin(p.name, pin === null ? "Type your PIN." : "That wasn't it. Try again.");
        if (pin === null) return;
      }
      try {
        const r = await api<{ token: string }>("/api/login", { person: p.id, pin, device: deviceName(), deviceId: deviceId() });
        setToken(r.token);
        onIn();
        return;
      } catch (e: any) {
        if (e.status === 403 && p.hasPin) continue;
        await ui.message("Couldn't sign in", e.message);
        return;
      }
    }
  };

  const shown = (people ?? []).filter((p) => !adminOnly || p.admin);
  return (
    <div className="who">
      <div className="who-top"><span className="brand"><i />korie</span>{server && <span className="soft">{server}</span>}</div>
      <h1>{adminOnly ? "Who's managing Korie?" : "Who's watching?"}</h1>
      {error && <p className="bad">{error}</p>}
      <div className="who-faces">
        {shown.map((p) => (
          <button key={p.id} className="who-face" onClick={() => void pick(p)}>
            <span className="who-pic" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>
            <span className="who-name">{p.name}{p.hasPin && <Lock size={14} aria-label="has a PIN" />}</span>
          </button>
        ))}
      </div>
      <div className="buttons center">
        {adminOnly ? <button className="btn ghost" onClick={() => go("/")}>Watch instead</button>
          : <button className="btn ghost" onClick={() => go("/admin")}>Manage Korie</button>}
      </div>
    </div>
  );
}

export { pic };
