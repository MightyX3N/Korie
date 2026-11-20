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
import { DATA, FFMPEG, FFPROBE, PORT, SECRET, log } from "./config.ts";
import { fetchText } from "./net.ts";

// --- what a source is ---------------------------------------------------------------------

/** A local file or folder (DVD), or a web address an add-on gave (with headers). */
export interface Source { file?: string; url?: string; headers?: Record<string, string>; disc?: "dvd" | "bluray" | "iso" | null; live?: boolean; parts?: string[] }

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

export interface Stream {
  index: number; type: "video" | "audio" | "subtitle"; codec: string; lang: string; title: string; channels: number; width: number; height: number; isDefault: boolean; forced: boolean;
  /** HLS with several qualities: which one (FFmpeg's program) it's in */
  program?: number;
}
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
export async function inputArgs(src: Source): Promise<string[]> {
  if (src.url) {
    const h = Object.entries(src.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join("");
    return [...(h ? ["-headers", h] : []), "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-i", src.url];
  }
  const f = src.file!;
  // one film in several files (CD1, CD2): FFmpeg plays them one after another
  if (src.parts && src.parts.length > 1) return ["-f", "concat", "-safe", "0", "-i", await partsList(src.parts)];
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

/** FFmpeg's list of the parts, with each part's length so the whole film's length is right. */
async function partsList(parts: string[]): Promise<string> {
  const key = crypto.createHash("md5").update(parts.map((p) => p + ":" + safeMtime(p)).join("|")).digest("hex");
  const file = path.join(DATA, "cache", "parts", key + ".txt");
  if (fs.existsSync(file)) return file;
  const lines = ["ffconcat version 1.0"];
  for (const p of parts) {
    const out = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], 60000);
    lines.push(`file '${p.replace(/'/g, "'\\''")}'`);
    const d = Number(out.trim());
    if (d > 0) lines.push(`duration ${d}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

/** A web address with several qualities in one (an HLS master playlist, DRTV's channels): the
 *  address of the best one up to 1080p, so FFmpeg reads one plain stream with its own sound and
 *  never has to choose between qualities (which FFmpeg versions do differently). A master whose
 *  sound is a separate playlist stays as it is. */
export async function oneQuality(src: Source): Promise<Source> {
  if (!src.url || !/\.m3u8(\?|$)/i.test(src.url)) return src;
  const r = await fetchText(src.url, { headers: src.headers, cache: src.live ? 0 : 600 }).catch(() => null);
  const text = r?.ok ? r.text : "";
  if (!text.includes("#EXT-X-STREAM-INF")) return src;
  const lines = text.split(/\r?\n/);
  const variants: { url: string; height: number; bw: number; line: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const uri = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith("#"));
    if (!uri) continue;
    const res = lines[i].match(/RESOLUTION=(\d+)x(\d+)/i);
    const bw = lines[i].match(/[^-]BANDWIDTH=(\d+)/i) ?? lines[i].match(/BANDWIDTH=(\d+)/i);
    variants.push({ url: new URL(uri.trim(), src.url).toString(), height: res ? Number(res[2]) : 0, bw: bw ? Number(bw[1]) : 0, line: lines[i] });
  }
  if (!variants.length) return src;
  const fit = variants.filter((v) => !v.height || v.height <= 1080);
  const pool = fit.length ? fit : variants;
  const best = pool.reduce((b, v) => (v.height > b.height || (v.height === b.height && v.bw > b.bw) ? v : b));
  const group = best.line.match(/AUDIO="([^"]+)"/i)?.[1];
  const renditions = lines.filter((l) => /^#EXT-X-MEDIA:/i.test(l) && /TYPE=AUDIO/i.test(l) && /URI="/i.test(l));
  if (!renditions.length) return { ...src, url: best.url };
  // the sound comes separately (DRTV's newer streams): a playlist of its own with just that
  // quality and its sound, which this server hands to FFmpeg, so it reads two streams, not all of them
  const mine = renditions.filter((l) => !group || l.includes(`GROUP-ID="${group}"`));
  if (!mine.length) return src;
  const abs = (l: string) => l.replace(/URI="([^"]+)"/i, (_, u) => `URI="${new URL(u, src.url).toString()}"`);
  const master = [
    "#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS",
    ...mine.map(abs),
    best.line.replace(/,?SUBTITLES="[^"]*"/i, "").replace(/,?CLOSED-CAPTIONS="[^"]*"/i, ""),
    best.url, "",
  ].join("\n");
  return { ...src, url: `http://127.0.0.1:${PORT}/api/hls-master/${seal("m3u8", { text: master, h: src.headers ?? {} })}/index.m3u8` };
}

// --- a stream whose sound comes separately (HLS with fMP4 parts): its own playlists ---------------
// FFmpeg can't jump into such a stream (after a jump it reads the parts without their start), so
// to start further in, the playlists themselves start at the part that has that moment.

function seal(kind: string, v: unknown): string {
  const body = Buffer.from(JSON.stringify(v)).toString("base64url");
  return body + "." + crypto.createHmac("sha256", SECRET).update(kind + ":" + body).digest("base64url").slice(0, 22);
}

function unseal<T>(kind: string, tok: string): T | null {
  const [body, sig] = tok.split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", SECRET).update(kind + ":" + body).digest("base64url").slice(0, 22);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

type Master = { text: string; h: Record<string, string> };
const MASTER = /\/api\/hls-master\/([^/]+)\/index\.m3u8/;

/** The playlist oneQuality made, for FFmpeg here; from: starting at that part (seconds). */
export function masterText(tok: string, from = 0): string | null {
  const m = unseal<Master>("m3u8", tok);
  if (!m) return null;
  if (!(from > 0)) return m.text;
  const local = (u: string) => `http://127.0.0.1:${PORT}/api/hls-media/${seal("media", { u, h: m.h })}/index.m3u8?from=${from}`;
  return m.text.split("\n").map((l) => (l.startsWith("#") ? l.replace(/URI="([^"]+)"/i, (_, u) => `URI="${local(u)}"`) : l.trim() ? local(l.trim()) : l)).join("\n");
}

interface Part { start: number; end: number; lines: string[] }

/** A media playlist's parts, with their addresses made whole (and byte ranges given in full). */
async function parts(u: string, h: Record<string, string>): Promise<{ head: string[]; parts: Part[]; tail: string[] } | null> {
  const r = await fetchText(u, { headers: h, cache: 600 }).catch(() => null);
  if (!r?.ok) return null;
  const head: string[] = [];
  const list: Part[] = [];
  let pending: string[] = [];
  let t = 0;
  let dur = 0;
  const next = new Map<string, number>();
  let range: [number, number | null] | null = null;
  let seen = false;
  for (const raw of r.text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("#EXT-X-MAP")) {
      head.push(l.replace(/URI="([^"]+)"/i, (_, x) => `URI="${new URL(x, u).toString()}"`));
      continue;
    }
    if (l.startsWith("#EXTINF:")) {
      seen = true;
      dur = Number(l.slice(8).split(",")[0]) || 0;
      pending.push(l);
      continue;
    }
    if (l.startsWith("#EXT-X-BYTERANGE:")) {
      const [len, off] = l.slice(17).split("@");
      range = [Number(len), off !== undefined ? Number(off) : null];
      continue;
    }
    if (l.startsWith("#EXT-X-ENDLIST")) continue;
    if (l.startsWith("#")) {
      (seen ? pending : head).push(l);
      continue;
    }
    const abs = new URL(l, u).toString();
    if (range) {
      const off = range[1] ?? next.get(abs) ?? 0;
      pending.push(`#EXT-X-BYTERANGE:${range[0]}@${off}`);
      next.set(abs, off + range[0]);
      range = null;
    }
    pending.push(abs);
    list.push({ start: t, end: t + dur, lines: pending });
    t += dur;
    pending = [];
  }
  return { head: head.filter((x) => !/^#EXT-X-(MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE)/.test(x)), parts: list, tail: ["#EXT-X-ENDLIST"] };
}

/** A media playlist starting at the part that has the moment from. */
export async function mediaText(tok: string, from: number): Promise<string | null> {
  const m = unseal<{ u: string; h: Record<string, string> }>("media", tok);
  if (!m) return null;
  const p = await parts(m.u, m.h);
  if (!p) return null;
  const keep = p.parts.filter((x) => x.end > from + 0.001);
  return [...p.head, "#EXT-X-MEDIA-SEQUENCE:0", ...keep.flatMap((x) => x.lines), ...p.tail, ""].join("\n");
}

/** Where such a stream really starts when asked for t: the picture's part (video) and the sound's (audio). */
export async function partStart(src: Source, t: number): Promise<{ video: number; audio: number } | null> {
  const k = src.url?.match(MASTER)?.[1];
  const m = k ? unseal<Master>("m3u8", k) : null;
  if (!m || t <= 0) return null;
  const lines = m.text.split("\n");
  const v = lines.filter((l) => l.trim() && !l.startsWith("#")).pop();
  const a = lines.find((l) => /TYPE=AUDIO/i.test(l))?.match(/URI="([^"]+)"/i)?.[1];
  const pv = v ? await parts(v, m.h) : null;
  if (!pv?.parts.length) return null;
  const video = (pv.parts.find((x) => x.end > t + 0.001) ?? pv.parts[pv.parts.length - 1]).start;
  const pa = a ? await parts(a, m.h) : null;
  const audio = pa?.parts.find((x) => x.end > video + 0.001)?.start ?? video;
  return { video, audio };
}

export async function probe(src: Source): Promise<Probe> {
  const key = JSON.stringify(src) + (src.file ? ":" + safeMtime(src.file) : "");
  const hit = probes.get(key);
  if (hit && (src.file || Date.now() - hit.at < 10 * 60 * 1000)) return hit.p;
  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_programs", ...(await inputArgs(src)).filter((a) => a !== "-i")];
  const out = await run(FFPROBE, args.slice(0, -1).concat(args[args.length - 1]), src.url ? 20000 : 60000);
  const j = JSON.parse(out);
  const programOf = new Map<number, number>();
  for (const pr of j.programs ?? []) for (const st of pr.streams ?? []) programOf.set(Number(st.index), Number(pr.program_id));
  const p: Probe = {
    container: String(j.format?.format_name ?? ""),
    duration: Number(j.format?.duration ?? 0) || 0,
    streams: (j.streams ?? []).filter((s: any) => ["video", "audio", "subtitle"].includes(s.codec_type) && s.disposition?.attached_pic !== 1).map((s: any) => ({
      index: s.index, type: s.codec_type, codec: String(s.codec_name ?? ""), lang: String(s.tags?.language ?? ""), title: String(s.tags?.title ?? ""),
      channels: Number(s.channels ?? 0), width: Number(s.width ?? 0), height: Number(s.height ?? 0),
      isDefault: s.disposition?.default === 1, forced: s.disposition?.forced === 1,
      ...(programOf.has(Number(s.index)) ? { program: programOf.get(Number(s.index)) } : {}),
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
const LANG: Record<string, string> = { dan: "Dansk", da: "Dansk", eng: "English", en: "English", swe: "Svenska", sv: "Svenska", nor: "Norsk", nob: "Norsk", no: "Norsk", ger: "Deutsch", deu: "Deutsch", de: "Deutsch", fre: "Français", fra: "Français", fr: "Français", spa: "Español", es: "Español", ita: "Italiano", it: "Italiano", fin: "Suomi", fi: "Suomi", dut: "Nederlands", nld: "Nederlands", nl: "Nederlands", jpn: "日本語", ja: "日本語", por: "Português", pt: "Português", pol: "Polski", pl: "Polski", kor: "한국어", ko: "한국어", chi: "中文", zho: "中文", zh: "中文" };

/** Whether two language codes are the same language (eng/en, ger/deu/de ...). */
export function sameLang(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = langName(a), nb = langName(b);
  return a.toLowerCase() === b.toLowerCase() || (!!na && na === nb);
}

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

/** A person's languages: audio to pick first ("" = the file's own), subtitles ("" = the file's own
 *  choice, "off", or a language shown when the audio isn't in it). */
export interface Prefs { audio: string; subs: string }

/** How a source plays for these client abilities. audio: chosen audio stream index; burn: picture subtitle index. */
export async function plan(src: Source, caps: Caps, audio: number | null, burn: number | null, subFiles: string[], extraSubs: { url: string; title: string; language: string; default: boolean }[], prefs: Prefs = { audio: "", subs: "" }): Promise<Plan> {
  const tok = token(src);
  let p: Probe;
  try {
    p = await probe(src);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const http = msg.match(/Server returned (\d{3})/);
    if (src.url && http && Number(http[1]) >= 400) {
      // the source refused: say so now, rather than a player that opens and closes
      throw new Error(Number(http[1]) === 403
        ? "The stream's source refused this server (403 Forbidden). DRTV and some other services only stream to their own country: check that the server's internet connection is in that country (no VPN)."
        : `The stream's source answered ${http[1]}: it isn't there right now.`);
    }
    if (src.url) {
      // can't look inside (some live streams): let FFmpeg try anyway
      p = { container: "", duration: 0, streams: [] };
    } else {
      throw new Error("The file can't be opened: " + (e instanceof Error ? e.message.split("\n")[0] : String(e)));
    }
  }
  // a stream in several qualities (HLS, DRTV's channels): one quality, the best up to 1080p, and
  // the sound from that same quality, picked by hand, so FFmpeg reads one of them and never leaves
  // the sound out or takes it from another
  const programs = new Set(p.streams.map((x) => x.program).filter((x) => x !== undefined));
  const variants = !!src.url && programs.size > 1;
  let v = p.streams.find((s) => s.type === "video");
  if (variants) {
    const vids = p.streams.filter((s) => s.type === "video");
    const fit = vids.filter((x) => !x.height || x.height <= 1080);
    v = (fit.length ? fit : vids).reduce<Stream | undefined>((b, x) => (!b || x.width * x.height > b.width * b.height ? x : b), undefined);
  }
  const all = p.streams.filter((s) => s.type === "audio");
  // the sound tracks to choose from: those of the picked quality (the others are the same again)
  const auds = variants && v ? all.filter((a) => a.program === v!.program).concat(all.filter((a) => a.program !== v!.program)) : all;
  if (variants && v && audio !== null) {
    // a track picked from another quality: the same one in the picked quality
    const was = all.find((a) => a.index === audio);
    const same = was && was.program !== v.program ? all.find((a) => a.program === v!.program && a.lang === was.lang && a.title === was.title) : null;
    if (same) audio = same.index;
  }
  if (audio === null && prefs.audio) {
    // the person's language, when the file has it
    const mine = auds.find((a) => sameLang(a.lang, prefs.audio));
    if (mine && mine !== (auds.find((a) => a.isDefault) ?? auds[0])) audio = mine.index;
  }
  const chosenAudio = audio !== null ? auds.find((a) => a.index === audio) ?? null : (auds.find((a) => a.isDefault && (!variants || a.program === v?.program)) ?? auds[0] ?? null);
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

  pickSubs(subs, chosenAudio?.lang ?? "", prefs.subs);

  let audioTracks: Track[] = auds.map((a) => ({ id: String(a.index), label: audioLabel(a), lang: a.lang, isDefault: a === chosenAudio }));
  // a web stream in several qualities (HLS) has the same sound once per quality: one is enough
  if (src.url) audioTracks = audioTracks.filter((t, i) => audioTracks.findIndex((x) => x.label === t.label && x.lang === t.lang) === i || t.isDefault);
  const container = p.container;
  const containerOk = (MP4ISH.test(container) && caps.containers.includes("mp4")) || (container.startsWith("matroska,webm") && caps.containers.includes("webm") && (!v || ["vp8", "vp9", "av1"].includes(v.codec)))
    // Korie's TV app (ExoPlayer) opens any Matroska file
    || (container.startsWith("matroska") && caps.containers.includes("mkv"));
  const videoOk = !v || codecOk(v.codec, caps.video);
  const audioOk = !chosenAudio || codecOk(chosenAudio.codec, caps.audio);
  const firstAudio = audio === null || auds[0] === chosenAudio;
  const direct = !!src.file && !src.disc && !src.parts && containerOk && videoOk && audioOk && firstAudio && burn === null;
  const why = direct ? "plays as it is" : !src.file ? "from the internet, through the server" : !containerOk ? `repackaged (${container.split(",")[0]})` : !videoOk ? `video converted (${v?.codec})` : !audioOk ? `sound converted (${chosenAudio?.codec})` : "converted";
  const q = new URLSearchParams();
  if ((audio !== null || variants) && chosenAudio) q.set("audio", String(chosenAudio.index));
  if (variants && v) q.set("vi", String(v.index));
  if (burn !== null) q.set("burn", String(burn));
  q.set("v", videoOk ? "copy" : "x264");
  q.set("a", audioOk ? "copy" : "aac");
  return {
    mode: direct ? "direct" : "stream",
    url: direct ? `/api/media/${tok}` : `/api/stream/${tok}?${q.toString()}`,
    duration: p.duration, live, seekable: !live, audio: audioTracks, audioIndex: chosenAudio?.index ?? null, subs, why,
  };
}

/** Marks the subtitles to start with (isDefault) by the person's choice: none when it's "off" or
 *  the audio is already in their language, else the first in their language. Forced subtitles
 *  (for the odd foreign line) stay on. "" leaves the file's own choice. */
export function pickSubs(subs: { lang: string; isDefault: boolean; burn?: boolean; label: string }[], audioLang: string, pref: string): void {
  if (!pref) return;
  const forced = (s: { label: string }) => /forced/i.test(s.label);
  for (const s of subs) if (!forced(s)) s.isDefault = false;
  if (pref === "off" || sameLang(audioLang, pref)) return;
  const mine = subs.find((s) => !s.burn && !forced(s) && sameLang(s.lang, pref)) ?? subs.find((s) => !forced(s) && sameLang(s.lang, pref));
  if (mine) mine.isDefault = true;
}

/** Where a copied (not converted) stream really starts when asked to start at t: the key frame before it. */
export async function keyframeBefore(src: Source, t: number, after = false): Promise<number> {
  if (src.url && MASTER.test(src.url) && t > 0) return (await partStart(src, t))?.video ?? t;
  if (!src.file || src.disc || t <= 0) return t;
  try {
    const input = (await inputArgs(src)).filter((a) => a !== "-i");
    const out = await run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time,best_effort_timestamp_time",
      "-read_intervals", `${Math.max(0, t - 30)}%${t + (after ? 6 : 0.5)}`, "-of", "csv=p=0", ...input], 20000);
    let best = -1;
    let next = -1;
    for (const line of out.split("\n")) {
      const v = Number(line.split(",").find((x) => x && x !== "N/A"));
      if (!Number.isFinite(v)) continue;
      if (v <= t + 0.05 && v > best) best = v;
      if (v > t + 0.05 && v <= t + 5 && (next < 0 || v < next)) next = v;
    }
    // where something ends (an intro): rather the key frame just after it, if one is close
    if (after && next >= 0) return next;
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

export async function stream(src: Source, start: number, q: { audio?: string; burn?: string; v?: string; a?: string; vi?: string }, res: ServerResponse, onClose: (fn: () => void) => void, key = ""): Promise<void> {
  streamErrors.delete(key);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  // a copied picture starts at a key frame: asked for exactly one, FFmpeg can land on the one
  // before it, so aim a hair past it
  const ps = start > 0 && !src.live ? await partStart(src, start) : null;
  if (ps) {
    // its playlists start at the parts that have that moment; the sound may start a little before
    // the picture, so it's cut to the picture's start (copied), or everything to the moment itself
    src = { ...src, url: src.url!.replace(/index\.m3u8$/, `index.m3u8?from=${ps.video}`) };
    args.push(...(await inputArgs(src)));
    const cut = q.v === "copy" && q.burn === undefined ? ps.video - ps.audio : start - ps.audio;
    if (cut > 0.01) args.push("-ss", cut.toFixed(3));
  } else {
    if (start > 0 && !src.live) args.push("-ss", String(q.v === "copy" && q.burn === undefined ? start + 0.05 : start));
    args.push(...(await inputArgs(src)));
  }
  const audio = q.audio !== undefined && /^\d+$/.test(q.audio) ? Number(q.audio) : null;
  const burn = q.burn !== undefined && /^\d+$/.test(q.burn) ? Number(q.burn) : null;
  // which picture: a stream with several qualities (HLS) says which one, else the first
  const vi = q.vi !== undefined && /^\d+$/.test(q.vi) ? Number(q.vi) : null;
  const vsel = vi !== null ? `0:${vi}` : "0:v:0";
  const copyV = q.v === "copy" && burn === null;
  if (burn !== null) {
    args.push("-filter_complex", `[${vsel}][0:${burn}]overlay[v]`, "-map", "[v]");
  } else if (!src.url || audio !== null || vi !== null) {
    // the picture too whenever streams are picked by hand (a chosen audio track alone would leave it out)
    args.push("-map", vi !== null ? vsel : "0:v:0?");
  }
  if (audio !== null) args.push("-map", `0:${audio}`);
  else if (!src.url || burn !== null || vi !== null) args.push("-map", "0:a:0?");
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
  // AAC from an MPEG-TS source (live TV, HLS, .ts recordings) has ADTS headers that MP4 can't hold:
  // without this FFmpeg stops at the first sound packet (DRTV's channels played for a split second)
  const acodec = (audio !== null ? p0?.streams.find((s) => s.index === audio) : p0?.streams.find((s) => s.type === "audio"))?.codec;
  // AAC from a web stream (HLS, MPEG-TS: DRTV's channels) has ADTS headers: copied into MP4 that's
  // started before the first sound packet, the MP4's header has no AAC setup, which Android's player
  // refuses ("couldn't make a stream") and some browsers play without sound. Encoding the sound
  // again gives a complete header from the start (it costs little: the picture is still copied).
  const ts = /mpegts|hls|applehttp/.test(p0?.container ?? "") || (!p0 && !!src.url);
  if (q.a === "copy" && ts && (acodec === "aac" || !p0)) {
    const i = args.indexOf("-c:a");
    args.splice(i, 2, "-c:a", "aac", "-b:a", "192k", "-ac", "2");
  } else if (q.a === "copy" && (acodec === "aac" || (!p0 && src.url))) args.splice(args.indexOf("-c:a") + 2, 0, "-bsf:a", "aac_adtstoasc");
  const ff = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
  // closed by the player (it went away): not a problem with the stream
  let closed = false;
  let errText = "";
  ff.stderr.on("data", (d) => {
    errText = (errText + d.toString()).slice(-2000);
  });
  // the answer starts with ffmpeg's first bytes, so a source that can't be opened (a dead link,
  // a stream only for one country) is an error the app can show, not an empty video
  let started = false;
  ff.stdout.once("data", (first: Buffer) => {
    started = true;
    res.writeHead(200, { "Content-Type": "video/mp4", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.write(first);
    ff.stdout.pipe(res);
  });
  ff.on("close", (code) => {
    let why = "";
    if (code && !(closed && code === 255)) {
      const last = errText.trim().split("\n").slice(-3).join(" | ");
      log("stream", `ffmpeg ended with ${code}: ${last}`);
      why = friendly(last);
      streamErrors.set(key, why);
      if (streamErrors.size > 50) streamErrors.delete(streamErrors.keys().next().value!);
    }
    if (!started && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end("The video could not be started" + (why ? ": " + why : "."));
      return;
    }
    res.end();
  });
  onClose(() => {
    if (ff.exitCode === null) {
      closed = true;
      ff.kill("SIGKILL");
    }
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

/** Plays a few seconds of a stream the way it would be sent (MP4 out), and says whether that worked:
 *  for the admin's Test the channels. */
export async function tryStream(src: Source, seconds = 6): Promise<{ ok: boolean; error: string }> {
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", ...(await inputArgs(src)), "-t", String(seconds),
    "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-f", "mpegts", "pipe:1"];
  return new Promise((resolve) => {
    const ff = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    let bytes = 0;
    let err = "";
    ff.stdout.on("data", (b: Buffer) => (bytes += b.length));
    ff.stderr.on("data", (b: Buffer) => (err += b.toString()));
    const timer = setTimeout(() => ff.kill("SIGKILL"), (seconds + 25) * 1000);
    ff.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && bytes > 50_000) resolve({ ok: true, error: "" });
      else resolve({ ok: false, error: friendly(err) || (code === null ? "it didn't start in time" : `nothing came (${bytes} bytes)`) });
    });
  });
}
