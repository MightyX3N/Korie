// Music keeps playing while you look around: one <audio> for the whole page, a queue, shuffle
// and repeat. The bar at the bottom and Now playing show it.
import { useEffect, useState } from "react";
import { api, caps } from "../api";
import { ui } from "../ui";
import type { Card, Item, Plan, Track } from "../types";

export interface MusicState {
  queue: Track[]; index: number; playing: boolean; time: number; duration: number; shuffle: boolean; repeat: "off" | "all" | "one"; loading: boolean;
}

const audio = new Audio();
audio.preload = "auto";
let state: MusicState = { queue: [], index: -1, playing: false, time: 0, duration: 0, shuffle: false, repeat: "off", loading: false };
let order: number[] = [];
const subs = new Set<() => void>();
let lastReport = 0;

function set(change: Partial<MusicState>): void {
  state = { ...state, ...change };
  subs.forEach((s) => s());
}

function report(stopped = false): void {
  const t = state.queue[state.index];
  // (a radio station has no place to come back to)
  if (!t || t.live) return;
  lastReport = Date.now();
  void api("/api/progress", { id: t.id, position: audio.currentTime || 0, duration: audio.duration || t.duration || 0, paused: audio.paused, stopped }).catch(() => {});
}

audio.addEventListener("timeupdate", () => {
  // a converted song grows as it comes: its real length is what the library says
  const known = state.queue[state.index]?.duration ?? 0;
  set({ time: audio.currentTime, duration: known || (Number.isFinite(audio.duration) ? audio.duration : 0) });
  if (Date.now() - lastReport > 15000) report();
});
audio.addEventListener("play", () => { set({ playing: true }); report(); });
audio.addEventListener("pause", () => { set({ playing: false }); report(); });
audio.addEventListener("ended", () => {
  if (state.repeat === "one") {
    audio.currentTime = 0;
    void audio.play();
  } else void music.next(true);
});
audio.addEventListener("error", () => {
  const t = state.queue[state.index];
  set({ loading: false, playing: false });
  if (t?.live) void ui.message("Couldn't play this station", `"${t.title}" didn't play: it may be off the air right now.`).then(() => music.stop());
  else if (t) void ui.message("Couldn't play this song", `"${t.title}" didn't play. The next one starts.`).then(() => music.next(true));
});

function shuffled(n: number, first: number): number[] {
  const rest = [...Array(n).keys()].filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 ? [first, ...rest] : rest;
}

async function start(index: number): Promise<void> {
  const t = state.queue[index];
  if (!t) return;
  set({ index, loading: true, time: 0, duration: t.duration });
  try {
    const p = await api<Plan>("/api/play", { id: t.id, caps: caps() });
    audio.src = p.url;
    await audio.play().catch(() => {});
    set({ loading: false });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.albumTitle ?? "", artwork: t.poster ? [{ src: t.poster }] : [] });
    }
  } catch (e) {
    set({ loading: false, playing: false });
    await ui.message(t.live ? "Couldn't play this station" : "Couldn't play this song", e instanceof Error ? e.message : String(e));
    if (t.live) music.stop();
  }
}

export const music = {
  get state() {
    return state;
  },
  /** Plays these songs, from the one at index. */
  playTracks(tracks: Track[], index: number, shuffle = state.shuffle): void {
    set({ queue: tracks, shuffle });
    order = shuffle ? shuffled(tracks.length, index) : [...tracks.keys()];
    void start(shuffle ? order[0] : index);
  },
  /** A radio station: plays in the background, on its own. */
  playStation(c: Card): void {
    music.playTracks([{ id: c.id, n: 0, title: c.title, artist: c.subtitle, duration: 0, poster: c.poster || c.thumb, albumTitle: c.source, live: true }], 0, false);
  },
  /** An album or playlist: all its songs. */
  async playItem(id: string, shuffle: boolean): Promise<void> {
    const it = await ui.attempt("Couldn't open it", () => api<Item>(`/api/item?id=${encodeURIComponent(id)}`));
    if (!it?.tracks?.length) return;
    const tracks = it.tracks.map((t) => ({ ...t, albumTitle: t.albumTitle || it.title, poster: t.poster || it.poster }));
    music.playTracks(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0, shuffle);
  },
  toggle(): void {
    if (audio.paused) void audio.play();
    else audio.pause();
  },
  async next(auto = false): Promise<void> {
    const at = order.indexOf(state.index);
    let n = at + 1;
    if (n >= order.length) {
      if (state.repeat === "all" || !auto) n = 0;
      else {
        audio.pause();
        return;
      }
    }
    await start(order[n]);
  },
  async prev(): Promise<void> {
    if (audio.currentTime > 4) {
      audio.currentTime = 0;
      return;
    }
    const at = order.indexOf(state.index);
    await start(order[Math.max(0, at - 1)]);
  },
  seek(t: number): void {
    audio.currentTime = t;
  },
  setShuffle(on: boolean): void {
    order = on ? shuffled(state.queue.length, state.index) : [...state.queue.keys()];
    set({ shuffle: on });
  },
  cycleRepeat(): void {
    set({ repeat: state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off" });
  },
  jump(index: number): void {
    void start(index);
  },
  stop(): void {
    if (state.index < 0) return;
    report(true);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    set({ queue: [], index: -1, playing: false, time: 0, duration: 0 });
  },
};

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => music.toggle());
  navigator.mediaSession.setActionHandler("pause", () => music.toggle());
  navigator.mediaSession.setActionHandler("nexttrack", () => void music.next());
  navigator.mediaSession.setActionHandler("previoustrack", () => void music.prev());
}

export function useMusic(): MusicState {
  const [s, setS] = useState(state);
  useEffect(() => {
    const f = () => setS(state);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return s;
}
