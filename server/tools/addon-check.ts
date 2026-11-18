// Runs an add-on's real Lua in Korie's real sandbox, with its fetches answered from a script of
// recorded answers instead of the internet: the way to test a sign-in without a real account.
//
//   node tools/addon-check.ts <addon dir> <script.json>
//
// script.json: { "call": "login", "args": [...], "ctx": {...},
//                "answers": [ { "match": "regex on the url", "status": 200, "url": "final url",
//                               "json": {...} | "text": "..." } ],
//                "expect": { "path.to.value": "expected" } }
// Each fetch takes the first unused answer whose match fits. Every fetch is printed with what it
// sent (method, headers, body) so the requests can be checked against the real service's.
import fs from "node:fs";
import path from "node:path";
import { Sandbox } from "../src/addons/sandbox.ts";

const [dir, scriptFile] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "addon.json"), "utf8"));
const script = JSON.parse(fs.readFileSync(scriptFile, "utf8"));
const sb = await Sandbox.load(manifest.id, fs.readFileSync(path.join(dir, manifest.main ?? "main.lua"), "utf8"), (m) => console.log("  [print]", m));
const used = new Set<number>();
const ctx = { now: Math.floor(Date.now() / 1000), language: "da", settings: {}, ...(script.ctx ?? {}) };

async function answer(job: any, res: any): Promise<unknown> {
  const url = String(job.url ?? "");
  const i = script.answers.findIndex((a: any, k: number) => !used.has(k) && new RegExp(a.match).test(url));
  const method = String(job.method ?? res.method ?? (job.body || job.form ? "POST" : "GET")).toUpperCase();
  const body = job.form ? new URLSearchParams(job.form).toString() : job.body ? JSON.stringify(job.body) : "";
  console.log(`  fetch ${method} ${url.slice(0, 160)}${job.cookies ? ` [cookies:${job.cookies}]` : ""}`);
  if (job.headers) console.log(`        headers ${JSON.stringify(job.headers).slice(0, 160)}`);
  if (body) console.log(`        body ${body.slice(0, Number(process.env.BODY ?? 200))}`);
  if (i < 0) {
    console.log("        (no recorded answer: answered as a failure)");
    return (job.as ?? res.as) === "full" ? { status: 0, ok: false, url, text: "", json: null } : null;
  }
  const a = script.answers[i];
  // "live": fetched from the real service (things reachable from here, like Cinemeta)
  if (a.live) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...(job.headers ?? {}) }, body: method === "GET" ? undefined : body || undefined });
    const text = await r.text();
    console.log(`        live: ${r.status}, ${text.length} bytes`);
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* text */ }
    const as = job.as ?? res.as ?? "json";
    if (as === "full") return { status: r.status, ok: r.ok, url: r.url, text, json: parsed };
    if (!r.ok) return null;
    return as === "text" ? text : parsed;
  }
  used.add(i);
  const text = a.text ?? (a.json !== undefined ? JSON.stringify(a.json) : "");
  const as = job.as ?? res.as ?? "json";
  if (as === "full") return { status: a.status ?? 200, ok: (a.status ?? 200) < 400, url: a.url ?? url, text, json: a.json ?? null };
  if ((a.status ?? 200) >= 400) return null;
  return as === "text" ? text : a.json ?? null;
}

let res: any = await sb.call(script.call, [...(script.args ?? []), ctx]);
const saved: Record<string, unknown>[] = [];
for (let step = 0; res && typeof res === "object" && res.fetch !== undefined && res.next; step++) {
  if (step > 30) throw new Error("too many steps");
  if (res.save_account) saved.push(res.save_account);
  const many = Array.isArray(res.fetch);
  const jobs = many ? res.fetch : [res.fetch];
  const answers = [];
  for (const j of jobs) answers.push(await answer(typeof j === "string" ? { url: j } : j, res));
  console.log(`  -> ${res.next}()`);
  res = await sb.call(String(res.next), [many ? answers : answers[0], res.state ?? null]);
}
if (res?.save_account) saved.push(res.save_account);
console.log("\nresult:", JSON.stringify(res, null, 1).slice(0, 3000));
if (saved.length) console.log("save_account:", JSON.stringify(saved).slice(0, 1000));

let bad = 0;
const get = (o: any, p: string) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
for (const [p, want] of Object.entries(script.expect ?? {})) {
  const got = p.startsWith("save.") ? get(Object.assign({}, ...saved), p.slice(5)) : get(res, p);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} ${p} = ${JSON.stringify(got)}${ok ? "" : ` (wanted ${JSON.stringify(want)})`}`);
}
const unused = script.answers.map((_: any, k: number) => k).filter((k: number) => !used.has(k));
if (unused.length) console.log(`NOTE: answers not asked for: ${unused.join(", ")}`);
sb.close();
process.exit(bad ? 1 : 0);
