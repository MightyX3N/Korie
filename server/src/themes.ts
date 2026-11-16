// Themes: how Korie looks on the TVs (Kodi). A theme is a folder with a theme.json (colours, fonts)
// and maybe fonts and a background picture. Korie Classic and Ember come with Korie (kodi/themes);
// more come from the Store (entries of type "theme") into the data folder. The TVs ask the server
// which themes there are and fetch the ones they don't have yet.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, KODI_DIR } from "./config.ts";
import { emit } from "./events.ts";

export const USER_DIR = path.join(DATA, "themes");
const BUILTIN_DIR = path.join(KODI_DIR, "themes");
const ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}\.(json|ttf|otf|png|jpg|jpeg|webp)$/;

export interface Theme {
  id: string; name: string; version: string; author: string; builtin: boolean; dir: string;
  files: { name: string; size: number; sha256: string }[];
}

function read(dir: string, builtin: boolean): Theme | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, "theme.json"), "utf8"));
    const id = String(j.id ?? "");
    if (!ID.test(id) || id !== path.basename(dir)) return null;
    const files = fs.readdirSync(dir).filter((n) => FILE.test(n)).sort().map((n) => {
      const body = fs.readFileSync(path.join(dir, n));
      return { name: n, size: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") };
    });
    return { id, name: String(j.name || id), version: String(j.version || "1.0"), author: String(j.author || ""), builtin, dir, files };
  } catch {
    return null;
  }
}

/** Every theme the server has: the built-in ones, then those installed from the Store. */
export function list(): Theme[] {
  const out = new Map<string, Theme>();
  for (const [base, builtin] of [[BUILTIN_DIR, true], [USER_DIR, false]] as const) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      const t = read(path.join(base, d), builtin);
      if (t && !out.has(t.id)) out.set(t.id, t);
    }
  }
  return [...out.values()];
}

export function get(id: string): Theme | null {
  return list().find((t) => t.id === id) ?? null;
}

/** A theme's file, when the theme lists it (nothing else in the folder is handed out). */
export function file(id: string, name: string): string | null {
  const t = get(id);
  if (!t || !t.files.some((f) => f.name === name)) return null;
  return path.join(t.dir, name);
}

export function remove(id: string): boolean {
  const t = get(id);
  if (!t || t.builtin) return false;
  fs.rmSync(t.dir, { recursive: true, force: true });
  emit("themes");
  return true;
}

/** After the Store wrote a theme's folder: checks it, and tells the screens. */
export function installed(id: string): string {
  const dir = path.join(USER_DIR, id);
  const t = read(dir, false);
  if (!t) {
    fs.rmSync(dir, { recursive: true, force: true });
    return "This theme's theme.json isn't right.";
  }
  emit("themes");
  return "";
}
