// Search your library and every add-on at once; results come in as each answers.
import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { api, onChange } from "../api";
import { go, type Route } from "../router";
import type { Card } from "../types";
import { Loading, RowView } from "./Cards";

interface Group { id: string; title: string; items: Card[]; loading?: boolean }

export function Search({ route }: { route: Route }) {
  const q = route.query.get("q") ?? "";
  const [text, setText] = useState(q);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [n, setN] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  // what's typed goes into the address (so Back works), a moment after typing stops
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (text.trim() !== q) go(text.trim() ? `/search?q=${encodeURIComponent(text.trim())}` : "/search", true);
    }, 350);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    if (!q) {
      setGroups(null);
      return;
    }
    let live = true;
    api<{ groups: Group[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => live && setGroups(r.groups), () => live && setGroups([]));
    return () => {
      live = false;
    };
  }, [q, n]);
  // add-ons answer later: ask again when one has
  useEffect(() => onChange((w) => { if (w.includes("search")) setN((x) => x + 1); }), []);

  const found = groups?.filter((g) => g.items.length) ?? [];
  const waiting = groups?.filter((g) => g.loading) ?? [];
  return (
    <div className="page">
      <header className="page-head"><h1>Search</h1></header>
      <label className="searchbox">
        <SearchIcon size={22} />
        <input ref={input} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Films, series, music, channels…" aria-label="Search" />
      </label>
      {q && !groups && <Loading />}
      {groups && !found.length && !waiting.length && <p className="status">Nothing found for "{q}".</p>}
      {found.map((g) => <RowView key={g.id} row={{ id: g.id, title: g.title, kind: g.id === "album" ? "square" : "poster", items: g.items }} />)}
      {waiting.length > 0 && <p className="status soft">Still asking {waiting.map((g) => g.title).join(", ")}…</p>}
    </div>
  );
}
