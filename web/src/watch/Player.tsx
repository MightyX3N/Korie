// The video player. It never closes by itself on a problem: it says what went wrong and offers to
// try again. A live channel that drops is reconnected a few times before it says so.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Captions, Maximize, Minimize, Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX, AudioLines } from "lucide-react";
import { api, caps } from "../api";
import { back, go, itemPath } from "../router";
import type { Plan } from "../types";
import { music } from "./music";
import { ui } from "../ui";
import { time } from "./ItemPage";

interface Cue { start: number; end: number; text: string }

function parseVtt(t: string): Cue[] {
  const out: Cue[] = [];
  const stamp = (s: string) => {
    const p = s.trim().replace(",", ".").split(":").map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  for (const block of t.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const text = lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (text) out.push({ start: stamp(a), end: stamp(b.trim().split(/\s+/)[0]), text });
  }
  return out;
}

const RETRIES = 3;

export function Player({ id }: { id: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [offset, setOffset] = useState(0); // a stream started part-way: where its 0 is in the film
  const [now, setNow] = useState(0);
  const [paused, setPaused] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [problem, setProblem] = useState("");
  const [osd, setOsd] = useState(true);
  const [panel, setPanel] = useState<"" | "audio" | "subs">("");
  const [subId, setSubId] = useState("");
  const [cues, setCues] = useState<Cue[]>([]);
  const [full, setFull] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [reconnecting, setReconnecting] = useState(0);
  const triedStream = useRef(false);
  const tries = useRef(0);
  const lastReport = useRef(0);
  const hideTimer = useRef(0);
  const startedAt = useRef(0);
  const fromStart = new URLSearchParams(location.search).get("from") === "start";

  const position = () => offset + (video.current?.currentTime ?? 0);
  const duration = plan?.duration || (video.current && Number.isFinite(video.current.duration) ? video.current.duration + offset : 0);

  const report = useCallback((stopped = false, ended = false) => {
    // a channel from the library has nothing to come back to
    if (!plan || plan.channel) return;
    lastReport.current = Date.now();
    const pos = offset + (video.current?.currentTime ?? 0);
    void api("/api/progress", { id: plan.id, position: pos, duration: plan.duration || pos, paused: video.current?.paused ?? false, stopped, ended }).catch(() => {});
  }, [plan, offset]);

  // starts the plan's stream at s seconds
  const start = useCallback(async (p: Plan, s: number, after = false) => {
    const v = video.current;
    if (!v) return;
    setWaiting(true);
    setProblem("");
    startedAt.current = Date.now();
    if (p.mode === "direct") {
      setOffset(0);
      v.src = p.url;
      v.currentTime = s;
    } else {
      if (s > 0 && !p.live) {
        // a copied stream starts at a key frame: the one before s (or after, past an intro)
        const m = p.url.match(/\/api\/stream\/([^?]+)\?(.*)$/);
        const vq = new URLSearchParams(m?.[2] ?? "").get("v");
        if (m) s = (await api<{ start: number }>(`/api/seek/${m[1]}?t=${s}&v=${vq}${after ? "&after=1" : ""}`).catch(() => ({ start: s }))).start;
      } else s = 0;
      setOffset(s);
      v.src = p.url + (s > 0 ? `&start=${s.toFixed(3)}` : "");
    }
    v.play().catch(() => setPaused(true));
  }, []);

  const load = useCallback(async (opts: { audio?: number | null; burn?: number | null; at?: number; forceStream?: boolean; pin?: string; nextProgramme?: boolean } = {}) => {
    setWaiting(true);
    setProblem("");
    let p: Plan;
    try {
      p = await api<Plan>("/api/play", { id, caps: opts.forceStream ? "v:h264;a:aac;c:none" : caps(), audio: opts.audio ?? null, burn: opts.burn ?? null, ...(opts.pin ? { pin: opts.pin } : {}) });
    } catch (e) {
      setWaiting(false);
      setProblem(e instanceof Error ? e.message : String(e));
      return;
    }
    if (p.web) {
      // a game: its own web player, in a tab of its own
      window.open(p.web, "_blank", "noopener");
      back("/games");
      return;
    }
    setPlan(p);
    // a programme above this person's age limit: covered until someone types their PIN
    if (p.locked) {
      const v = video.current;
      if (v) { v.removeAttribute("src"); v.load(); }
      setWaiting(false);
      return;
    }
    const def = p.subs.find((s) => s.isDefault && !s.burn);
    if (opts.at === undefined && def) setSubId(def.id);
    // a channel is always where it's at now
    // (the next programme after one ended: from its start when it's only just begun, so nothing is missed)
    await start(p, p.channel ? (opts.nextProgramme && p.resume < 20 ? 0 : p.resume) : opts.at ?? (fromStart ? 0 : p.resume));
  }, [id, start]);

  useEffect(() => {
    music.stop();
    triedStream.current = false;
    tries.current = 0;
    void load();
  }, [id]);

  // subtitles: read the chosen ones
  useEffect(() => {
    const s = plan?.subs.find((x) => x.id === subId);
    if (!s?.url) {
      setCues([]);
      return;
    }
    fetch(s.url).then((r) => r.text()).then((t) => setCues(parseVtt(t))).catch(() => setCues([]));
  }, [subId, plan?.subs]);

  // progress: every 10 seconds while playing, and when leaving
  useEffect(() => {
    if (!plan) return;
    const t = window.setInterval(() => { if (video.current && !video.current.paused) report(); }, 10000);
    return () => {
      clearInterval(t);
    };
  }, [plan, report]);
  useEffect(() => () => report(true), [report]);

  const poke = useCallback(() => {
    setOsd(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { if (!video.current?.paused) { setOsd(false); setPanel(""); } }, 3200);
  }, []);
  useEffect(() => { poke(); }, [poke]);

  const seekTo = useCallback((t: number) => {
    if (!plan || plan.live || plan.channel) return;
    t = Math.max(0, Math.min(t, (duration || t) - 1));
    const v = video.current!;
    if (plan.mode === "direct") v.currentTime = t;
    else if (t >= offset && v.buffered.length && t - offset <= v.buffered.end(v.buffered.length - 1)) v.currentTime = t - offset;
    else void start(plan, t);
    setNow(t);
    poke();
  }, [plan, offset, duration, start, poke]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
    poke();
  }, [poke]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  const leave = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    back(plan?.live || plan?.channel ? "/live" : itemPath(id));
  }, [plan, id]);

  const playNext = useCallback(() => {
    if (plan?.next) {
      report(true, true);
      go(`/play/${encodeURIComponent(plan.next)}?from=start`, true);
    }
  }, [plan, report]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const v = video.current;
      if (!v) return;
      switch (e.key) {
        case " ": case "k": e.preventDefault(); toggle(); break;
        case "ArrowLeft": e.preventDefault(); seekTo(position() - 10); break;
        case "ArrowRight": e.preventDefault(); seekTo(position() + 10); break;
        case "ArrowUp": e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); poke(); break;
        case "ArrowDown": e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); poke(); break;
        case "f": toggleFull(); break;
        case "m": v.muted = !v.muted; setMuted(v.muted); break;
        case "Escape": if (!document.fullscreenElement) { if (panel) setPanel(""); else leave(); } break;
        case "Backspace": leave(); break;
        default: poke();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [toggle, seekTo, toggleFull, leave, poke, panel, offset]);

  // why the stream stopped, in the server's words
  const reason = async (): Promise<string> => {
    const tok = plan?.url.match(/\/api\/stream\/([^?]+)/)?.[1];
    if (!tok) return "";
    return (await api<{ error: string }>(`/api/stream-error/${tok}`).catch(() => ({ error: "" }))).error;
  };

  const failed = async (what: "error" | "ended") => {
    const p = plan;
    if (!p) return;
    // the browser couldn't play the file as it is: let the server convert it
    if (what === "error" && p.mode === "direct" && !triedStream.current) {
      triedStream.current = true;
      void load({ at: position(), forceStream: true });
      return;
    }
    const why = await reason();
    // a live channel that drops: connect again, a few times
    if (p.live && tries.current < RETRIES) {
      tries.current++;
      setReconnecting(tries.current);
      window.setTimeout(() => void start(p, 0), 1200);
      return;
    }
    setReconnecting(0);
    setWaiting(false);
    const shortly = Date.now() - startedAt.current < 15000;
    setProblem(why ? `"${p.title}" stopped: ${why}.`
      : p.live ? `${p.title} stopped and didn't come back after ${RETRIES} tries.${shortly ? " The stream ended right after it started, which usually means the channel's source refused the server." : ""}`
      : p.mode === "direct" ? `"${p.title}" couldn't be played in this browser.` : `The server couldn't make a stream of "${p.title}".`);
  };

  const onEnded = () => {
    if (!plan) return;
    // a channel: the next programme
    if (plan.channel) {
      void load({ nextProgramme: true });
      return;
    }
    if (plan.live) {
      void failed("ended");
      return;
    }
    // a stream that ends long before the film does stopped for a reason
    if (duration && position() < duration - 30) {
      void failed("ended");
      return;
    }
    report(true, true);
    if (plan.next) playNext();
    else leave();
  };

  // covered: when the programme ends, see whether the next one is alright
  const lockedUntil = plan?.locked ? plan.channel?.programme.end ?? 0 : 0;
  useEffect(() => {
    if (!lockedUntil) return;
    const t = window.setTimeout(() => void load(), Math.max(1000, lockedUntil * 1000 - Date.now() + 800));
    return () => clearTimeout(t);
  }, [lockedUntil, load]);
  // a wrong PIN shows as a problem; Try again covers it again
  const unlock = async () => {
    const pin = await ui.pin("A PIN to watch this", "The PIN of someone who may watch it.");
    if (pin !== null) await load({ pin });
  };
  const chan = plan?.channel;
  const hm = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const cue = cues.find((c) => now >= c.start && now <= c.end + 0.05);
  const left = duration ? Math.min(1, now / duration) : 0;
  const nearEnd = plan && !plan.live && plan.next && duration > 0 && duration - now < 40;
  const inIntro = plan?.intro && now >= plan.intro.start && now < plan.intro.end - 1;

  useEffect(() => {
    if (inIntro && plan?.intro?.auto) seekTo(plan.intro.end);
  }, [inIntro]);

  return (
    <div ref={box} className={`player${osd || paused || problem ? " osd" : ""}`} onMouseMove={poke} onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "VIDEO") toggle(); }}>
      <video
        ref={video}
        playsInline
        onDoubleClick={toggleFull}
        onTimeUpdate={() => {
          setNow(position());
          if (video.current && video.current.currentTime > 2) {
            tries.current = 0;
            setReconnecting(0);
          }
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => { setWaiting(false); setPaused(false); }}
        onPause={() => { setPaused(true); report(); }}
        onPlay={() => setPaused(false)}
        onEnded={onEnded}
        onError={() => void failed("error")}
      />
      {cue && <div className={`subs${osd ? " up" : ""}`}>{cue.text.split("\n").map((l, i) => <span key={i}>{l}</span>)}</div>}
      {(waiting && !problem) && <div className="spinner" aria-label="Loading" />}
      {reconnecting > 0 && !problem && <div className="note">Connecting again ({reconnecting} of {RETRIES})…</div>}

      {plan?.locked && chan && !problem && (
        <div className="problem locked" role="alert">
          <h2>{chan.name}: for older viewers</h2>
          <p>What's on now until {hm(chan.programme.end)} is above your age limit.{chan.next ? ` Next at ${hm(chan.next.start)}: ${chan.next.title}.` : ""}</p>
          <div className="buttons center">
            <button className="btn" onClick={leave}>Back</button>
            <button className="btn primary" autoFocus onClick={() => void unlock()}>Type a PIN</button>
          </div>
        </div>
      )}

      {problem && (
        <div className="problem" role="alert">
          <h2>Couldn't play this</h2>
          <p className="pre">{problem}</p>
          <div className="buttons center">
            <button className="btn" onClick={leave}>Back</button>
            <button className="btn primary" autoFocus onClick={() => { tries.current = 0; triedStream.current = false; void load({ at: plan && !plan.live ? position() : undefined }); }}><RotateCcw size={18} />Try again</button>
          </div>
        </div>
      )}

      <div className="osd-top">
        <button className="icon" onClick={leave} aria-label="Back"><ArrowLeft size={26} /></button>
        <div className="osd-title">
          <strong>{plan?.title ?? ""}</strong>
          {plan?.subtitle && <span>{plan.subtitle}</span>}
        </div>
        {(plan?.live || chan) && <span className="live-tag">LIVE</span>}
      </div>

      {inIntro && !plan?.intro?.auto && <button className="btn skip" onClick={() => seekTo(plan!.intro!.end)}>Skip intro</button>}
      {nearEnd && <button className="btn skip" onClick={playNext}><SkipForward size={18} />Next episode</button>}

      {!plan?.locked && <div className="osd-bottom" onClick={(e) => e.stopPropagation()}>
        {chan && !plan?.locked && (
          <div className="chan-now">
            <div className="seek-track"><i style={{ width: `${Math.min(100, Math.max(0, ((Date.now() / 1000 - chan.programme.start) / (chan.programme.end - chan.programme.start)) * 100))}%` }} /></div>
            <span className="osd-time">{chan.name} · until {hm(chan.programme.end)}{chan.next ? ` · Next: ${chan.next.title} at ${hm(chan.next.start)}` : ""}</span>
          </div>
        )}
        {plan && !plan.live && !chan && (
          <div
            className="seek"
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover({ x: e.clientX - r.left, t: ((e.clientX - r.left) / r.width) * duration });
            }}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seekTo(((e.clientX - r.left) / r.width) * duration);
            }}
          >
            <div className="seek-track"><i style={{ width: `${left * 100}%` }} /></div>
            {hover && <span className="seek-hover" style={{ left: hover.x }}>{time(hover.t)}</span>}
          </div>
        )}
        <div className="osd-row">
          <button className="icon" onClick={toggle} aria-label={paused ? "Play" : "Pause"}>{paused ? <Play size={26} fill="currentColor" /> : <Pause size={26} fill="currentColor" />}</button>
          {plan && !plan.live && !chan && <span className="osd-time">{time(now)} / {time(duration)}</span>}
          <span className="grow" />
          <button className="icon" onClick={() => { const v = video.current!; v.muted = !v.muted; setMuted(v.muted); }} aria-label={muted ? "Sound on" : "Mute"}>{muted ? <VolumeX size={22} /> : <Volume2 size={22} />}</button>
          {plan && plan.audio.length > 1 && <button className={`icon${panel === "audio" ? " on" : ""}`} onClick={() => setPanel(panel === "audio" ? "" : "audio")} aria-label="Sound track"><AudioLines size={22} /></button>}
          {plan && plan.subs.length > 0 && <button className={`icon${panel === "subs" ? " on" : ""}`} onClick={() => setPanel(panel === "subs" ? "" : "subs")} aria-label="Subtitles"><Captions size={22} /></button>}
          <button className="icon" onClick={toggleFull} aria-label={full ? "Leave full screen" : "Full screen"}>{full ? <Minimize size={22} /> : <Maximize size={22} />}</button>
        </div>
        {panel && plan && (
          <div className="osd-panel" role="menu">
            {panel === "audio" && plan.audio.map((a) => (
              <button key={a.id} className={`menu-item${String(plan.audioIndex) === a.id ? " on" : ""}`} onClick={() => { setPanel(""); void load({ audio: Number(a.id), at: position() }); }}>{a.label}</button>
            ))}
            {panel === "subs" && (
              <>
                <button className={`menu-item${!subId ? " on" : ""}`} onClick={() => { setSubId(""); setPanel(""); }}>Off</button>
                {plan.subs.map((s) => (
                  <button key={s.id} className={`menu-item${subId === s.id ? " on" : ""}`} onClick={() => {
                    setPanel("");
                    if (s.burn) void load({ burn: Number(s.id.slice(1)), at: position() });
                    else setSubId(s.id);
                  }}>{s.label}</button>
                ))}
              </>
            )}
          </div>
        )}
      </div>}
    </div>
  );
}
