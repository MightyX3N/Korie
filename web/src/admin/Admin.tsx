// The admin, as in the approved designs: Overview, Libraries, People, Add-ons (and each add-on's
// own page) and Server. On a phone the menu runs along the top.
import { ArrowLeft } from "lucide-react";
import type { Me } from "../types";
import { follow, href, type Route } from "../router";
import { Overview } from "./Overview";
import { Libraries } from "./Libraries";
import { People } from "./People";
import { Households } from "./Households";
import { Addons, AddonPage } from "./Addons";
import { Server } from "./Server";

const PAGES = [
  { id: "", label: "Overview" },
  { id: "libraries", label: "Libraries" },
  { id: "people", label: "People" },
  { id: "households", label: "Households" },
  { id: "addons", label: "Add-ons" },
  { id: "server", label: "Server" },
];

export function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 34 34" aria-hidden="true">
      <rect x="2" y="5" width="30" height="20" rx="4" fill="none" stroke="#eceef3" strokeWidth="2.4" />
      <path d="M14 11l7 4-7 4z" fill="#e8a33d" />
      <path d="M11 30h12" stroke="#eceef3" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Admin({ me, route, signOut }: { me: Me; route: Route; signOut: () => void }) {
  const page = route.parts[1] ?? "";
  const sub = route.parts[2] ?? "";
  const active = page;
  let body;
  switch (page) {
    case "": body = <Overview />; break;
    case "libraries": body = <Libraries />; break;
    case "people": body = <People me={me} picked={sub} />; break;
    case "households": body = <Households />; break;
    case "addons": body = sub ? <AddonPage id={sub} /> : <Addons tab={route.query.get("tab") ?? "installed"} />; break;
    case "server": body = <Server />; break;
    default: body = <h1 className="adm-h1">Not found</h1>;
  }
  const to = (id: string) => `/admin${id ? "/" + id : ""}`;
  return (
    <div className="adm">
      <nav className="adm-nav" aria-label="Korie admin">
        <div className="adm-brand"><Logo /><span>Korie</span></div>
        <div className="adm-links">
          {PAGES.map((p) => (
            <a key={p.id} href={href(to(p.id))} onClick={(e) => follow(e, to(p.id))} aria-current={active === p.id ? "page" : undefined} className={active === p.id ? "on" : ""}>{p.label}</a>
          ))}
        </div>
        <div className="adm-me">
          <span className="adm-dot" style={{ background: me.person.color }}>{me.person.name.slice(0, 1).toUpperCase()}</span>
          <span className="adm-me-text"><strong>{me.person.name}</strong><button className="adm-link" onClick={signOut}>Sign out</button></span>
        </div>
        <a className="adm-watch" href={href("/")} onClick={(e) => follow(e, "/")}><ArrowLeft size={16} />Watch</a>
      </nav>
      <main className="adm-main">{body}</main>
    </div>
  );
}

/** "2 min ago", "just now", "yesterday". */
export function ago(ms: number): string {
  if (!ms) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function Dot({ color }: { color: string }) {
  return <span className="adm-state-dot" style={{ background: color }} />;
}

export const GOOD = "#5fc48f", BUSY = "#e9c46a", BAD = "#ef7d73";
