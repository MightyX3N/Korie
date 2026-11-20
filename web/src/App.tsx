// The frame: Who's watching first, then either the watching side (/web/...) or the admin
// (/web/admin/...). The admin needs an admin signed in.
import { useCallback, useEffect, useState } from "react";
import { api, closeEvents, deviceId, deviceName, householdToken, onChange, pic, setHouseholdToken, setToken, token } from "./api";
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
  if (route.parts[0] === "register") page = <Register onIn={load} />;
  else if (!me) page = <WhoIsWatching adminOnly={wantsAdmin} onIn={load} />;
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

interface Hello { name: string; outside: boolean; household: { id: string; name: string } | null; register: "off" | "open" | "approval" }

function WhoIsWatching({ onIn, adminOnly }: { onIn: () => void; adminOnly: boolean }) {
  const [people, setPeople] = useState<PersonBrief[] | null>(null);
  const [error, setError] = useState("");
  const [hello, setHello] = useState<Hello | null>(null);
  // outside the home this browser signs in to its household first (once)
  const [needHousehold, setNeedHousehold] = useState(false);
  const [refused, setRefused] = useState<{ message: string; url: string } | null>(null);
  const loadPeople = useCallback(() => {
    setError("");
    api<PersonBrief[]>("/api/people").then((x) => {
      setPeople(x);
      setNeedHousehold(false);
    }, (e) => {
      if (e.data?.household === "needed") {
        // the household's sign-in ended (a new password, or the admin stopped it)
        setHouseholdToken("");
        setNeedHousehold(true);
      } else setError(e.message);
    });
    api<Hello>("/api/hello").then(setHello, () => {});
  }, []);
  useEffect(loadPeople, [loadPeople]);
  const server = hello?.name ?? "";

  if (needHousehold) return <HouseholdSignIn server={server} register={hello?.register ?? "off"} onIn={loadPeople} />;

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
        if (e.data?.household === "refused") {
          setRefused({ message: e.message, url: e.data.url ?? "" });
          return;
        }
        if (e.data?.household === "needed") {
          loadPeople();
          return;
        }
        if (e.status === 403 && p.hasPin && e.message === "Wrong PIN.") continue;
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
      {refused && (
        <div className="who-note">
          <p>{refused.message}</p>
          {refused.url && <a className="btn primary" href={refused.url} target="_blank" rel="noreferrer">Open</a>}
        </div>
      )}
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
          : (people ?? []).some((p) => p.admin) && <button className="btn ghost" onClick={() => go("/admin")}>Manage Korie</button>}
        {hello?.household && householdToken() && (
          <button className="btn ghost" onClick={async () => {
            if (!(await ui.confirm(`Leave ${hello.household!.name} on this browser?`, "You'll need the household's name and password to come back.", "Leave"))) return;
            await api("/api/household/signout", {}).catch(() => {});
            setHouseholdToken("");
            setPeople(null);
            loadPeople();
          }}>Leave {hello.household.name}</button>
        )}
      </div>
    </div>
  );
}

/** Outside the home: the household's name and password, once on this browser. */
function HouseholdSignIn({ server, register, onIn }: { server: string; register: Hello["register"]; onIn: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    setError("");
    setUrl("");
    try {
      const r = await api<{ token: string }>("/api/household/signin", { name, password, device: deviceName() });
      setHouseholdToken(r.token);
      onIn();
    } catch (e: any) {
      setError(e.message);
      setUrl(e.data?.url ?? "");
    }
    setBusy(false);
  };
  return (
    <div className="who">
      <div className="who-top"><span className="brand"><i />korie</span>{server && <span className="soft">{server}</span>}</div>
      <h1>Sign in to your household</h1>
      <p className="soft who-lead">You're away from home. Sign in once on this browser with your household's name and password, and then pick who's watching.</p>
      <form className="who-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="field"><span>Household</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoFocus required /></label>
        <label className="field"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="bad">{error}</p>}
        {url && <a className="btn" href={url} target="_blank" rel="noreferrer">Open</a>}
        <button className="btn primary" disabled={busy || !name || !password}>Sign in</button>
      </form>
      {register !== "off" && <button className="btn ghost" onClick={() => go("/register")}>New here? Sign up</button>}
    </div>
  );
}

/** Signing up a new household (when the admin allows it). */
function Register({ onIn }: { onIn: () => void }) {
  const [info, setInfo] = useState<{ mode: Hello["register"]; note: string; name: string } | null>(null);
  const [household, setHousehold] = useState("");
  const [password, setPassword] = useState("");
  const [list, setList] = useState([{ name: "", pin: "" }]);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ state: string; message?: string; url?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ mode: Hello["register"]; note: string; name: string }>("/api/register").then(setInfo, (e) => setError(e.message));
  }, []);
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ state: string; token?: string; message?: string; url?: string }>("/api/register", { household, password, people: list.filter((x) => x.name.trim()), device: deviceName() });
      if (r.state === "active" && r.token) {
        setHouseholdToken(r.token);
        go("/", true);
        onIn();
      } else setDone(r);
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };
  const set = (i: number, k: "name" | "pin", v: string) => setList(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="who">
      <div className="who-top"><span className="brand"><i />korie</span>{info && <span className="soft">{info.name}</span>}</div>
      <h1>Sign up</h1>
      {info?.mode === "off" && <p className="soft">Signing up is turned off on this server. Ask the person who runs it.</p>}
      {done?.state === "pending" && <p className="soft who-lead">Thanks! Your household is waiting for the admin to let it in. Sign in with its name and password once they have.</p>}
      {done?.state === "refused" && (
        <div className="who-note">
          <p>{done.message}</p>
          {done.url && <a className="btn primary" href={done.url} target="_blank" rel="noreferrer">Open</a>}
        </div>
      )}
      {info && info.mode !== "off" && !done && (
        <form className="who-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          {info.note && <p className="soft who-note-text">{info.note}</p>}
          {info.mode === "approval" && <p className="soft">The admin lets new households in.</p>}
          <label className="field"><span>Household name</span><input value={household} onChange={(e) => setHousehold(e.target.value)} placeholder="The Smiths" required autoFocus /></label>
          <label className="field"><span>Household password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={6} required /><small>At least 6 characters. Everyone in the household signs in with it, once per device.</small></label>
          <div className="field"><span>Who's in it</span>
            {list.map((x, i) => (
              <div key={i} className="who-row">
                <input value={x.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="Name" aria-label="Name" />
                <input value={x.pin} onChange={(e) => set(i, "pin", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="PIN (optional)" inputMode="numeric" aria-label="PIN, four digits, optional" />
              </div>
            ))}
            {list.length < 8 && <button type="button" className="btn ghost" onClick={() => setList([...list, { name: "", pin: "" }])}>Add a person</button>}
          </div>
          {error && <p className="bad">{error}</p>}
          <button className="btn primary" disabled={busy}>Sign up</button>
        </form>
      )}
      <button className="btn ghost" onClick={() => go("/", true)}>Back</button>
    </div>
  );
}

export { pic };
