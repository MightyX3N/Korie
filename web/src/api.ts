// Talking to the Korie server this page came from.

const TOKEN = "korie.token";
const DEVICE = "korie.device";

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data: any = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const HOUSEHOLD = "korie.household";

/** From outside the home: the household this browser signed in to (once). */
export function householdToken(): string {
  return store()?.getItem(HOUSEHOLD) ?? "";
}

export function setHouseholdToken(t: string): void {
  if (t) store()?.setItem(HOUSEHOLD, t);
  else store()?.removeItem(HOUSEHOLD);
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function token(): string {
  return store()?.getItem(TOKEN) ?? "";
}

export function setToken(t: string): void {
  if (t) store()?.setItem(TOKEN, t);
  else store()?.removeItem(TOKEN);
}

/** This browser's own id, so the server can tell devices apart ("Signed in on"). */
export function deviceId(): string {
  let id = store()?.getItem(DEVICE) ?? "";
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    store()?.setItem(DEVICE, id);
  }
  return id;
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `Korie in ${browser}${os ? ` on ${os}` : ""}`;
}

/** Calls the server. A body makes it a POST unless method says otherwise; errors carry the server's own words. */
export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const h = householdToken();
  if (h) headers["X-Korie-Household"] = h;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, { method: method ?? (body !== undefined ? "POST" : "GET"), headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, "Can't reach the Korie server. Check that it's running.");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 || data?.household === "refused" || data?.household === "stopped") window.dispatchEvent(new Event("korie:signedout"));
    throw new ApiError(res.status, data?.error ?? `The server answered ${res.status}.`, data);
  }
  return data as T;
}

/** A picture from Korie at the width it's shown (Korie shrinks it); outside pictures as they are. */
export function pic(path: string | undefined, width: number): string {
  if (!path) return "";
  if (/^https?:/.test(path)) return path;
  const w = Math.round(width * Math.min(2, window.devicePixelRatio || 1));
  return `${path}${path.includes("?") ? "&" : "?"}w=${w}`;
}

type Listener = (topics: string[]) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

/** What changed on the server ("library", "browse", "people" ...), from its event stream. */
export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  if (!source && token()) {
    source = new EventSource(`/api/events?t=${encodeURIComponent(token())}`);
    source.onmessage = (e) => {
      try {
        const topics = JSON.parse(e.data);
        if (Array.isArray(topics)) for (const l of listeners) l(topics);
      } catch {
        /* not for us */
      }
    };
  }
  return () => {
    listeners.delete(fn);
  };
}

export function closeEvents(): void {
  source?.close();
  source = null;
}

/** What this browser plays as it is, so the server sends files untouched when it can. */
export function caps(): string {
  const v = document.createElement("video");
  const can = (t: string) => v.canPlayType(t) !== "";
  const video = ["h264"];
  if (can('video/mp4; codecs="hvc1"') || can('video/mp4; codecs="hev1.1.6.L93.B0"')) video.push("hevc");
  if (can('video/webm; codecs="vp9"')) video.push("vp9");
  if (can('video/webm; codecs="vp8"')) video.push("vp8");
  if (can('video/mp4; codecs="av01.0.05M.08"')) video.push("av1");
  const audio = ["aac", "mp3", "opus", "vorbis", "flac"];
  if (can('audio/mp4; codecs="ac-3"')) audio.push("ac3");
  if (can('audio/mp4; codecs="ec-3"')) audio.push("eac3");
  return `v:${video.join(",")};a:${audio.join(",")};c:mp4,webm`;
}
