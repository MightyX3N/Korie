// Talking to the Korie server: the same server that served this page.
// The device keeps one sign-in per server in localStorage.

export interface Person { id: string; name: string; color: string; hasPin: boolean; admin?: boolean; canSettings?: boolean; addons?: "all" | string[] }
export interface Card { id: string; kind: string; title: string; subtitle: string; year: string; poster: string; thumb: string; backdrop: string; progress: number; watched: boolean; source: string }
export interface Row { id: string; title: string; kind: string; items: Card[]; source?: string }

const KEY = "korie.session";

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function token(): string {
  return store()?.getItem(KEY) ?? "";
}

export function setToken(t: string): void {
  if (t) store()?.setItem(KEY, t);
  else store()?.removeItem(KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

let onSignedOut: () => void = () => {};
export function whenSignedOut(fn: () => void): void {
  onSignedOut = fn;
}

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { ...(token() ? { Authorization: "Bearer " + token() } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the Korie server. Check that it's running and that this device is on the same network.");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401) {
    setToken("");
    onSignedOut();
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `The server answered ${res.status}.`);
  return data as T;
}

/** A picture at the width it's shown (server shrinks it). */
export function pic(src: string, cssWidth: number): string {
  if (!src) return "";
  const w = Math.round(cssWidth * (window.devicePixelRatio || 1));
  return `${src}&w=${w}`;
}

// --- change notices from the server --------------------------------------------------

type Listener = (what: string[]) => void;
const listeners = new Set<Listener>();
let es: EventSource | null = null;

export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function connectEvents(): void {
  es?.close();
  if (!token()) return;
  es = new EventSource("/api/events?t=" + encodeURIComponent(token()));
  es.onmessage = (e) => {
    let what: string[] = [];
    try {
      what = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const l of listeners) l(what);
  };
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return /TV|AFT|BRAVIA|SHIELD|Chromecast/i.test(ua) ? "Android TV" : "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux";
  return "Browser";
}

/** What this device's browser can play, for the server to decide what to convert. */
export function caps(): string {
  const v = document.createElement("video");
  const can = (t: string) => v.canPlayType(t) !== "";
  const video = ["h264"];
  if (can('video/mp4; codecs="hvc1.1.6.L120.90"') || can('video/mp4; codecs="hev1.1.6.L120.90"')) video.push("hevc");
  if (can('video/webm; codecs="vp9"')) video.push("vp9");
  if (can('video/webm; codecs="vp8"')) video.push("vp8");
  if (can('video/mp4; codecs="av01.0.05M.08"')) video.push("av1");
  const audio = ["aac", "mp3"];
  if (can('audio/webm; codecs="opus"') || can('audio/ogg; codecs="opus"')) audio.push("opus");
  if (can('audio/mp4; codecs="ac-3"')) audio.push("ac3");
  if (can('audio/mp4; codecs="ec-3"')) audio.push("eac3");
  if (can('audio/mp4; codecs="flac"') || can("audio/flac")) audio.push("flac");
  if (can('audio/ogg; codecs="vorbis"')) audio.push("vorbis");
  const containers = ["mp4"];
  if (can("video/webm")) containers.push("webm");
  return `v:${video.join(",")};a:${audio.join(",")};c:${containers.join(",")}`;
}
