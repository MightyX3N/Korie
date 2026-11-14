// Pictures for the clients. Every picture address Korie hands out goes
// through here: /img/<signature>/<width>?u=<source>. The server fetches it once
// (from the internet, or a poster.jpg next to a film), shrinks it to the width
// the screen needs and keeps it on disk, so a TV box gets small, ready pictures
// from the server instead of big ones from the internet.
// The signature means clients can only ask for pictures Korie itself listed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { DATA, SECRET } from "./config.ts";
import { fetchBytes } from "./net.ts";

const WIDTHS = [120, 180, 240, 342, 500, 780, 1280, 1920];

function sign(src: string): string {
  return crypto.createHmac("sha256", SECRET).update(src).digest("base64url").slice(0, 16);
}

/** A picture address for clients. src: http(s) address or "file:" + a path on the server. */
export function img(src: string | undefined | null): string {
  if (!src) return "";
  return `/img/${sign(src)}?u=${encodeURIComponent(src)}`;
}

export function valid(sig: string, src: string): boolean {
  const a = Buffer.from(sign(src));
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const inflight = new Map<string, Promise<string | null>>();

/** The picture at the nearest width, as a cached file path (or null). */
export function picture(src: string, width: number): Promise<string | null> {
  const w = WIDTHS.find((x) => x >= width) ?? WIDTHS[WIDTHS.length - 1];
  const key = crypto.createHash("md5").update(src).digest("hex");
  const out = path.join(DATA, "cache/img", key.slice(0, 2), `${key}-${w}.webp`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  const k = out;
  const running = inflight.get(k);
  if (running) return running;
  const job = (async () => {
    let bytes: Buffer | null = null;
    if (src.startsWith("file:")) {
      try {
        bytes = fs.readFileSync(src.slice(5));
      } catch {
        bytes = null;
      }
    } else if (/^https?:\/\//.test(src)) {
      bytes = await fetchBytes(src);
    }
    if (!bytes) return null;
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await sharp(bytes, { failOn: "none" }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toFile(out + ".tmp");
      fs.renameSync(out + ".tmp", out);
      return out;
    } catch {
      return null;
    }
  })().finally(() => inflight.delete(k));
  inflight.set(k, job);
  return job;
}
