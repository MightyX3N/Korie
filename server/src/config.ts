// Where Korie keeps its data, and the few settings that come from outside.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const VERSION = "0.6.0";

export const DATA = path.resolve(process.env.KORIE_DATA ?? "./data");
export const PORT = Number(process.env.KORIE_PORT ?? 8100);
export const DISCOVERY_PORT = 7361; // Jellyfin uses 7359: Korie stays clear of it
export const CLIENT_DIR = path.resolve(process.env.KORIE_CLIENT ?? path.join(import.meta.dirname, "../../client/dist"));
export const STORE_URL = (process.env.KORIE_STORE ?? "https://raw.githubusercontent.com/MightyX3N/korie-store/main/").replace(/\/?$/, "/");
export const FFMPEG = process.env.KORIE_FFMPEG ?? "ffmpeg";
export const FFPROBE = process.env.KORIE_FFPROBE ?? "ffprobe";

for (const d of ["", "cache", "cache/img", "cache/tmdb", "cache/fetch", "cache/browse", "addons"]) {
  fs.mkdirSync(path.join(DATA, d), { recursive: true });
}

/** A secret made once per server, for signing picture addresses and sessions. */
export const SECRET: Buffer = (() => {
  const f = path.join(DATA, "secret.key");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32), { mode: 0o600 });
  return fs.readFileSync(f);
})();

/** The TMDb key: KORIE_TMDB_KEY, or the scrambled one built into Korie (tools/make_secret.mjs). */
export function builtInTmdbKey(): string {
  if (process.env.KORIE_TMDB_KEY) return process.env.KORIE_TMDB_KEY.trim();
  const f = path.join(import.meta.dirname, "../secret.dat");
  if (!fs.existsSync(f)) return "";
  const data = fs.readFileSync(f);
  if (data.length <= 8) return "";
  const pad = crypto.createHash("sha256").update("korie:tmdb:v1").digest();
  const nonce = data.subarray(0, 8);
  const body = data.subarray(8);
  const out = Buffer.alloc(body.length);
  let stream = Buffer.alloc(0);
  for (let i = 0; stream.length < body.length; i++) {
    const n = Buffer.alloc(4);
    n.writeUInt32LE(i);
    stream = Buffer.concat([stream, crypto.createHash("sha256").update(Buffer.concat([pad, nonce, n])).digest()]);
  }
  for (let j = 0; j < body.length; j++) out[j] = body[j] ^ stream[j];
  return out.toString("utf8");
}

export function log(area: string, msg: string): void {
  console.log(`${new Date().toISOString().slice(11, 23)} [${area}] ${msg}`);
}
