// The options menu of a film, series, episode, album, song or playlist.
import { api } from "../api";
import { go, itemPath } from "../router";
import { ui, type MenuItem } from "../ui";
import type { Card, Me } from "../types";
import { music } from "./music";

let me: Me | null = null;
export function setMe(m: Me | null): void {
  me = m;
}
export function currentMe(): Me | null {
  return me;
}

const AGES: [number | null, string][] = [[null, "No rating (as the file says)"], [0, "For everyone"], [7, "From 7"], [11, "From 11"], [15, "From 15"], [18, "Adults only (18)"]];

export async function addToPlaylist(id: string): Promise<void> {
  const r = await ui.attempt("Couldn't get your playlists", () => api<{ playlists: { id: string; name: string; count: number }[] }>("/api/playlists"));
  if (!r) return;
  const items: MenuItem[] = r.playlists.map((pl) => ({
    label: pl.name, hint: `${pl.count} songs`,
    run: async () => {
      const a = await ui.attempt("Couldn't add it", () => api<{ added: number }>(`/api/playlists/${pl.id}`, { add: id }));
      if (a) await ui.message(`Added to ${pl.name}`, a.added === 1 ? "1 song added." : `${a.added} songs added.`);
    },
  }));
  items.push({
    label: "New playlist…",
    run: async () => {
      const name = await ui.prompt("New playlist", "Name");
      if (!name?.trim()) return;
      await ui.attempt("Couldn't make the playlist", () => api("/api/playlists", { name: name.trim(), item: id }));
    },
  });
  await ui.menu("Add to a playlist", items);
}

/** Pick the right film or series on TMDb for something Korie guessed wrong. */
export async function fixMatch(id: string, title: string): Promise<void> {
  let q = title;
  for (;;) {
    const r = await ui.attempt("Couldn't search TMDb", () => api<{ query: string; results: { id: number; title: string; original: string; year: string; poster: string }[] }>(`/api/match?id=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}`));
    if (!r) return;
    const i = await ui.pick(r.results.length ? `Which one is "${title}"?` : `TMDb found nothing for "${q}"`,
      r.results.map((f) => ({ label: `${f.title}${f.year ? ` (${f.year})` : ""}`, hint: f.original !== f.title ? f.original : "", image: f.poster })),
      "Search for something else…");
    if (i === null) return;
    if (i >= 0) {
      await ui.attempt("Couldn't change it", () => api("/api/match", { id, tmdb: r.results[i].id }));
      return;
    }
    const n = await ui.prompt("Search TMDb", "Title", q);
    if (!n?.trim()) return;
    q = n.trim();
  }
}

async function choosePoster(id: string): Promise<void> {
  const r = await ui.attempt("Couldn't get posters", () => api<{ posters: { url: string; lang: string; picture: string }[] }>(`/api/posters?id=${encodeURIComponent(id)}`));
  if (!r) return;
  if (!r.posters.length) return ui.message("No other posters", "TMDb has no other posters for this.");
  const i = await ui.pick("Pick a poster", r.posters.slice(0, 30).map((p, n) => ({ label: p.lang ? p.lang.toUpperCase() : `Poster ${n + 1}`, image: p.picture })));
  if (i === null || i < 0) return;
  await ui.attempt("Couldn't change the poster", () => api("/api/poster", { id, url: r.posters[i].url }));
}

export async function cardMenu(c: Card, changed?: () => void): Promise<void> {
  const p = me?.person;
  const items: MenuItem[] = [];
  const playable = ["film", "episode", "live", "game"].includes(c.kind);
  if (playable) items.push({ label: c.progress > 0 && !c.watched ? "Resume" : "Play", run: () => go(`/play/${encodeURIComponent(c.id)}`) });
  if (c.kind === "album" || c.kind === "playlist") {
    items.push({ label: "Play", run: () => music.playItem(c.id, false) });
    items.push({ label: "Shuffle", run: () => music.playItem(c.id, true) });
  }
  if (c.kind === "track") items.push({ label: "Play", run: () => music.playTracks([{ id: c.id, n: c.n ?? 0, title: c.title, artist: c.subtitle, duration: c.length ?? 0, poster: c.poster }], 0) });
  if (c.kind !== "live" && c.kind !== "game") items.push({ label: "Open", run: () => go(itemPath(c.id)) });
  if (["film", "series", "episode"].includes(c.kind)) {
    items.push({
      label: c.watched ? "Mark as not watched" : "Mark as watched",
      run: async () => {
        await ui.attempt("Couldn't change it", () => api("/api/watched", { id: c.id, watched: !c.watched }));
        changed?.();
      },
    });
  }
  if (["film", "series", "album", "live"].includes(c.kind)) {
    items.push({
      label: c.favourite ? "Remove from favourites" : "Add to favourites",
      run: async () => {
        await ui.attempt("Couldn't change it", () => api("/api/favourite", { id: c.id }));
        changed?.();
      },
    });
  }
  if ((c.kind === "album" || c.kind === "track") && p?.music) items.push({ label: "Add to a playlist…", run: () => addToPlaylist(c.id) });
  if (c.kind === "track" && c.playlist) {
    items.push({
      label: "Take off this playlist",
      run: async () => {
        await ui.attempt("Couldn't change the playlist", () => api(`/api/playlists/${c.playlist}`, { take: c.id }));
        changed?.();
      },
    });
  }
  if (c.local && (c.kind === "film" || c.kind === "series") && p?.canSettings) {
    items.push({ label: "Fix details…", hint: "The wrong film or series was found", run: () => fixMatch(c.id, c.title) });
    items.push({ label: "Pick a poster…", run: () => choosePoster(c.id) });
  }
  if (c.local && (c.kind === "film" || c.kind === "series") && p?.admin) {
    items.push({
      label: "Age rating…",
      run: () => ui.menu(`Age rating of ${c.title}`, AGES.map(([age, label]) => ({
        label,
        run: async () => {
          await ui.attempt("Couldn't change it", () => api("/api/age", { id: c.id, age }));
          changed?.();
        },
      }))),
    });
  }
  if (c.local && ["film", "series", "album"].includes(c.kind) && p?.canDelete) {
    items.push({
      label: "Remove from the library…", danger: true,
      run: async () => {
        if (!(await ui.confirm(`Remove ${c.title}?`, "It's taken out of Korie. The files stay where they are, and an admin can bring it back (Admin → Libraries).", "Remove", true))) return;
        await ui.attempt("Couldn't remove it", () => api("/api/remove", { id: c.id }));
        changed?.();
      },
    });
  }
  await ui.menu(c.title, items);
}
