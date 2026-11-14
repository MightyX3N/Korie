// Search: your library and every add-on that can search. A keyboard for the
// remote on the left; typing on a real keyboard works too.
import { useEffect, useRef, useState } from "react";
import { Delete, Search as SearchI } from "lucide-react";
import type { Card } from "../api.ts";
import { F, G } from "../focus.tsx";
import { RowView } from "../cards.tsx";
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
  const groups = debounced.trim() ? data?.groups ?? [] : [];
  return (
    <div className="page">
      <div className="top">
        <div className="field" style={{ flex: 1, maxWidth: "40rem", fontSize: "1.3rem", boxShadow: "inset 0 0 0 0.12rem var(--line)" }}>
          <SearchI style={{ width: "1.3rem", height: "1.3rem", marginRight: "0.7rem", color: "var(--soft)" }} />
          <span>{q || <span style={{ color: "var(--dim)" }}>Films, series, music, channels…</span>}</span>
          <i className="caret" />
        </div>
        <span className="fill" />
        <Clock />
      </div>
      <div style={{ display: "flex", gap: "2.4rem", alignItems: "flex-start", flexDirection: phone ? "column" : "row" }}>
        <G fk="search-keys" className="keys" style={{ gridTemplateColumns: "repeat(6, 2.8rem)", flex: "none", position: phone ? "static" : "sticky", top: 0 }}>
          {KEYS.map((k) => <F key={k} fk={`sk-${k}`} className="key" onEnter={() => setQ((x) => x + k)}>{k}</F>)}
          <F fk="sk-space" className="key wide" onEnter={() => setQ((x) => x + " ")}>Space</F>
          <F fk="sk-del" className="key wide" onEnter={() => setQ((x) => x.slice(0, -1))}><Delete style={{ width: "1.1rem", height: "1.1rem", verticalAlign: "-0.2rem" }} /></F>
          <F fk="sk-clear" className="key wide" onEnter={() => setQ("")}>Clear</F>
        </G>
        <G fk="search-results" style={{ flex: 1, minWidth: 0 }}>
          {groups.map((g, i) => (
            g.loading ? <p key={g.id} className="status">{g.title}: searching…</p> :
              <RowView key={g.id} row={{ id: g.id, title: `${g.title} · ${g.items.length}`, kind: g.items.some((c) => c.kind === "live" || c.kind === "episode") ? "wide" : g.id === "album" ? "square" : "poster", items: g.items }} fk={`sr-${i}`} onOpen={open} onMenu={menu} />
          ))}
          {!q.trim() && <Status text="Type to search your films, series and music, and the add-ons that can search (DRTV, Stremio, RomM)." />}
          {debounced.trim() && data && !groups.length && <Status text={`Nothing found for "${debounced.trim()}".`} />}
        </G>
      </div>
    </div>
  );
}
