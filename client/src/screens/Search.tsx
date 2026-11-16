// Search: your library and every add-on that can search. A keyboard for the
// remote on the left; typing on a real keyboard works too.
import { useEffect, useRef, useState } from "react";
import { Search as SearchI } from "lucide-react";
import { pic, type Card } from "../api.ts";
import { F, G } from "../focus.tsx";
import { rem } from "../cards.tsx";
import { androidApps } from "../host.ts";
import { useData } from "../data.ts";
import { useNav } from "../nav.tsx";
import { Clock, Status, useOpener } from "./common.tsx";
import { currentForm } from "../size.ts";

const KEYS = "abcdefghijklmnopqrstuvwxyzæøå1234567890".split("");

export function Search() {
  const nav = useNav();
  const [q, setQ] = useState<string>(nav.top.params.q ?? "");
  const [debounced, setDebounced] = useState(q);
  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".overlay")) return;
      if (e.key === "Backspace" && qRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setQ((x) => x.slice(0, -1));
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setQ((x) => x + e.key);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const { data } = useData<{ groups: { id: string; title: string; items: Card[]; loading?: boolean }[] }>(debounced.trim() ? `/api/search?q=${encodeURIComponent(debounced.trim())}` : null, ["search"]);
  const { open, menu } = useOpener();
  const phone = currentForm() === "phone";
  const [filter, setFilter] = useState("all");
  const term = debounced.trim();
  // the Android apps this person may open (Korie as the TV's launcher), found by name here
  const me = useData<{ person: { apps?: "all" | string[]; music?: boolean } }>("/api/me").data;
  const apps = androidApps().filter((a) => me && (me.person.apps === "all" || !me.person.apps || me.person.apps.includes(a.pkg)));
  const found: Group[] = term ? [...(data?.groups ?? [])] : [];
  const appHits = term ? apps.filter((a) => a.label.toLowerCase().includes(term.toLowerCase())) : [];
  if (appHits.length) {
    const at = found.filter((g) => ["film", "series", "album"].includes(g.id)).length;
    found.splice(at, 0, { id: "apps", title: "Apps", items: appHits.map((a) => ({ id: a.pkg, kind: "app", title: a.label, subtitle: "Android app", year: "", poster: a.icon ?? "", thumb: a.icon ?? "", backdrop: "", progress: 0, watched: false, source: "" })) });
  }
  const kindOf = (g: Group) => (["film", "series", "album", "apps"].includes(g.id) ? g.id : "addons");
  const chips = [["all", "Everything"], ["film", "Films"], ["series", "Series"], ["album", "Music"], ["addons", "Add-ons"], ...(apps.length ? [["apps", "Apps"]] : [])]
    .filter(([id]) => id !== "album" || (me && me.person.music !== false));
  const shown = found.filter((g) => filter === "all" || kindOf(g) === filter);
  const openIt = (c: Card) => (c.kind === "app" ? window.KorieAndroid?.launch(c.id) : open(c));
  return (
    <div className="page search">
      <div className="top">
        <div className={"field sfield" + (q ? " typed" : "")}>
          <SearchI />
          <span>{q || <span style={{ color: "var(--dim)" }}>Films, series, music, add-ons</span>}</span>
          <i className="caret" />
        </div>
        <Clock />
      </div>
      <G fk="search-chips" className="pills">
        {chips.map(([id, label]) => {
          const none = id !== "all" && term && !found.some((g) => kindOf(g) === id && g.items.length);
          return <F key={id} fk={`sc-${id}`} className={"pill" + (id === filter ? " on" : "") + (none ? " none" : "")} onEnter={() => setFilter(id)}>{label}</F>;
        })}
      </G>
      <div className="sbody" style={{ flexDirection: phone ? "column" : "row" }}>
        <div className="skeys">
          <G fk="search-keys" className="keys">
            {KEYS.map((k) => <F key={k} fk={`sk-${k}`} className="key" onEnter={() => setQ((x) => x + k)}>{k}</F>)}
            <F fk="sk-space" className="key wide" onEnter={() => setQ((x) => x + " ")}>Space</F>
            <F fk="sk-del" className="key wide" onEnter={() => setQ((x) => x.slice(0, -1))}>Delete</F>
            <F fk="sk-clear" className="key wide" onEnter={() => setQ("")}>Clear</F>
          </G>
          <p className="note">For the remote. Typing on a keyboard works anywhere in Korie.</p>
        </div>
        <G fk="search-results" className="sresults">
          {shown.map((g, gi) => (
            g.loading ? <p key={g.id} className="shead">Still searching {g.title}…</p> : g.items.length ? (
              <div key={g.id}>
                <p className="shead">{kindOf(g) === "addons" ? `From ${g.title}` : g.title} · {g.items.length}</p>
                <G fk={`sr-${gi}`} className="sgrid">
                  {g.items.map((c, i) => (
                    <F key={c.id} fk={`sr-${gi}-${i}`} className={"result" + (g.id === "album" || c.kind === "app" ? " square" : "")} onEnter={() => openIt(c)} onLong={() => c.kind !== "app" && menu(c)}>
                      <span className="rpic">{(c.poster || c.thumb) ? <img src={pic(c.poster || c.thumb, rem(4))} alt="" loading="lazy" /> : null}</span>
                      <span className="rtext">
                        <b><Mark text={c.title} q={term} /></b>
                        <small>{[c.year, c.subtitle && c.subtitle !== c.year ? c.subtitle.replace(new RegExp(`^${c.year} · `), "") : ""].filter(Boolean).join(" · ")}</small>
                      </span>
                    </F>
                  ))}
                </G>
              </div>
            ) : null
          ))}
          {!q.trim() && <Status text="Type to search your films, series and music, and the add-ons that can search (DRTV, Stremio, RomM)." />}
          {term && data && !shown.length && <Status text={`Nothing found for "${term}".`} />}
        </G>
      </div>
    </div>
  );
}

interface Group { id: string; title: string; items: Card[]; loading?: boolean }

/** The part of a title you typed, in the accent colour. */
function Mark({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<em className="hit">{text.slice(i, i + q.length)}</em>{text.slice(i + q.length)}</>;
}
