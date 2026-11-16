// The frame: signing in, the menu (rail), and the screen on top of the stack.
import { useEffect, useState, type ReactNode } from "react";
import { Home as HomeI, Film, Tv, Radio, Gamepad2, Music as MusicI, Search as SearchI, Puzzle, Settings as SettingsI, LayoutGrid, Ellipsis } from "lucide-react";
import { api, connectEvents, deviceId, deviceName, onChange, setToken, token, whenSignedOut, type Person } from "./api.ts";
import { F, G, pointer, setFocus, useFocusOnMount } from "./focus.tsx";
import { NavProvider, useBackHandler, useNav, type Screen } from "./nav.tsx";
import { UIProvider, useUI } from "./ui.tsx";
import { android } from "./host.ts";
import { currentForm, onForm, type Form } from "./size.ts";
import { Profiles } from "./screens/Profiles.tsx";
import { Home } from "./screens/Home.tsx";
import { Films, Series, Music } from "./screens/Library.tsx";
import { Live, Games, AddonPage } from "./screens/Rows.tsx";
import { Item } from "./screens/Item.tsx";
import { Search } from "./screens/Search.tsx";
import { Store, AddonInfo } from "./screens/Store.tsx";
import { Settings, People } from "./screens/Settings.tsx";
import { Apps } from "./screens/Apps.tsx";
import { Player } from "./screens/Player.tsx";
import { NowPlaying } from "./screens/NowPlaying.tsx";
import * as music from "./music.ts";

export interface Me { person: Person; server: { name: string; version: string; id: string }; games: boolean; languages?: [string, string][] }

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  // Manage people from Who's watching: an admin's session only while People is open
  const [managing, setManaging] = useState<string | null>(null);

  const loadMe = () =>
    api<Me>("/api/me")
      .then((m) => {
        setMe(m);
        connectEvents();
      })
      .catch(() => setMe(null))
      .finally(() => setChecked(true));

  useEffect(() => {
    whenSignedOut(() => setMe(null));
    if (token()) void loadMe();
    else {
      // a device that signs in as someone by itself (Settings, People) skips Who's watching
      api<{ token: string | null }>("/api/auto", { device: deviceName(), deviceId: deviceId() })
        .then((r) => {
          if (r.token) {
            setToken(r.token);
            void loadMe();
          } else setChecked(true);
        })
        .catch(() => setChecked(true));
    }
    // the mouse: hovering focuses; the keyboard or remote takes over again
    const onMove = (e: MouseEvent) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) {
        pointer.active = true;
        document.body.classList.add("mouse");
      }
    };
    const onKey = () => {
      pointer.active = false;
      document.body.classList.remove("mouse");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    if (!me) return;
    return onChange((what) => {
      if (what.includes("addons") || what.includes("people")) void loadMe();
    });
  }, [me]);

  if (!checked) return null;
  return (
    <UIProvider>
      {me ? (
        <Signed me={me} signOut={() => {
          music.stop();
          void api("/api/logout", {}).catch(() => {});
          setToken("");
          setMe(null);
        }} refresh={loadMe} />
      ) : (
        managing ? (
          <ManagePeople token={managing} done={() => {
            void api("/api/logout", {}).catch(() => {});
            setToken("");
            setManaging(null);
          }} />
        ) : (
          <Profiles onSignedIn={(t) => {
            setToken(t);
            void loadMe();
          }} onManage={(t) => {
            setToken(t);
            setManaging(t);
          }} />
        )
      )}
    </UIProvider>
  );
}

