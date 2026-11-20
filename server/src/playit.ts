// playit.gg: watching from outside the home without opening ports on the router. Korie runs
// playit's own agent (BSD-2-Clause, bundled in the Docker image), links it to the admin's playit
// account once (a claim link they approve), and keeps it running. The admin then makes a TCP
// tunnel on playit.gg pointed at Korie's outside port; everything that comes through it counts
// as outside the home (households.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { log } from "./config.ts";
import { setting, setSetting } from "./db.ts";
import { emit } from "./events.ts";
import { OUTSIDE_PORT } from "./households.ts";

/** where the agent is: KORIE_PLAYIT, the Docker image's copy, or one on the PATH */
function binary(): string {
  const tries = [process.env.KORIE_PLAYIT ?? "", "/usr/local/bin/playit", ...(process.env.PATH ?? "").split(":").map((d) => path.join(d, "playit"))];
  return tries.find((p) => p && fs.existsSync(p)) ?? "";
}

export type Phase = "missing" | "off" | "linking" | "running" | "stopped" | "failed";

let agent: ChildProcess | null = null;
let linking: ChildProcess | null = null;
let phase: Phase = "off";
let claimUrl = "";
let problem = "";
const lines: string[] = [];

/** playit's terminal codes (colours, cursor moves) out */
function plain(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]|\x1b\][^\x07]*\x07/g, "");
}

function note(text: string): void {
  for (const l of text.split(/\r?\n/)) {
    // playit's own colours and cursor codes out
    // eslint-disable-next-line no-control-regex
    const t = plain(l).trim();
    if (!t) continue;
    lines.push(t);
    if (lines.length > 200) lines.shift();
    // a tunnel's address in what it says: kept, so the admin has it to give out
    const m = t.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:ply\.gg|joinmc\.link|playit\.gg))(?::(\d+))?\b/i);
    if (m && !/^(www\.|api\.)?playit\.gg$/i.test(m[1]) && !String(setting("playit_address") ?? "")) setSetting("playit_address", m[2] ? `${m[1]}:${m[2]}` : m[1]);
  }
}

function setPhase(p: Phase, why = ""): void {
  phase = p;
  problem = why;
  emit("playit");
}

function run(args: string[], onOut: (s: string) => void): ChildProcess {
  const c = spawn(binary(), args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
  c.stdout!.setEncoding("utf8").on("data", onOut);
  c.stderr!.setEncoding("utf8").on("data", onOut);
  return c;
}

export function status() {
  const has = !!binary();
  return {
    installed: has, phase: has ? phase : "missing", linked: !!secret(), claimUrl: phase === "linking" ? claimUrl : "", problem,
    address: String(setting("playit_address") ?? ""), outsidePort: OUTSIDE_PORT, on: !!setting("playit_on"), log: lines.slice(-60),
  };
}

function secret(): string {
  return String(setting("playit_secret") ?? "");
}

/** Links the agent to the admin's playit account: a link they open and approve; when they have, it starts. */
export async function link(): Promise<string> {
  if (!binary()) throw new Error("playit isn't installed here.");
  if (linking) return claimUrl;
  // a claim code is five random bytes in hex, made the way playit's own "claim generate" does
  const code = crypto.randomBytes(5).toString("hex");
  const url = `https://playit.gg/claim/${code}`;
  claimUrl = url;
  setPhase("linking");
  let out = "";
  // waits (up to 15 minutes) until the admin approves it on playit.gg
  // (what it prints is the agent's key: not in the log)
  // (-s: it writes plain lines, not a terminal screen)
  linking = run(["-s", "claim", "exchange", code, "900"], (s) => (out += plain(s)));
  linking.on("error", (e) => setPhase("failed", e.message));
  linking.on("close", (codeOut) => {
    linking = null;
    const key = [...out.matchAll(/\b[0-9a-f]{32,}\b/gi)].pop()?.[0] ?? "";
    if (codeOut === 0 && key) {
      setSetting("playit_secret", key);
      setSetting("playit_on", true);
      log("playit", "linked to the playit.gg account");
      start();
    } else setPhase("failed", codeOut === 0 ? "playit didn't give back its key." : "The link wasn't approved in time. Try again.");
  });
  return url;
}

export function start(): void {
  if (!binary() || !secret() || agent) return;
  setSetting("playit_on", true);
  setPhase("running");
  const c = run(["--secret", secret(), "--stdout", "start"], note);
  agent = c;
  c.on("error", (e) => setPhase("failed", e.message));
  c.on("close", (code) => {
    if (agent !== c) return;
    agent = null;
    if (!setting("playit_on")) return setPhase("stopped");
    // it stopped by itself: again in a while
    setPhase("failed", `playit stopped (${code}). Starting it again in 30 seconds.`);
    setTimeout(() => {
      if (setting("playit_on") && !agent) start();
    }, 30_000).unref();
  });
}

export function stop(): void {
  setSetting("playit_on", false);
  linking?.kill();
  linking = null;
  const c = agent;
  agent = null;
  c?.kill();
  setPhase("stopped");
}

/** Unlinks it from the playit account (it can be linked again). */
export function forget(): void {
  stop();
  setSetting("playit_secret", "");
  setSetting("playit_address", "");
  setPhase("off");
}

export function setAddress(a: string): void {
  setSetting("playit_address", a.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").slice(0, 120));
  emit("playit");
}

/** At start: running again if it was. */
export function boot(): void {
  if (setting("playit_on") && secret()) start();
  // when Korie stops, the agent stops with it (a second one would start next time)
  const end = () => {
    agent?.kill();
    linking?.kill();
  };
  process.on("exit", end);
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      end();
      process.exit(0);
    });
  }
}
