// Pieces most screens share: the title bar with the clock, opening a card,
// and its options menu (hold OK, right-click or long-press).
import { useEffect, useState, type ReactNode } from "react";
import { Play, RotateCcw, Eye, EyeOff, Heart, Wand2, Baby, Plus, Pencil, Trash2, ListPlus, ListMinus } from "lucide-react";
import { api, type Card, type Person } from "../api.ts";
import * as music from "../music.ts";
import { useNav } from "../nav.tsx";
import { useUI } from "../ui.tsx";

export function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return <span className="clock">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span>;
}

export function Top({ title, count, children, date }: { title: string; count?: string; children?: ReactNode; date?: boolean }) {
  return (
    <div className="top">
      <h1>{title}</h1>
      {count && <span className="count">{count}</span>}
      <span className="fill" />
      {children}
      {date && <span className="date">{new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</span>}
      <Clock />
    </div>
  );
}

export function Status({ text }: { text?: string }) {
  return text ? <p className="status">{text}</p> : null;
}

/** What pressing OK on a card does. */
/** Puts a song, or all of an album's songs, on a playlist (a new one, or one you have). */
export async function addToPlaylist(id: string, ui: ReturnType<typeof useUI>): Promise<void> {
  const r = await api<{ playlists: { id: string; name: string; count: number }[] }>("/api/playlists").catch((e) => { ui.toast(e.message); return null; });
  if (!r) return;
  const v = await ui.menu("Add to playlist", [...r.playlists.map((p) => ({ label: `${p.name} · ${p.count} songs`, value: p.id })), { label: "New playlist", value: "@new", icon: <Plus /> }]);
  if (!v) return;
  if (v === "@new") {
    const name = await ui.text("Name of the playlist");
    if (name?.trim()) await api("/api/playlists", { name: name.trim(), item: id }).then(() => ui.toast(`${name.trim()} made.`)).catch((e) => ui.toast(e.message));
    return;
  }
  const pl = r.playlists.find((p) => p.id === v)!;
  const a = await api<{ added: number }>(`/api/playlists/${v}`, { add: id }).catch((e) => { ui.toast(e.message); return null; });
  if (a) ui.toast(a.added ? `Added to ${pl.name}.` : `It's on ${pl.name} already.`);
}

/** onChange: what to do after the menu changed something (a playlist) on the screen it's on. */
export function useOpener(onChange?: () => void) {
  const nav = useNav();
  const ui = useUI();
  const open = (c: Card) => {
    switch (c.kind) {
      case "film": case "series": case "album": case "game":
        nav.push("item", { id: c.id });
        return;
      case "page":
        nav.push("page", { id: c.id, title: c.title });
        return;
      case "track": {
        const album = (c as Card & { album?: string }).album;
        if (album) void music.playList(album, c.id).then(() => nav.push("nowplaying"));
        else nav.push("player", { id: c.id, mode: "start" });
        return;
      }
      case "episode": case "live":
        nav.push("player", { id: c.id, mode: c.kind === "live" ? "start" : "resume" });
        return;
    }
    nav.push("item", { id: c.id });
  };
  const menu = async (c: Card, playlist?: string) => {
    if (c.kind === "playlist") {
      const v = await ui.menu(c.title, [{ label: "Rename", value: "name", icon: <Pencil /> }, { label: `Delete ${c.title}…`, value: "delete", danger: true, icon: <Trash2 /> }]);
      const pid = c.id.slice(9);
      if (v === "name") {
        const t = await ui.text("Name of the playlist", c.title);
        if (t?.trim()) await api(`/api/playlists/${pid}`, { name: t.trim() }).catch((e) => ui.toast(e.message));
      } else if (v === "delete") {
        const ok = await ui.ask(`Delete ${c.title}?`, "The songs stay in your music.", [{ label: "Delete", value: "yes", danger: true }, { label: "Keep", value: "no", primary: true }]);
        if (ok === "yes") await api(`/api/playlists/${pid}`, undefined, "DELETE").catch((e) => ui.toast(e.message));
      }
      onChange?.();
      return;
    }
    const choices = [];
    if (["film", "episode", "game"].includes(c.kind)) {
      choices.push({ label: c.progress > 0 ? "Resume" : "Play", value: "play", icon: <Play /> });
      if (c.progress > 0) choices.push({ label: "Play from the start", value: "start", icon: <RotateCcw /> });
    }
    if (["film", "episode", "series"].includes(c.kind)) choices.push(c.watched ? { label: "Mark as not watched", value: "unwatched", icon: <EyeOff /> } : { label: "Mark as watched", value: "watched", icon: <Eye /> });
    if (c.kind === "track") choices.push({ label: "Play", value: "song", icon: <Play /> });
    if (c.kind === "track" || c.kind === "album") choices.push({ label: "Add to playlist", value: "playlist", icon: <ListPlus /> });
    if (c.kind === "track" && playlist) choices.push({ label: "Remove from this playlist", value: "take", icon: <ListMinus /> });
    if (c.kind !== "live" && c.kind !== "page") choices.push({ label: "Favourite (add or remove)", value: "fav", icon: <Heart /> });
    if (!c.source && (c.kind === "film" || c.kind === "series")) {
      // fixing what a film is changes the library: only for those who may change settings
      const me = await api<{ person: Person }>("/api/me").catch(() => null);
      if (me?.person.canSettings) choices.push({ label: c.kind === "film" ? "Fix details (wrong film?)" : "Fix details (wrong series?)", value: "fix", icon: <Wand2 /> });
      if (me?.person.admin) choices.push({ label: `Age rating: ${(c as Card & { cert?: string }).cert || "none"}`, value: "age", icon: <Baby /> });
    }
    if (!choices.length) return;
    const v = await ui.menu(c.title, choices);
    if (v === "play") nav.push("player", { id: c.id, mode: "resume" });
    if (v === "start") nav.push("player", { id: c.id, mode: "start" });
    if (v === "watched" || v === "unwatched") await api("/api/watched", { id: c.id, watched: v === "watched" }).catch((e) => ui.toast(e.message));
    if (v === "fav") {
      const r = await api<{ favourite: boolean }>("/api/favourite", { id: c.id }).catch(() => null);
      if (r) ui.toast(r.favourite ? "Added to Favourites" : "Removed from Favourites");
    }
    if (v === "fix") await fixMatch(c.id, c.title, ui);
    if (v === "song") open(c);
    if (v === "playlist") await addToPlaylist(c.id, ui);
    if (v === "take" && playlist) {
      await api(`/api/playlists/${playlist}`, { take: c.id }).catch((e) => ui.toast(e.message));
      onChange?.();
    }
    if (v === "age") {
      const ages: [string, string][] = [["15", "Age 15"], ["11", "Age 11"], ["7", "Age 7"], ["0", "For everyone"], ["none", "No age rating (hidden from people with an age limit)"]];
      const a = await ui.menu(`Age rating for ${c.title}`, ages.map(([value, label]) => ({ label, value })));
      if (a) await api("/api/age", { id: c.id, age: a === "none" ? null : Number(a) }).then(() => ui.toast("Age rating changed")).catch((e) => ui.toast(e.message));
    }
  };
  return { open, menu };
}

export async function fixMatch(id: string, title: string, ui: ReturnType<typeof useUI>): Promise<void> {
  const q = await ui.text("Which is it? Type the name", title);
  if (!q) return;
  const r = await api<{ results: { id: number; title: string; year: string; original: string }[] }>(`/api/match?id=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}`).catch((e) => {
    ui.toast(e.message);
    return null;
  });
  if (!r) return;
  if (!r.results.length) {
    await ui.message("Nothing found", `TMDb has nothing called "${q}". Try a shorter or the original name.`);
    return;
  }
  const v = await ui.menu("Pick the right one", r.results.slice(0, 8).map((x) => ({ label: `${x.title}${x.year ? ` (${x.year})` : ""}${x.original && x.original !== x.title ? ` · ${x.original}` : ""}`, value: String(x.id) })));
  if (!v) return;
  await api("/api/match", { id, tmdb: Number(v) }).then(() => ui.toast("Details changed")).catch((e) => ui.toast(e.message));
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function fmtRuntime(min: number): string {
  if (!min) return "";
  const m = Math.round(min);
  return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}
