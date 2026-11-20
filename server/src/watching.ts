// Who is watching what right now, for the admin's Overview ("Watching now"). Every app reports
// how far it is (Korie's own apps through /api/progress, Jellyfin's through /Sessions/Playing);
// a report that stops coming means the playing stopped.
import * as lib from "./library.ts";
import * as browse from "./addons/browse.ts";
import type { Person } from "./people.ts";

export interface Now {
  person: string; name: string; color: string; device: string; id: string; title: string; subtitle: string;
  live: boolean; position: number; duration: number; paused: boolean; at: number;
}

const playing = new Map<string, Now>();

function about(id: string): { title: string; subtitle: string; live: boolean } {
  const r = lib.getRow(id);
  if (r) {
    if (r.kind === "episode") {
      const s = lib.getRow(r.parent ?? "");
      const d = lib.data(r);
      return { title: s?.title ?? r.title, subtitle: `S${d.season}E${d.episode} · ${r.title}`, live: false };
    }
    return { title: r.title, subtitle: r.kind === "track" ? "Music" : "Your library", live: false };
  }
  const a = browse.get(id);
  if (a) {
    const where = browse.aidOf(a.source).split(".").pop() ?? a.source;
    return { title: a.title, subtitle: a.kind === "live" ? `Live · ${where.toUpperCase()}` : a.subtitle || where, live: a.kind === "live" };
  }
  return { title: id, subtitle: "", live: false };
}

/** A device says how far it is; stopped: it closed the player. */
export function note(key: string, p: Person, device: string, id: string, position: number, duration: number, paused: boolean, stopped: boolean): void {
  if (!key || !id) return;
  if (stopped) {
    playing.delete(key);
    return;
  }
  const a = about(id);
  playing.set(key, { person: p.id, name: p.name, color: p.color, device: device || "a device", id, ...a, position, duration, paused, at: Date.now() });
}

export function stop(key: string): void {
  playing.delete(key);
}

/** What's playing now: reports from the last minute and a half (paused ones a while longer). */
export function list(): Now[] {
  const t = Date.now();
  for (const [k, n] of playing) if (t - n.at > (n.paused ? 15 * 60_000 : 90_000)) playing.delete(k);
  return [...playing.values()].sort((a, b) => b.at - a.at);
}
