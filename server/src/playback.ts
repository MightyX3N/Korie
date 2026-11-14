// Playing things. A browser plays common files as they are (MP4/WebM with
// codecs it knows); for everything else the server repackages or converts the
// video with FFmpeg as it plays (fragmented MP4, sent as it's made). Seeking in
// a converted stream asks for a new stream from that point. Subtitles in text
// form are turned into WebVTT; picture subtitles (Blu-ray/DVD) can be burned in.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import type { ServerResponse } from "node:http";
import { DATA, FFMPEG, FFPROBE, SECRET, log } from "./config.ts";
import { fetchText } from "./net.ts";

// --- what a source is ---------------------------------------------------------------------

/** A local file or folder (DVD), or a web address an add-on gave (with headers). */
export interface Source { file?: string; url?: string; headers?: Record<string, string>; disc?: "dvd" | "bluray" | "iso" | null; live?: boolean }

export function token(src: Source): string {
  const body = Buffer.from(JSON.stringify(src)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url").slice(0, 22);
  return body + "." + sig;
}

export function source(tok: string): Source | null {
  const [body, sig] = tok.split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", SECRET).update(body).digest("base64url").slice(0, 22);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Source;
  } catch {
    return null;
  }
}

// --- probing ------------------------------------------------------------------------------

export interface Stream { index: number; type: "video" | "audio" | "subtitle"; codec: string; lang: string; title: string; channels: number; width: number; height: number; isDefault: boolean; forced: boolean }
export interface Probe { container: string; duration: number; streams: Stream[] }

const probes = new Map<string, { at: number; p: Probe }>();
let dvdDemuxer: boolean | null = null;

