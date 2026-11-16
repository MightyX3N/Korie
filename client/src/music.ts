// Music that keeps playing while you look around Korie: one audio element for the whole app,
// a queue (an album or a playlist, in order or shuffled), and whoever wants to show it
// (Now playing, the bar on Music) listens for changes.
import { useEffect, useState } from "react";
import { api, caps } from "./api.ts";

export interface Song { id: string; title: string; artist: string; album: string; year: string; cover: string; duration: number }

interface State {
  queue: Song[]; pos: number; playing: boolean; time: number; duration: number; shuffle: boolean; repeat: boolean; list: string; error: string;
}

const audio = typeof Audio !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);
let state: State = { queue: [], pos: 0, playing: false, time: 0, duration: 0, shuffle: false, repeat: false, list: "", error: "" };
let order: Song[] = []; // the list as it is (shuffle plays from a mixed copy)
const listeners = new Set<() => void>();
let lastSave = 0;

function set(change: Partial<State>): void {
  state = { ...state, ...change };
  for (const l of listeners) l();
}

export function current(): Song | null {
  return state.queue[state.pos] ?? null;
}

/** The music state, kept up to date in a component. */
export function useMusic(): State {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}

async function start(i: number): Promise<void> {
  const song = state.queue[i];
  if (!song) return;
  set({ pos: i, time: 0, duration: song.duration, error: "" });
  try {
    const p = await api<{ url: string }>("/api/play", { id: song.id, caps: caps() });
    if (current()?.id !== song.id) return; // another song was picked meanwhile
    audio.src = p.url;
    await audio.play();
  } catch (e) {
    set({ playing: false, error: e instanceof Error ? e.message : String(e) });
  }
}

function mixed(songs: Song[], first: string): Song[] {
  const rest = songs.filter((s) => s.id !== first).map((s) => [Math.random(), s] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const f = songs.find((s) => s.id === first);
  return f ? [f, ...rest] : rest;
}

/** Plays an album or a playlist (its id), from one of its songs (or the first); shuffled if asked. */
export async function playList(list: string, from = "", shuffle = false): Promise<void> {
  const d = await api<{ title: string; year: string; artist?: string; poster: string; tracks: { id: string; title: string; artist?: string; duration?: number; albumTitle?: string; poster?: string }[] }>(
    `/api/item?id=${encodeURIComponent(list)}`);
  order = d.tracks.map((t) => ({
    id: t.id, title: t.title, artist: t.artist || d.artist || "", album: t.albumTitle || d.title, year: t.albumTitle ? "" : d.year || "",
    cover: t.poster || d.poster || "", duration: Number(t.duration) || 0,
  }));
  const first = from || (shuffle ? order[Math.floor(Math.random() * order.length)]?.id ?? "" : order[0]?.id ?? "");
  const queue = shuffle ? mixed(order, first) : order;
  set({ queue, shuffle, list });
  await start(Math.max(0, queue.findIndex((s) => s.id === first)));
}

export function toggle(): void {
  if (!audio.src) return;
  if (audio.paused) void audio.play();
  else audio.pause();
}

export function next(): void {
  if (state.pos + 1 < state.queue.length) void start(state.pos + 1);
  else if (state.repeat && state.queue.length) void start(0);
}

export function prev(): void {
  // early in a song: the one before; later: this one from the start
  if (audio.currentTime > 4 || state.pos === 0) audio.currentTime = 0;
  else void start(state.pos - 1);
}

export function jumpTo(i: number): void {
  void start(i);
}

export function seek(seconds: number): void {
  if (isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration - 0.5, audio.currentTime + seconds));
}

export function setShuffle(on: boolean): void {
  const now = current();
  if (!now) return set({ shuffle: on });
  const queue = on ? mixed(order, now.id) : order;
  set({ shuffle: on, queue, pos: queue.findIndex((s) => s.id === now.id) });
}

export function setRepeat(on: boolean): void {
  set({ repeat: on });
}

export function stop(): void {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  set({ queue: [], pos: 0, playing: false, time: 0, list: "" });
}

if (audio) {
  audio.addEventListener("playing", () => set({ playing: true }));
  audio.addEventListener("pause", () => set({ playing: false }));
  audio.addEventListener("durationchange", () => isFinite(audio.duration) && set({ duration: audio.duration }));
  audio.addEventListener("timeupdate", () => {
    set({ time: audio.currentTime });
    const s = current();
    if (s && Date.now() - lastSave > 10000) {
      lastSave = Date.now();
      void api("/api/progress", { id: s.id, position: audio.currentTime, duration: audio.duration || s.duration, ended: false }).catch(() => {});
    }
  });
  audio.addEventListener("ended", () => {
    const s = current();
    if (s) void api("/api/progress", { id: s.id, position: audio.currentTime, duration: audio.currentTime, ended: true }).catch(() => {});
    if (state.pos + 1 < state.queue.length || state.repeat) next();
    else set({ playing: false });
  });
  audio.addEventListener("error", () => set({ playing: false, error: "This song couldn't be played." }));
}
