// The Kodi repository: the server hands out its own Kodi add-ons, so a Kodi in the house
// installs "Korie" from the server it will talk to, and gets updates when the server updates.
// /kodi/                    a plain page listing repository.korie-<version>.zip, for "Install from zip file"
// /kodi/repo/addons.xml(.md5) and /kodi/repo/<id>/<id>-<version>.zip: the repository itself.
// (Separate folders on purpose: Kodi caches what /kodi/ lists and would think repo files are missing.)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import yazl from "yazl";
import { KODI_DIR, VERSION, log } from "./config.ts";

interface Addon { id: string; dir: string; xml: string }

/** Kodi add-on versions must be plain numbers: "0.6.0-beta" becomes "0.6.0". */
const KVERSION = VERSION.replace(/[^0-9.].*$/, "") || "0.0.0";

function addons(base: string): Addon[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(KODI_DIR).filter((n) => fs.existsSync(path.join(KODI_DIR, n, "addon.xml")));
  } catch {
    return [];
  }
  return names.map((id) => {
    const xml = fs.readFileSync(path.join(KODI_DIR, id, "addon.xml"), "utf8")
      .replace(/<!--[\s\S]*?-->\s*/g, "")
      .replaceAll("{VERSION}", KVERSION)
      .replaceAll("{BASE}", base);
    return { id, dir: path.join(KODI_DIR, id), xml };
  });
}

function index(list: Addon[]): string {
  const body = list.map((a) => a.xml.replace(/^<\?xml[^>]*\?>\s*/, "").trim()).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<addons>\n${body}\n</addons>\n`;
}

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "__pycache__") continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.push(f);
    }
  };
  walk(dir);
  return out.sort();
}

const zips = new Map<string, Buffer>();

function zip(a: Addon): Promise<Buffer> {
  const key = a.id + "|" + crypto.createHash("md5").update(a.xml).digest("hex") + "|" + files(a.dir).map((f) => f + fs.statSync(f).mtimeMs).join();
  const hit = zips.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const z = new yazl.ZipFile();
    for (const f of files(a.dir)) {
      const rel = a.id + "/" + path.relative(a.dir, f).split(path.sep).join("/");
      if (rel === a.id + "/addon.xml") z.addBuffer(Buffer.from(a.xml), rel);
      else z.addFile(f, rel);
    }
    z.end();
    const parts: Buffer[] = [];
    z.outputStream.on("data", (d: Buffer) => parts.push(d));
    z.outputStream.on("error", reject);
    z.outputStream.on("end", () => {
      const b = Buffer.concat(parts);
      zips.set(key, b);
      resolve(b);
    });
  });
}

/** The address Kodi used to reach us, so the repository points back to the same place. */
export function baseOf(host: string | undefined, proto = "http"): string {
  return `${proto}://${host ?? "localhost"}/kodi/`;
}

export type KodiFile = { type: string; body: string | Buffer } | null;

/** What to answer for a path under /kodi/. */
export async function serve(rel: string, base: string): Promise<KodiFile> {
  const list = addons(base);
  if (rel === "" || rel === "/") {
    const repo = `repository.korie-${KVERSION}.zip`;
    // Kodi's file browser reads the links on this page
    return { type: "text/html; charset=utf-8", body: `<!DOCTYPE html><html><head><title>Korie for Kodi</title></head><body>
<h1>Korie for Kodi</h1>
<p>In Kodi: Add-ons, Install from zip file, then this source, then the file below.</p>
<a href="${repo}">${repo}</a>
</body></html>` };
  }
  if (rel === "repo/addons.xml") return { type: "text/xml; charset=utf-8", body: index(list) };
  if (rel === "repo/addons.xml.md5") return { type: "text/plain", body: crypto.createHash("md5").update(index(list)).digest("hex") };
  // the repository itself, at the top for "Install from zip file"
  let m = rel.match(/^(repository\.korie)-([0-9.]+)\.zip$/i) ?? rel.match(/^repo\/([a-z0-9._-]+)\/\1-([0-9.]+)\.zip$/i);
  if (m) {
    const a = list.find((x) => x.id === m![1]);
    if (!a) return null;
    try {
      return { type: "application/zip", body: await zip(a) };
    } catch (e) {
      log("kodi", `couldn't pack ${a.id}: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
  // pictures Kodi shows for an add-on: /kodi/<id>/icon.png
  m = rel.match(/^repo\/([a-z0-9._-]+)\/([a-z0-9._-]+\.(?:png|jpg))$/i);
  if (m) {
    const a = list.find((x) => x.id === m![1]);
    const f = a ? path.join(a.dir, m[2]) : "";
    if (f && fs.existsSync(f)) return { type: m[2].endsWith(".png") ? "image/png" : "image/jpeg", body: fs.readFileSync(f) };
  }
  return null;
}

export { KVERSION };
