// The frame: signing in, the menu (rail), and the screen on top of the stack.
import { useEffect, useState, type ReactNode } from "react";
import { Home as HomeI, Film, Tv, Radio, Gamepad2, Music as MusicI, Search as SearchI, ShoppingBag, Settings as SettingsI, LayoutGrid, Ellipsis } from "lucide-react";
import { api, connectEvents, onChange, setToken, token, whenSignedOut, type Person } from "./api.ts";
import { F, G, pointer, setFocus, useFocusOnMount } from "./focus.tsx";
import { NavProvider, useNav, type Screen } from "./nav.tsx";
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
import { Settings } from "./screens/Settings.tsx";
import { Apps } from "./screens/Apps.tsx";
import { Player } from "./screens/Player.tsx";

export interface Me { person: Person; server: { name: string; version: string; id: string }; games: boolean }

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

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
    else setChecked(true);
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
          void api("/api/logout", {}).catch(() => {});
          setToken("");
          setMe(null);
        }} refresh={loadMe} />
      ) : (
        <Profiles onSignedIn={(t) => {
          setToken(t);
          void loadMe();
        }} />
      )}
    </UIProvider>
  );
}

const SECTIONS = [
  { id: "home", label: "Home", icon: <HomeI /> },
  { id: "films", label: "Films", icon: <Film /> },
  { id: "series", label: "Series", icon: <Tv /> },
  { id: "live", label: "Live TV", icon: <Radio /> },
  { id: "games", label: "Games", icon: <Gamepad2 /> },
  { id: "music", label: "Music", icon: <MusicI /> },
  { id: "apps", label: "Apps", icon: <LayoutGrid /> },
  { id: "search", label: "Search", icon: <SearchI /> },
  { id: "store", label: "Store", icon: <ShoppingBag /> },
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
  const sections = SECTIONS.filter((s) => (s.id !== "games" || me.games) && (s.id !== "apps" || android));
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
  const body = screenFor(top, me, refresh);
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

function screenFor(s: Screen, me: Me, refresh: () => void): ReactNode {
  const p = s.params;
  switch (s.name) {
    case "home": return <Home />;
    case "films": return <Films source={p.source ?? ""} />;
    case "series": return <Series source={p.source ?? ""} />;
    case "music": return <Music />;
    case "live": return <Live />;
    case "games": return <Games />;
    case "apps": return <Apps />;
    case "page": return <AddonPage id={p.id} title={p.title} />;
    case "item": return <Item id={p.id} me={me} />;
    case "search": return <Search />;
    case "store": return <Store me={me} />;
    case "addon": return <AddonInfo id={p.id} me={me} />;
    case "settings": return <Settings me={me} refresh={refresh} />;
    case "player": return <Player {...(p as any)} />;
  }
  return <div className="page"><h1>Not found</h1></div>;
}