/** Settings › People on its own, from Who's watching; Back closes it (and signs the admin out). */
function ManagePeople({ token: _t, done }: { token: string; done: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch(done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!me) return null;
  return (
    <NavProvider home="people">
      {() => <ManageFrame me={me} done={done} />}
    </NavProvider>
  );
}

function ManageFrame({ me, done }: { me: Me; done: () => void }) {
  useBackHandler(() => {
    done();
    return true;
  });
  return (
    <div className="app">
      <main className="main">
        <G fk="content" className="scroll">
          <People me={me} refresh={() => {}} />
        </G>
      </main>
    </div>
  );
}

const SECTIONS = [
  { id: "home", label: "Home", icon: <HomeI /> },
  { id: "films", label: "Films", icon: <Film /> },
  { id: "series", label: "Series", icon: <Tv /> },
  { id: "music", label: "Music", icon: <MusicI /> },
  { id: "live", label: "Live TV", icon: <Radio /> },
  { id: "games", label: "Games", icon: <Gamepad2 /> },
  { id: "store", label: "Add-ons", icon: <Puzzle /> },
  { id: "apps", label: "Apps", icon: <LayoutGrid /> },
  { id: "search", label: "Search", icon: <SearchI /> },
  { id: "settings", label: "Settings", icon: <SettingsI /> },
];
const PHONE_TABS = ["home", "films", "series", "search"];

/** Back from a game in the desktop app: start where it was opened (Games). */
function firstSection(): string {
  try {
    const s = sessionStorage.getItem("korie.section");
    sessionStorage.removeItem("korie.section");
    return s || "home";
  } catch {
    return "home";
  }
}

function Signed({ me, signOut, refresh }: { me: Me; signOut: () => void; refresh: () => void }) {
  return (
    <NavProvider home="home" first={firstSection()}>
      {(top) => <Frame me={me} top={top} signOut={signOut} refresh={refresh} />}
    </NavProvider>
  );
}

function Frame({ me, top, signOut, refresh }: { me: Me; top: Screen; signOut: () => void; refresh: () => void }) {
  const nav = useNav();
  const ui = useUI();
  const [form, setForm] = useState<Form>(currentForm());
  useEffect(() => onForm(setForm), []);
  const sections = SECTIONS.filter((s) => (s.id !== "games" || me.games) && (s.id !== "apps" || android) && (s.id !== "music" || me.person.music !== false));
  const section = nav.stack[0].name;
  const fullScreen = top.name === "player";
  // the screen starts with the menu's own entry focused (Home on Home)
  useFocusOnMount(`nav-${section}`, [me.person.id]);

  const more = async () => {
    const rest = sections.filter((s) => !PHONE_TABS.includes(s.id));
    const v = await ui.menu("", [...rest.map((s) => ({ label: s.label, value: s.id, icon: s.icon })), { label: "Switch person", value: "@people" }]);
    if (v === "@people") signOut();
    else if (v) nav.go(v);
  };

  const shown = form === "phone" ? sections.filter((s) => PHONE_TABS.includes(s.id)) : sections;
  const body = screenFor(top, me, refresh, signOut);
  if (fullScreen) return <>{body}</>;
  return (
    <div className="app">
      <G fk="rail" className="rail" stop={["up", "down", "left"]} preferred={`nav-${section}`}>
        <div className="brand"><i />korie</div>
        {shown.map((s) => (
          <F key={s.id} fk={`nav-${s.id}`} className={"nav" + (section === s.id ? " active" : "")} onEnter={() => {
            if (section === s.id && nav.stack.length === 1) setFocus("content");
            else nav.go(s.id);
          }}>
            {s.icon}
            <span>{s.label}</span>
          </F>
        ))}
        {form === "phone" && <F fk="nav-more" className="nav" onEnter={more}><Ellipsis /><span>More</span></F>}
        <div className="grow" />
        <F fk="nav-who" className="who" onEnter={signOut}>
          <span className="avatar" style={{ background: me.person.color }}>{me.person.name.slice(0, 1).toUpperCase()}</span>
          <span>{me.person.name}<small>Switch person</small></span>
        </F>
      </G>
      <main className="main">
        <G fk="content" key={top.key} className="scroll">
          {body}
        </G>
      </main>
    </div>
  );
}

function screenFor(s: Screen, me: Me, refresh: () => void, signOut: () => void): ReactNode {
  const p = s.params;
  switch (s.name) {
    case "home": return <Home />;
    case "films": return <Films source={p.source ?? ""} />;
    case "series": return <Series source={p.source ?? ""} />;
    case "music": return <Music />;
    case "live": return <Live />;
    case "games": return <Games />;
    case "apps": return <Apps me={me} />;
    case "page": return <AddonPage id={p.id} title={p.title} />;
    case "item": return <Item id={p.id} me={me} />;
    case "search": return <Search />;
    case "store": return <Store me={me} />;
    case "addon": return <AddonInfo id={p.id} me={me} />;
    case "settings": return <Settings me={me} refresh={refresh} signOut={signOut} />;
    case "people": return <People me={me} refresh={refresh} />;
    case "player": return <Player {...(p as any)} />;
    case "nowplaying": return <NowPlaying />;
  }
  return <div className="page"><h1>Not found</h1></div>;
}
