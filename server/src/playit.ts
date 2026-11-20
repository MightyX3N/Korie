// playit.gg: watching from outside the home without opening ports on the router. Korie runs
// playit's own agent (playit 2.0: playitd, and playit-cli to link it; BSD-2-Clause, bundled in
// the Docker image), links it to the admin's playit account once (a claim link they approve),
// makes a TCP tunnel on that account to Korie's outside port, and keeps the agent running.
// Everything that comes through the tunnel counts as outside the home (households.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { log } from "./config.ts";
import { setting, setSetting } from "./db.ts";
import { emit } from "./events.ts";
import { OUTSIDE_PORT } from "./households.ts";

/** a program of playit's: an override, the Docker image's copy, or one on the PATH */
function find(name: string, env: string): string {
  const tries = [process.env[env] ?? "", `/usr/local/bin/${name}`, ...(process.env.PATH ?? "").split(":").map((d) => path.join(d, name))];
  return tries.find((p) => p && fs.existsSync(p)) ?? "";
}
const daemon = () => find("playitd", "KORIE_PLAYITD");
const cli = () => find("playit-cli", "KORIE_PLAYIT_CLI");

export type Phase = "missing" | "off" | "linking" | "running" | "stopped" | "failed";

let agent: ChildProcess | null = null;
let linking: ChildProcess | null = null;
let phase: Phase = "off";
let claimUrl = "";
let problem = "";
const lines: string[] = [];
let emitAt = 0;

/** playit's terminal codes (colours, cursor moves) out */
function plain(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]|\x1b\][^\x07]*\x07/g, "");
}

/** What the agent writes (plain log lines): kept, and the page hears of it (at most every 2 s). */
function note(text: string): void {
  for (const l of plain(text).split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t === lines[lines.length - 1]) continue;
    lines.push(t);
    if (lines.length > 200) lines.shift();
  }
  if (Date.now() - emitAt > 2000) {
    emitAt = Date.now();
    emit("playit");
  }
}

function setPhase(p: Phase, why = ""): void {
  phase = p;
  problem = why;
  emit("playit");
}

function run(bin: string, args: string[], onOut: (s: string) => void): ChildProcess {
  const c = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
  c.stdout!.setEncoding("utf8").on("data", onOut);
  c.stderr!.setEncoding("utf8").on("data", onOut);
  return c;
}

function secret(): string {
  return String(setting("playit_secret") ?? "");
}

let tunnelNote = "";

export function status() {
  const has = !!daemon() && !!cli();
  return {
    installed: has, phase: has ? phase : "missing", linked: !!secret(), claimUrl: phase === "linking" ? claimUrl : "", problem,
    address: String(setting("playit_address") ?? ""), tunnel: tunnelNote,
    outsidePort: OUTSIDE_PORT, on: !!setting("playit_on"), screen: agent ? lines.slice(-15) : [], log: lines.slice(-60),
  };
}

/** Links the agent to the admin's playit account: a link they open and approve; when they have, it starts. */
export async function link(): Promise<string> {
  if (!cli()) throw new Error("playit isn't installed here.");
  if (linking) return claimUrl;
  // a claim code is five random bytes in hex, made the way playit-cli's own "claim generate" does
  const code = crypto.randomBytes(5).toString("hex");
  claimUrl = `https://playit.gg/claim/${code}`;
  setPhase("linking");
  let out = "";
  // waits (up to 15 minutes) until the admin approves it on playit.gg; what it prints last is
  // the agent's key (so not in the log)
  linking = run(cli(), ["claim", "exchange", code, "--wait", "900"], (s) => (out += plain(s)));
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
      const last = out.trim().split("\n").pop()?.trim() ?? "";
      log("playit", `linking stopped (${codeOut}): ${out.trim().slice(-500)}`);
      setPhase("failed", codeOut === 0 ? "playit didn't give back its key." : /too long|timed ?out/i.test(out) ? "The link wasn't approved in time. Try again." : `playit stopped while linking${last ? `: ${last}` : ""}. Try again.`);
    }
  });
  return claimUrl;
}