function run(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export async function hasDvdDemuxer(): Promise<boolean> {
  if (dvdDemuxer === null) {
    try {
      dvdDemuxer = /\bdvdvideo\b/.test(await run(FFMPEG, ["-hide_banner", "-demuxers"], 5000));
    } catch {
      dvdDemuxer = false;
    }
  }
  return dvdDemuxer;
}

/** The input arguments FFmpeg needs for a source. */
async function inputArgs(src: Source): Promise<string[]> {
  if (src.url) {
    const h = Object.entries(src.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join("");
    return [...(h ? ["-headers", h] : []), "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-i", src.url];
  }
  const f = src.file!;
  if (src.disc === "dvd" || src.disc === "iso") {
    if (await hasDvdDemuxer()) return ["-f", "dvdvideo", "-preindex", "0", "-i", src.disc === "dvd" ? path.join(f, "VIDEO_TS") : f];
    if (src.disc === "dvd") {
      // no DVD reader in this FFmpeg: play the biggest title set's VOB files one after another
      const vts = path.join(f, fs.existsSync(path.join(f, "VIDEO_TS")) ? "VIDEO_TS" : "");
      const vobs = fs.readdirSync(vts).filter((n) => /^VTS_\d\d_[1-9]\.VOB$/i.test(n));
      const sets = new Map<string, { size: number; files: string[] }>();
      for (const v of vobs) {
        const k = v.slice(0, 6).toUpperCase();
        const e = sets.get(k) ?? { size: 0, files: [] };
        e.size += fs.statSync(path.join(vts, v)).size;
        e.files.push(path.join(vts, v));
        sets.set(k, e);
      }
      const best = [...sets.values()].sort((a, b) => b.size - a.size)[0];
      if (best) return ["-i", "concat:" + best.files.sort().join("|")];
    }
    throw new Error("This server's FFmpeg can't read disc images. The Korie Docker image has one that can.");
  }
  if (src.disc === "bluray") return ["-i", "bluray:" + f];
  return ["-i", f];
}

export async function probe(src: Source): Promise<Probe> {
  const key = JSON.stringify(src) + (src.file ? ":" + safeMtime(src.file) : "");
  const hit = probes.get(key);
  if (hit && (src.file || Date.now() - hit.at < 10 * 60 * 1000)) return hit.p;
  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", ...(await inputArgs(src)).filter((a) => a !== "-i")];
  const out = await run(FFPROBE, args.slice(0, -1).concat(args[args.length - 1]), src.url ? 20000 : 60000);
  const j = JSON.parse(out);
  const p: Probe = {
    container: String(j.format?.format_name ?? ""),
    duration: Number(j.format?.duration ?? 0) || 0,
    streams: (j.streams ?? []).filter((s: any) => ["video", "audio", "subtitle"].includes(s.codec_type) && s.disposition?.attached_pic !== 1).map((s: any) => ({
      index: s.index, type: s.codec_type, codec: String(s.codec_name ?? ""), lang: String(s.tags?.language ?? ""), title: String(s.tags?.title ?? ""),
      channels: Number(s.channels ?? 0), width: Number(s.width ?? 0), height: Number(s.height ?? 0),
      isDefault: s.disposition?.default === 1, forced: s.disposition?.forced === 1,
    })),
  };
  probes.set(key, { at: Date.now(), p });
  return p;
}

function safeMtime(f: string): number {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
}

// --- deciding how it plays ----------------------------------------------------------------

/** What the client said it can play (from canPlayType). */
export interface Caps { video: string[]; audio: string[]; containers: string[] }

export function parseCaps(q: string | undefined): Caps {
  const c: Caps = { video: ["h264"], audio: ["aac", "mp3"], containers: ["mp4"] };
  if (!q) return c;
  for (const part of q.split(";")) {
    const [k, v] = part.split(":");
    const list = (v ?? "").split(",").filter((x) => /^[a-z0-9]+$/.test(x));
    if (k === "v") c.video = list;
    if (k === "a") c.audio = list;
    if (k === "c") c.containers = list;
  }
  return c;
}

const TEXT_SUBS = new Set(["subrip", "ass", "ssa", "webvtt", "mov_text", "text", "srt"]);
const LANG: Record<string, string> = { dan: "Dansk", da: "Dansk", eng: "English", en: "English", swe: "Svenska", sv: "Svenska", nor: "Norsk", nob: "Norsk", no: "Norsk", ger: "Deutsch", deu: "Deutsch", de: "Deutsch", fre: "Français", fra: "Français", fr: "Français", spa: "Español", es: "Español", ita: "Italiano", it: "Italiano", fin: "Suomi", fi: "Suomi", dut: "Nederlands", nld: "Nederlands", nl: "Nederlands", jpn: "日本語", ja: "日本語", por: "Português", pt: "Português", pol: "Polski", pl: "Polski" };

export function langName(code: string): string {
  return LANG[code.toLowerCase()] ?? (code && code !== "und" ? code : "");
}

function audioLabel(s: Stream): string {
  const ch = s.channels >= 8 ? "7.1" : s.channels >= 6 ? "5.1" : s.channels === 2 ? "Stereo" : s.channels === 1 ? "Mono" : "";
  const lang = langName(s.lang) || "Unknown";
  const title = s.title.replace(new RegExp("^" + lang.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*"), "").replace(/^\((.*)\)$/, "$1").trim();
  return [lang, title && !/^(stereo|surround|mono|5\.1)$/i.test(title) ? title : "", ch, s.codec.toUpperCase()].filter(Boolean).join(" · ");
}

export interface Track { id: string; label: string; lang: string; isDefault: boolean }
export interface Plan {
  mode: "direct" | "stream"; url: string; duration: number; live: boolean; seekable: boolean;
  audio: Track[]; audioIndex: number | null; subs: (Track & { url?: string; burn?: boolean })[]; why: string;
}

const MP4ISH = /(^|,)(mov|mp4|m4a|3gp|3g2|mj2)(,|$)/;
const WEBMISH = /(^|,)(matroska|webm)(,|$)/;

function codecOk(c: string, caps: string[]): boolean {
  const name = c === "hevc" ? "hevc" : c;
  return caps.includes(name);
}

/** How a source plays for these client abilities. audio: chosen audio stream index; burn: picture subtitle index. */
export async function plan(src: Source, caps: Caps, audio: number | null, burn: number | null, subFiles: string[], extraSubs: { url: string; title: string; language: string; default: boolean }[]): Promise<Plan> {
  const tok = token(src);
  let p: Probe;
  try {
    p = await probe(src);
  } catch (e) {
    if (src.url) {
      // can't look inside (some live streams): let FFmpeg try anyway
      p = { container: "", duration: 0, streams: [] };
    } else {
      throw new Error("The file can't be opened: " + (e instanceof Error ? e.message.split("\n")[0] : String(e)));
    }
  }
  const v = p.streams.find((s) => s.type === "video");
  const auds = p.streams.filter((s) => s.type === "audio");
  const chosenAudio = audio !== null ? auds.find((a) => a.index === audio) ?? null : (auds.find((a) => a.isDefault) ?? auds[0] ?? null);
  const subsIn = p.streams.filter((s) => s.type === "subtitle");
  const live = !!src.live || (!!src.url && !p.duration);

  const subs: Plan["subs"] = [];
  for (const s of subsIn) {
    const lang = langName(s.lang) || "Unknown";
    const label = [lang, s.title && s.title !== lang ? s.title : "", s.forced ? "forced" : ""].filter(Boolean).join(" · ");
    if (TEXT_SUBS.has(s.codec)) subs.push({ id: "s" + s.index, label, lang: s.lang, isDefault: s.isDefault || s.forced, url: `/api/subs/${tok}/${s.index}.vtt` });
    else if (["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle"].includes(s.codec)) subs.push({ id: "b" + s.index, label: label + " (burned in)", lang: s.lang, isDefault: false, burn: true });
  }
  for (const f of subFiles) {
    const m = path.basename(f).match(/\.([a-z]{2,3})(?:\.(forced))?\.(srt|vtt|ass|ssa)$/i);
    subs.push({ id: "f" + crypto.createHash("md5").update(f).digest("hex").slice(0, 8), label: [langName(m?.[1] ?? "") || path.basename(f), m?.[2] ? "forced" : ""].filter(Boolean).join(" · "), lang: m?.[1] ?? "", isDefault: !!m?.[2], url: `/api/subs/${token({ file: f })}/file.vtt` });
  }
  for (const x of extraSubs) {
    subs.push({ id: "x" + crypto.createHash("md5").update(x.url).digest("hex").slice(0, 8), label: x.title || langName(x.language) || "Subtitles", lang: x.language, isDefault: x.default, url: `/api/subs/${token({ url: x.url })}/file.vtt` });
  }

  const audioTracks: Track[] = auds.map((a) => ({ id: String(a.index), label: audioLabel(a), lang: a.lang, isDefault: a === chosenAudio }));
  const container = p.container;
  const containerOk = (MP4ISH.test(container) && caps.containers.includes("mp4")) || (container.startsWith("matroska,webm") && caps.containers.includes("webm") && (!v || ["vp8", "vp9", "av1"].includes(v.codec)));
  const videoOk = !v || codecOk(v.codec, caps.video);
  const audioOk = !chosenAudio || codecOk(chosenAudio.codec, caps.audio);
  const firstAudio = audio === null || auds[0] === chosenAudio;
  const direct = !!src.file && !src.disc && containerOk && videoOk && audioOk && firstAudio && burn === null;
  const why = direct ? "plays as it is" : !src.file ? "from the internet, through the server" : !containerOk ? `repackaged (${container.split(",")[0]})` : !videoOk ? `video converted (${v?.codec})` : !audioOk ? `sound converted (${chosenAudio?.codec})` : "converted";
  const q = new URLSearchParams();
  if (audio !== null && chosenAudio) q.set("audio", String(chosenAudio.index));
  if (burn !== null) q.set("burn", String(burn));
  q.set("v", videoOk ? "copy" : "x264");
  q.set("a", audioOk ? "copy" : "aac");
  return {
    mode: direct ? "direct" : "stream",
    url: direct ? `/api/media/${tok}` : `/api/stream/${tok}?${q.toString()}`,
    duration: p.duration, live, seekable: !live, audio: audioTracks, audioIndex: chosenAudio?.index ?? null, subs, why,
  };
}

/** Where a copied (not converted) stream really starts when asked to start at t: the key frame before it. */
export async function keyframeBefore(src: Source, t: number): Promise<number> {
  if (!src.file || src.disc || t <= 0) return t;
  try {
    const input = (await inputArgs(src)).filter((a) => a !== "-i");
    const out = await run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time,best_effort_timestamp_time",
      "-read_intervals", `${Math.max(0, t - 30)}%${t + 0.5}`, "-of", "csv=p=0", ...input], 20000);
    let best = -1;
    for (const line of out.split("\n")) {
      const v = Number(line.split(",").find((x) => x && x !== "N/A"));
      if (Number.isFinite(v) && v <= t + 0.05 && v > best) best = v;
    }
    return best >= 0 ? best : t;
  } catch {
    return t;
  }
}

// --- serving -------------------------------------------------------------------------------

const MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm", mkv: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", aac: "audio/aac" };

export function mime(file: string): string {
  return MIME[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";
}

/** Converts (or repackages) a source from `start` seconds, writing fragmented MP4 to res. */
/** Why the last stream of a source stopped (for the player to say). */
export const streamErrors = new Map<string, string>();

function friendly(err: string): string {
  const http = err.match(/Server returned (\d{3})?\s*([A-Za-z ]+)/);
  if (http) return `the source said no (${(http[1] ? http[1] + " " : "") + http[2].trim()})`;
  if (/Connection refused|timed out|Network is unreachable|resolve/i.test(err)) return "the source can't be reached";
  if (/Invalid data found/i.test(err)) return "the file looks damaged or isn't a video";
  if (/No such file/i.test(err)) return "the file isn't there any more";
  return err.replace(/^\[[^\]]+\]\s*/, "").slice(0, 200) || "it stopped";
}

export async function stream(src: Source, start: number, q: { audio?: string; burn?: string; v?: string; a?: string }, res: ServerResponse, onClose: (fn: () => void) => void, key = ""): Promise<void> {
  streamErrors.delete(key);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  if (start > 0 && !src.live) args.push("-ss", String(start));
  args.push(...(await inputArgs(src)));
  const audio = q.audio !== undefined && /^\d+$/.test(q.audio) ? Number(q.audio) : null;
  const burn = q.burn !== undefined && /^\d+$/.test(q.burn) ? Number(q.burn) : null;
  const copyV = q.v === "copy" && burn === null;
  if (burn !== null) {
    args.push("-filter_complex", `[0:v:0][0:${burn}]overlay[v]`, "-map", "[v]");
  } else if (!src.url) {
    args.push("-map", "0:v:0?");
  }
  if (audio !== null) args.push("-map", `0:${audio}`);
  else if (!src.url || burn !== null) args.push("-map", "0:a:0?");
  if (copyV) {
    args.push("-c:v", "copy");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-maxrate", "12M", "-bufsize", "24M", "-pix_fmt", "yuv420p", "-vf", "scale='min(1920,iw)':-2");
    if (burn !== null) args.splice(args.indexOf("-vf"), 2);
  }
  // HEVC in MP4 needs the hvc1 tag for browsers
  args.push("-tag:v", "hvc1");
  if (q.a === "copy") args.push("-c:a", "copy");
  else args.push("-c:a", "aac", "-b:a", "256k", "-ac", "2");
  args.push("-sn", "-dn", "-max_muxing_queue_size", "4096", "-avoid_negative_ts", "make_zero",
    "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "2000000", "pipe:1");
  // the hvc1 tag only applies to HEVC: drop it for anything else
  const p0 = src.file || src.url ? await probe(src).catch(() => null) : null;
  const vcodec = p0?.streams.find((s) => s.type === "video")?.codec;
  if (!(copyV && vcodec === "hevc")) args.splice(args.indexOf("-tag:v"), 2);
  res.writeHead(200, { "Content-Type": "video/mp4", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  const ff = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
  let errText = "";
  ff.stderr.on("data", (d) => {
    errText = (errText + d.toString()).slice(-2000);
  });
  ff.stdout.pipe(res);
  ff.on("close", (code) => {
    if (code && code !== 255) {
      const last = errText.trim().split("\n").slice(-3).join(" | ");
      log("stream", `ffmpeg ended with ${code}: ${last}`);
      streamErrors.set(key, friendly(last));
      if (streamErrors.size > 50) streamErrors.delete(streamErrors.keys().next().value!);
    }
    res.end();
  });
  onClose(() => {
    if (ff.exitCode === null) ff.kill("SIGKILL");
  });
}

/** A subtitle stream (or file, or web address) as WebVTT text. */
export async function subtitles(src: Source, index: number | null): Promise<string> {
  const key = crypto.createHash("md5").update(JSON.stringify(src) + ":" + index + ":" + (src.file ? safeMtime(src.file) : "")).digest("hex");
  const cache = path.join(DATA, "cache", "subs", key + ".vtt");
  if (fs.existsSync(cache)) return fs.readFileSync(cache, "utf8");
  let text: string;
  if (src.url && index === null) {
    const r = await fetchText(src.url, { cache: 3600, headers: src.headers });
    if (!r.ok) throw new Error("couldn't get the subtitles");
    text = r.text.trimStart().startsWith("WEBVTT") ? r.text : srtToVtt(r.text);
  } else {
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", ...(await inputArgs(src))];
    if (index !== null) args.push("-map", `0:${index}`);
    args.push("-f", "webvtt", "pipe:1");
    text = await run(FFMPEG, args, 120000);
  }
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, text);
  return text;
}

function srtToVtt(s: string): string {
  return "WEBVTT\n\n" + s.replace(/\r/g, "").replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2").replace(/^\d+\n(?=\d\d:)/gm, "");
}
