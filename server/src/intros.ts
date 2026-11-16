// Finding the intros of series episodes, so they can be skipped. The episodes of a season share
// their intro: the start of each episode's sound is fingerprinted with Chromaprint (as Jellyfin's
// intro skipper does; through FFmpeg's chromaprint muxer, or Chromaprint's own fpcalc), and the
// longest stretch two neighbouring episodes have in common is the intro. Runs in the background
// after a look through the folders; every episode is checked once.
import { execFile } from "node:child_process";
import { FFMPEG, log } from "./config.ts";
import { db, json } from "./db.ts";
import { emit } from "./events.ts";

/** One fingerprint value per this many seconds (Chromaprint's default settings). */
const STEP = 0.1238;
/** How much of the start of an episode is looked at, and what counts as an intro. */
const LOOK = 600;
const SHORTEST = 15;
const LONGEST = 150;
/** Fingerprint values this close (differing bits) are the same sound; gaps this short are bridged. */
const SAME_BITS = 6;
const GAP = Math.round(3.5 / STEP);

export interface Intro { start: number; end: number }

function run(cmd: string, args: string[]): Promise<string> {
  return bytes(cmd, args).then((b) => b.toString("utf8"));
}

function bytes(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 180000, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

let how: "ffmpeg" | "fpcalc" | "none" | null = null;

async function tool(): Promise<"ffmpeg" | "fpcalc" | "none"> {
  if (how) return how;
  try {
    if (/\bchromaprint\b/.test(await run(FFMPEG, ["-hide_banner", "-muxers"]))) return (how = "ffmpeg");
  } catch {
    /* no ffmpeg here */
  }
  try {
    await run("fpcalc", ["-version"]);
    return (how = "fpcalc");
  } catch {
    log("intros", "no Chromaprint (FFmpeg without it, and no fpcalc): intros aren't found");
    return (how = "none");
  }
}

/** The raw fingerprint of the first seconds of a file's sound. */
export async function fingerprint(file: string, seconds = LOOK): Promise<Uint32Array | null> {
  const t = await tool();
  if (t === "ffmpeg") {
    const buf = await bytes(FFMPEG, ["-hide_banner", "-loglevel", "error", "-t", String(seconds), "-i", file, "-map", "0:a:0", "-ac", "1",
      "-f", "chromaprint", "-fp_format", "raw", "-"]).catch(() => Buffer.alloc(0));
    // the raw values, as little-endian 32-bit numbers
    const n = Math.floor(buf.length / 4);
    if (!n) return null;
    const out = new Uint32Array(n);
    for (let i = 0; i < n; i++) out[i] = buf.readUInt32LE(i * 4);
    return out;
  }
  if (t === "fpcalc") {
    const text = await run("fpcalc", ["-raw", "-length", String(seconds), file]).catch(() => "");
    const m = text.match(/FINGERPRINT=([\d,]+)/);
    return m ? Uint32Array.from(m[1].split(",").map(Number)) : null;
  }
  return null;
}

function bits(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** The longest stretch of sound two fingerprints share: where it is in each (seconds), or null. */
export function shared(a: Uint32Array, b: Uint32Array): { a: Intro; b: Intro } | null {
  let best: { len: number; ai: number; bi: number } | null = null;
  // every way the two can line up: b shifted against a
  for (let shift = -(b.length - 1); shift < a.length; shift++) {
    let run = 0;
    let start = -1;
    let gap = 0;
    const from = Math.max(0, shift);
    const to = Math.min(a.length, b.length + shift);
    if (to - from < SHORTEST / STEP) continue;
    for (let i = from; i < to; i++) {
      if (bits((a[i] ^ b[i - shift]) >>> 0) <= SAME_BITS) {
        if (start < 0) start = i;
        run = i - start + 1;
        gap = 0;
      } else if (start >= 0 && ++gap > GAP) {
        if (!best || run > best.len) best = { len: run, ai: start, bi: start - shift };
        start = -1;
        run = 0;
        gap = 0;
      }
    }
    if (start >= 0 && (!best || run > best.len)) best = { len: run, ai: start, bi: start - shift };
  }
  if (!best) return null;
  const secs = best.len * STEP;
  if (secs < SHORTEST || secs > LONGEST) return null;
  // nearly all of both the same: the same file twice (or two copies), not an intro
  if (best.len > 0.8 * Math.min(a.length, b.length)) return null;
  const at = (i: number) => Math.round(i * STEP * 10) / 10;
  return { a: { start: at(best.ai), end: at(best.ai + best.len) }, b: { start: at(best.bi), end: at(best.bi + best.len) } };
}

interface Ep { id: string; file: string; season: number; episode: number; data: Record<string, any> }

const patch = db.prepare("UPDATE items SET data = json_patch(data, ?) WHERE id = ?");
let busy = false;

/** Looks for the intros of the episodes not checked yet (a season at a time). */
export async function findAll(): Promise<void> {
  if (busy || (await tool()) === "none") return;
  busy = true;
  try {
    const rows = db.prepare(`SELECT id, file, parent, data FROM items WHERE kind = 'episode' AND file IS NOT NULL`).all() as { id: string; file: string; parent: string; data: string }[];
    const seasons = new Map<string, Ep[]>();
    for (const r of rows) {
      const d = json<Record<string, any>>(r.data, {});
      const key = `${r.parent}|${d.season}`;
      seasons.set(key, [...(seasons.get(key) ?? []), { id: r.id, file: r.file, season: d.season, episode: d.episode, data: d }]);
    }
    for (const eps of seasons.values()) {
      if (!eps.some((e) => e.data.introChecked === undefined) || eps.length < 2) continue;
      eps.sort((x, y) => x.episode - y.episode);
      const prints: (Uint32Array | null)[] = [];
      for (const e of eps) prints.push(e.data.disc ? null : await fingerprint(e.file));
      const found = new Map<string, Intro>();
      for (let i = 0; i + 1 < eps.length; i++) {
        const a = prints[i];
        const b = prints[i + 1];
        if (!a || !b) continue;
        const s = shared(a, b);
        if (!s) continue;
        // an episode keeps the longer of the two it shares with its neighbours
        const keep = (id: string, v: Intro) => {
          const old = found.get(id);
          if (!old || v.end - v.start > old.end - old.start) found.set(id, v);
        };
        keep(eps[i].id, s.a);
        keep(eps[i + 1].id, s.b);
      }
      for (const e of eps) patch.run(JSON.stringify({ introChecked: true, intro: found.get(e.id) ?? null }), e.id);
      log("intros", `${eps.length} episodes looked at, ${found.size} intros found`);
    }
  } catch (e) {
    log("intros", e instanceof Error ? e.message : String(e));
  } finally {
    busy = false;
    emit("library");
  }
}