// --- the tunnel: Korie makes it on the admin's playit account (TCP, to the outside port) ---------
// playit's API as playit's own agent uses it (api_client, v2.0.2): /v1/agents/rundata and
// /v1/tunnels/create, with the agent's key.

const API = process.env.KORIE_PLAYIT_API || "https://api.playit.gg";

async function api<T>(p: string, body: unknown): Promise<T> {
  const r = await fetch(API + p, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Agent-Key ${secret()}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => null)) as { status?: string; data?: unknown } | null;
  if (j?.status === "success") return j.data as T;
  throw new Error(`playit.gg answered ${j?.status ?? r.status}: ${JSON.stringify(j?.data ?? "").slice(0, 200)}`);
}

interface Field { name: string; value: string }
interface RunData {
  agent_id: string;
  tunnels: { id: string; name: string; display_address: string; port_type: string; tunnel_type: string | null; agent_config: { fields: Field[] }; disabled_reason: string | null }[];
  pending: { id: string; name: string; status_msg: string }[];
}

let checking: NodeJS.Timeout | null = null;

/** Makes sure the account has Korie's tunnel (TCP, to 127.0.0.1 and the outside port), and keeps its address. */
async function ensureTunnel(): Promise<void> {
  if (!secret()) return;
  const again = (ms: number) => {
    if (checking) clearTimeout(checking);
    checking = setTimeout(() => void ensureTunnel(), ms);
    checking.unref();
  };
  try {
    const d = await api<RunData>("/v1/agents/rundata", {});
    const field = (t: RunData["tunnels"][number], n: string) => t.agent_config?.fields?.find((f) => f.name === n)?.value?.trim() ?? "";
    const mine = d.tunnels.find((t) => !t.tunnel_type && (t.port_type === "tcp" || t.port_type === "both") && Number(field(t, "local_port")) === OUTSIDE_PORT);
    if (mine) {
      tunnelNote = mine.disabled_reason ? `playit.gg has turned the tunnel off: ${mine.disabled_reason}` : "";
      if (mine.display_address !== String(setting("playit_address") ?? "")) {
        setSetting("playit_address", mine.display_address);
        log("playit", `the tunnel's address: ${mine.display_address}`);
      }
      emit("playit");
      again(10 * 60_000);
      return;
    }
    const waiting = d.pending.find((t) => t.name === "Korie");
    if (waiting) {
      tunnelNote = `playit.gg is setting up the tunnel${waiting.status_msg ? `: ${waiting.status_msg}` : "."}`;
      emit("playit");
      again(10_000);
      return;
    }
    await api("/v1/tunnels/create", {
      ports: { type: "custom-tcp", details: 1 },
      origin: { type: "agent", data: { agent_id: d.agent_id, config: { fields: [{ name: "local_ip", value: "127.0.0.1" }, { name: "local_port", value: String(OUTSIDE_PORT) }] } } },
      enabled: true, alloc: null, name: "Korie", firewall_id: null,
    });
    log("playit", `made a tunnel on playit.gg to port ${OUTSIDE_PORT}`);
    tunnelNote = "playit.gg is setting up the tunnel.";
    emit("playit");
    again(5_000);
  } catch (e) {
    tunnelNote = `Couldn't make the tunnel on playit.gg: ${e instanceof Error ? e.message : e}`;
    log("playit", tunnelNote);
    emit("playit");
    again(60_000);
  }
}

export function start(): void {
  if (!daemon() || !secret() || agent) return;
  setSetting("playit_on", true);
  setPhase("running");
  // playitd in the foreground, writing plain log lines (as in playit's own Docker image)
  const sock = path.join(os.tmpdir(), "korie-playitd.sock");
  const c = run(daemon(), [`--secret=${secret()}`, "--platform-docker", "--socket-path", sock], note);
  agent = c;
  void ensureTunnel();
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
  if (checking) clearTimeout(checking);
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
  tunnelNote = "";
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
