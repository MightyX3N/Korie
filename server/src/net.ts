// Fetching from the internet, with an optional cache on disk, a timeout, and
// a limit on how many requests run at once per host (so one slow site can't
// hold up everything else).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, log } from "./config.ts";

export interface FetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  cache?: number; // seconds an answer may be reused (GET only)
  timeout?: number; // ms
}

export interface FetchResult {
  ok: boolean;
  status: number;
  text: string;
  error?: string;
}

const PER_HOST = 6;
const active = new Map<string, number>();
const waiting = new Map<string, Array<() => void>>();

async function slot(host: string): Promise<() => void> {
  if ((active.get(host) ?? 0) >= PER_HOST) {
    await new Promise<void>((r) => {
      const q = waiting.get(host) ?? [];
      q.push(r);
      waiting.set(host, q);
    });
  }
  active.set(host, (active.get(host) ?? 0) + 1);
  return () => {
    active.set(host, (active.get(host) ?? 1) - 1);
    const next = waiting.get(host)?.shift();
    if (next) next();
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function cachePath(url: string, opts: FetchOpts): string {
  const k = crypto.createHash("md5").update(url + "\n" + JSON.stringify(opts.headers ?? {})).digest("hex");
  return path.join(DATA, "cache/fetch", k.slice(0, 2), k + ".txt");
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const method = (opts.method ?? "GET").toUpperCase();
  const cp = cachePath(url, opts);
  if (opts.cache && method === "GET") {
    try {
      const st = fs.statSync(cp);
      if (Date.now() - st.mtimeMs < opts.cache * 1000) return { ok: true, status: 200, text: fs.readFileSync(cp, "utf8") };
    } catch {
      /* not cached */
    }
  }
  const release = await slot(hostOf(url));
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": "Korie/0.6 (+https://github.com/MightyX3N/Korie)", ...(opts.headers ?? {}) },
      body: method === "GET" || method === "HEAD" ? undefined : opts.body,
      signal: AbortSignal.timeout(opts.timeout ?? 20000),
      redirect: "follow",
    });
    const text = await res.text();
    if (res.ok && opts.cache && method === "GET") {
      fs.mkdirSync(path.dirname(cp), { recursive: true });
      fs.writeFileSync(cp, text);
    }
    if (!res.ok) log("net", `${method} ${url.replace(/api_key=[^&]+/, "api_key=…")} -> ${res.status} (${Date.now() - t0} ms)`);
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log("net", `${method} ${url.replace(/api_key=[^&]+/, "api_key=…")} failed: ${error}`);
    return { ok: false, status: 0, text: "", error };
  } finally {
    release();
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  const r = await fetchText(url, opts);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.text) as T;
  } catch {
    return null;
  }
}

export async function fetchBytes(url: string, timeout = 20000): Promise<Buffer | null> {
  const release = await slot(hostOf(url));
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Korie/0.6" }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    release();
  }
}
