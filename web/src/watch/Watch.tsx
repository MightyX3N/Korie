// The watching side: the menu (on the left, or along the top on a narrow screen) and the page.
import { useEffect, useState } from "react";
import { Film, Gamepad2, Home as HomeIcon, Music2, Radio, Search as SearchIcon, Settings2, Tv, Users, Wrench } from "lucide-react";
import type { Me } from "../types";
import { follow, href, type Route } from "../router";
import { Face } from "../App";
import { setMe } from "./menus";
import { music } from "./music";
import { Home, Library, Live, Games, AddonPage } from "./Screens";
import { ItemPage } from "./ItemPage";
import { Player } from "./Player";
import { MusicPage, MusicBar, NowPlaying } from "./MusicPages";
import { Search } from "./Search";
import { You } from "./You";

const SECTIONS = [
  { id: "", label: "Home", icon: HomeIcon },
  { id: "films", label: "Films", icon: Film },
  { id: "series", label: "Series", icon: Tv },
  { id: "music", label: "Music", icon: Music2 },
  { id: "live", label: "Live TV", icon: Radio },
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "search", label: "Search", icon: SearchIcon },
];

export function Watch({ me, route, signOut, refresh }: { me: Me; route: Route; signOut: () => void; refresh: () => void }) {
  setMe(me);
  const top = route.parts[0] ?? "";
  // signing out stops the music
  useEffect(() => () => music.stop(), [me.person.id]);
  const [narrow, setNarrow] = useState(window.innerWidth < 760);
  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 760);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  if (top === "play") return <Player key={route.parts[1]} id={route.parts[1] ?? ""} />;

  const sections = SECTIONS.filter((s) => (s.id !== "games" || me.games) && (s.id !== "music" || me.person.music));
  // a film's or a category's page belongs to no menu entry
  const active = ["item", "page", "nowplaying"].includes(top) ? null : top;
  let page;
  switch (top) {
    case "": page = <Home />; break;
    case "films": page = <Library kind="films" route={route} />; break;
    case "series": page = <Library kind="series" route={route} />; break;
    case "music": page = <MusicPage route={route} />; break;
    case "live": page = <Live />; break;
    case "games": page = <Games />; break;
    case "search": page = <Search route={route} />; break;
    case "page": page = <AddonPage id={route.parts[1] ?? ""} />; break;
    case "item": page = <ItemPage id={route.parts[1] ?? ""} me={me} />; break;
    case "nowplaying": page = <NowPlaying />; break;
    case "you": page = <You me={me} refresh={refresh} signOut={signOut} />; break;
    default: page = <div className="page"><h1>Not found</h1><p className="soft">There's no page here.</p></div>;
  }

  return (
    <div className={`watch${narrow ? " narrow" : ""}`}>
      <nav className="rail" aria-label="Korie">
        <a className="brand" href={href("/")} onClick={(e) => follow(e, "/")}><i />korie</a>
        <div className="rail-items">
          {sections.map((s) => {
            const Icon = s.icon;
            const on = active === s.id;
            return (
              <a key={s.id} className={`nav${on ? " on" : ""}`} aria-current={on ? "page" : undefined} href={href("/" + s.id)} onClick={(e) => follow(e, "/" + s.id)}>
                <Icon size={20} /><span>{s.label}</span>
              </a>
            );
          })}
        </div>
        <div className="rail-end">
          {me.person.admin && (
            <a className="nav" href={href("/admin")} onClick={(e) => follow(e, "/admin")}><Wrench size={20} /><span>Admin</span></a>
          )}
          <a className={`nav who-me${top === "you" ? " on" : ""}`} href={href("/you")} onClick={(e) => follow(e, "/you")} title="Your settings">
            <Face name={me.person.name} color={me.person.color} size="s" />
            <span>{me.person.name}</span>
            <Settings2 size={16} className="dim" />
          </a>
          <button className="nav" onClick={signOut}><Users size={20} /><span>Switch person</span></button>
        </div>
      </nav>
      <main className="main">{page}</main>
      <MusicBar />
    </div>
  );
}
