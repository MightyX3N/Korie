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
    const t = plain(l).trim();
    if (!t || t === lines[lines.length - 1]) continue;
    lines.push(t);
    if (lines.length > 200) lines.shift();
  }
}

// What the agent shows: it redraws a screen every few seconds (its state, and its tunnels as
// "address:port => 127.0.0.1:8101 (...)"). The latest screen is kept, and read for the tunnel.
let raw = "";
let screen: string[] = [];
let shown = "";
let tunnels = { address: "", other: "", addUrl: "" };
let emitAt = 0;
// eslint-disable-next-line no-control-regex
const NEW_SCREEN = /\x1b\[[23]J|\x1b8|\x1b\[u|\x1b\[H/g;

function onScreen(chunk: string): void {
  raw = (raw + chunk).slice(-20000);
  const parts = raw.split(NEW_SCREEN).map(plain);
  // the screen being drawn, or the one before it if this one has only just been cleared
  let cur = parts[parts.length - 1].trim() ? parts[parts.length - 1] : parts[parts.length - 2] ?? "";
  // (written as plain lines, with no screen codes: from the last state line on)
  const head = cur.lastIndexOf("playit (v");
  if (head > 0) cur = cur.slice(head);
  const ls = cur.split(/\r?\n/).map((l) => l.trimEnd()).filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()));
  screen = ls.slice(0, 40);
  note(screen[0] ?? "");
  const t = { address: "", other: "", addUrl: "" };
  for (const l of screen) {
    const m = l.trim().match(/^(\S+?) => (\S+):(\d+)( \(disabled\))?/);
    if (m && !m[4]) {
      if (Number(m[3]) === OUTSIDE_PORT && !t.address) t.address = m[1];
      else if (Number(m[3]) !== OUTSIDE_PORT && !t.other) t.other = `${m[1]} goes to port ${m[3]}`;
    }
    const add = l.match(/Add tunnels here: (https:\/\/\S+)/);
    if (add) t.addUrl = add[1];
  }
  tunnels = t;
  if (t.address && t.address !== String(setting("playit_address") ?? "")) setSetting("playit_address", t.address);
  // the page hears of it when what it shows changed (not the clock in it), at most every 2 s
  const key = screen.join("\n").replace(/\d{6,}/g, "");
  if (key !== shown && Date.now() - emitAt > 2000) {
    shown = key;
    emitAt = Date.now();
    emit("playit");
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
    address: String(setting("playit_address") ?? "") || tunnels.address, tunnel: tunnelNote,
    outsidePort: OUTSIDE_PORT, on: !!setting("playit_on"), screen: agent ? screen : [], log: lines.slice(-60),
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
  linking = run(["-s", "claim", "exchange", code, "--wait", "900"], (s) => (out += plain(s)));
  linking.on("error", (e) => setPhase("failed", e.message));
  linking.on("close", (codeOut) => {
    linking = null;
    const key = [...out.matchAll(/\b[0-9a-f]{32,}\b/gi)].pop()?.[0] ?? "";
    if (codeOut === 0 && key) {
      setSetting("playit_secret", key);
      setSetting("playit_on", true);
      log("playit", "linked to the playit.gg account");
      start();
    } else {
      // what playit said last (why it stopped)
      const last = out.trim().split("\n").pop()?.replace(/^.*?(INFO|WARN|ERROR)\s+\S+:\s*/, "").trim() ?? "";
      log("playit", `linking stopped (${codeOut}): ${out.trim().slice(-500)}`);
      setPhase("failed", codeOut === 0 ? "playit didn't give back its key." : /too long|TimedOut/i.test(out) ? "The link wasn't approved in time. Try again." : `playit stopped while linking${last ? `: ${last}` : ""}. Try again.`);
    }
  });
  return url;
}

// --- the tunnel: Korie makes it on the admin's playit account (TCP, to the outside port) ---------

const API = process.env.KORIE_PLAYIT_API || "https://api.playit.gg";

async function api<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Agent-Key ${secret()}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => null)) as { status?: string; data?: unknown } | null;
  if (j?.status === "success") return j.data as T;
  throw new Error(`playit.gg answered ${j?.status ?? r.status}: ${JSON.stringify(j?.data ?? "").slice(0, 200)}`);
}

interface RunData {
  agent_id: string;
  tunnels: { id: string; name: string | null; port: { from: number; to: number }; proto: string; local_ip: string; local_port: number; tunnel_type: string | null; assigned_domain: string; custom_domain: string | null; disabled: unknown }[];
  pending: { id: string; name: string | null; proto: string }[];
}

let tunnelNote = "";

/** Makes sure the account has Korie's tunnel (TCP, to 127.0.0.1 and the outside port), and keeps its address. */
async function ensureTunnel(): Promise<void> {
  if (!secret()) return;
  try {
    const d = await api<RunData>("/agents/rundata", {});
    const mine = d.tunnels.find((t) => t.local_port === OUTSIDE_PORT && (t.proto === "tcp" || t.proto === "both") && !t.tunnel_type);
    if (mine) {
      const a = `${mine.custom_domain || mine.assigned_domain}:${mine.port.from}`;
      tunnelNote = mine.disabled ? "playit.gg has turned the tunnel off: see your account on playit.gg." : "";
      if (a !== String(setting("playit_address") ?? "")) {
        setSetting("playit_address", a);
        log("playit", `the tunnel's address: ${a}`);
      }
      emit("playit");
      return;
    }
    if (d.pending.some((t) => t.name === "Korie")) {
      tunnelNote = "playit.gg is setting up the tunnel.";
      emit("playit");
      setTimeout(() => void ensureTunnel(), 10_000).unref();
      return;
    }
    await api("/tunnels/create", {
      name: "Korie", tunnel_type: null, port_type: "tcp", port_count: 1,
      origin: { type: "agent", data: { agent_id: d.agent_id, local_ip: "127.0.0.1", local_port: OUTSIDE_PORT } },
      enabled: true, alloc: null, firewall_id: null,
    });
    log("playit", `made a tunnel on playit.gg to port ${OUTSIDE_PORT}`);
    tunnelNote = "playit.gg is setting up the tunnel.";
    emit("playit");
    setTimeout(() => void ensureTunnel(), 5_000).unref();
  } catch (e) {
    tunnelNote = `Couldn't make the tunnel on playit.gg: ${e instanceof Error ? e.message : e}`;
    log("playit", tunnelNote);
    emit("playit");
  }
}

export function start(): void {
  if (!binary() || !secret() || agent) return;
  setSetting("playit_on", true);
  setPhase("running");
  raw = "";
  screen = [];
  tunnels = { address: "", other: "", addUrl: "" };
  // (without -s: with it, playit only logs the first line of each screen, and not its tunnels)
  const c = run(["--secret", secret(), "start"], onScreen);
  void ensureTunnel();
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
