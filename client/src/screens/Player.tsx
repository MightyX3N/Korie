// The player. The server says how something plays: as it is (the browser
// seeks itself), or as a stream it makes as it goes (seeking asks for a new
// stream from that point). Subtitles are drawn here, so they look the same
// everywhere. OK pauses, left/right jump, up/down show the controls, Back leaves.
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw, Subtitles, SkipForward, SkipBack, Check } from "lucide-react";
import { api, caps, pic } from "../api.ts";
import { F, G, setFocus, getCurrentFocusKey } from "../focus.tsx";
import { useBackHandler, useNav } from "../nav.tsx";
import { useUI } from "../ui.tsx";
import { fmtTime } from "./common.tsx";
import { android, desktopApp } from "../host.ts";

interface Track { id: string; label: string; lang: string; isDefault: boolean; url?: string; burn?: boolean }
interface Plan {
  mode: "direct" | "stream"; url: string; duration: number; live: boolean; seekable: boolean; audio: Track[]; audioIndex: number | null;
  subs: Track[]; why: string; id: string; title: string; subtitle: string; resume: number; next: string | null; web?: string;
}
interface Cue { start: number; end: number; text: string }

function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const t = (s: string) => {
    const p = s.trim().split(":").map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const body = lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    if (body) cues.push({ start: t(a), end: t(b.trim().split(/\s/)[0]), text: body });
  }
  return cues;
}

export function Player({ id: firstId, mode, album, index, shuffle }: { id: string; mode: string; album?: string; index?: number; shuffle?: boolean }) {
  const nav = useNav();
  const ui = useUI();
  const video = useRef<HTMLVideoElement>(null);
  const [id, setId] = useState(firstId);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [offset, setOffset] = useState(0); // where the stream started (stream mode)
  const [now, setNow] = useState(0);
  const [paused, setPaused] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [osd, setOsd] = useState(true);
  const [panel, setPanel] = useState(false);
  const [subId, setSubId] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [cover, setCover] = useState("");
  const [queue, setQueue] = useState<string[]>([]);
  const [pos, setPos] = useState(index ?? 0);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const idle = useRef(0);
  const lastSave = useRef(0);
  const triedStream = useRef(false);
  const planRef = useRef<Plan | null>(null);
  planRef.current = plan;
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  const lastTime = useRef(0);
  const time = () => {
    if (video.current) lastTime.current = offsetRef.current + video.current.currentTime;
    return lastTime.current;
  };
  const duration = plan?.duration || (video.current && isFinite(video.current.duration) ? offset + video.current.duration : 0);

  const save = useCallback((ended = false) => {
    const p = planRef.current;
    if (!p || p.live) return;
    const position = time();
    if (!video.current?.currentTime && !lastTime.current) return;
    if (!ended && position < 5) return;
    void api("/api/progress", { id: p.id, position, duration: p.duration || position, ended }).catch(() => {});
  }, []);

  // the album's tracks, in order or shuffled
  useEffect(() => {
    if (!album) return;
    api<{ tracks: { id: string }[]; poster: string }>(`/api/item?id=${encodeURIComponent(album)}`).then((a) => {
      let ids = a.tracks.map((t) => t.id);
      if (shuffle) ids = ids.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
      setQueue(ids);
      setCover(a.poster);
      if (shuffle) {
        setPos(0);
        setId(ids[0]);
      }
    }).catch(() => {});
  }, [album, shuffle]);

  const start = useCallback(async (p: Plan, at: number) => {
    const v = video.current;
    if (!v) return;
    setWaiting(true);
    let s = Math.max(0, at);
    if (p.mode === "direct") {
      setOffset(0);
      v.src = p.url;
      v.currentTime = s;
    } else {
      if (s > 0 && !p.live) {
        // a copied stream starts at the key frame before s: ask where that is
        const m = p.url.match(/\/api\/stream\/([^?]+)\?(.*)$/);
        const vq = new URLSearchParams(m?.[2] ?? "").get("v");
        if (m) s = (await api<{ start: number }>(`/api/seek/${m[1]}?t=${s}&v=${vq}`).catch(() => ({ start: s }))).start;
      }
      setOffset(s);
      v.src = p.url + (s > 0 ? `&start=${s.toFixed(3)}` : "");
    }
    v.play().catch(() => {});
  }, []);

  const load = useCallback(async (opts: { audio?: number | null; burn?: number | null; at?: number; forceStream?: boolean } = {}) => {
    setWaiting(true);
    let p: Plan;
    try {
      p = await api<Plan>("/api/play", { id, caps: opts.forceStream ? "v:h264;a:aac;c:none" : caps(), audio: opts.audio ?? null, burn: opts.burn ?? null });
    } catch (e: any) {
      await ui.message("Couldn't play this", e.message);
      nav.back();
      return;
    }
    if (p.web) {
      // a game: its own web player (RomM). Korie's apps open it on its own screen; Back returns.
      if ((window.KorieAndroid as any)?.openWeb) {
        (window.KorieAndroid as any).openWeb(p.web);
        nav.back();
      } else if (desktopApp) {
        // Korie's desktop app: the game in this window; Esc comes back here (to Games)
        try { sessionStorage.setItem("korie.section", nav.stack[0].name); } catch { /* fine */ }
        location.href = p.web;
      } else {
        window.open(p.web, "_blank");
        nav.back();
      }
      return;
    }
    setPlan(p);
    const at = opts.at ?? (mode === "resume" && p.resume > 30 ? p.resume : 0);
    if (opts.audio === undefined && opts.burn === undefined) {
      const def = p.subs.find((s) => s.isDefault && !s.burn);
      setSubId(def ? def.id : null);
    }
    await start(p, at);
  }, [id, mode, nav, start, ui]);

  useEffect(() => {
    triedStream.current = false;
    void load();
    return () => save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // subtitles: fetched as text and drawn here
  useEffect(() => {
    const s = plan?.subs.find((x) => x.id === subId);
    if (!s?.url) {
      setCues([]);
      return;
    }
    fetch(s.url).then((r) => r.text()).then((t) => setCues(parseVtt(t))).catch(() => setCues([]));
  }, [subId, plan]);

  // time, progress and hiding the controls
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(time());
      if (!video.current?.paused && Date.now() - idle.current > 4500 && !panel) setOsd(false);
      if (Date.now() - lastSave.current > 10000) {
        lastSave.current = Date.now();
        save();
      }
    }, 250);
    return () => clearInterval(t);
  }, [panel, save]);

  const poke = () => {
    idle.current = Date.now();
    setOsd(true);
  };

  const seekTo = useCallback(async (t: number) => {
    const p = planRef.current;
    const v = video.current;
    if (!p || !v || p.live) return;
    const target = Math.max(0, Math.min(t, (p.duration || Infinity) - 2));
    if (p.mode === "direct") v.currentTime = target;
    else await start(p, target);
    setNow(target);
  }, [start]);

  const jump = (d: number) => {
    poke();
    setPendingSeek((x) => {
      const base = x ?? time();
      return Math.max(0, base + d);
    });
  };

  // a jump settles for a moment before it's done, so pressing right five times is one seek
  useEffect(() => {
    if (pendingSeek === null) return;
    const t = window.setTimeout(() => {
      void seekTo(pendingSeek);
      setPendingSeek(null);
    }, 650);
    return () => clearTimeout(t);
  }, [pendingSeek, seekTo]);

  const togglePause = () => {
    const v = video.current;
    if (!v) return;
    poke();
    if (v.paused) void v.play();
    else v.pause();
  };

  const next = useCallback(() => {
    if (queue.length && pos + 1 < queue.length) {
      save(true);
      setPos(pos + 1);
      setId(queue[pos + 1]);
      return true;
    }
    if (planRef.current?.next) {
      save(true);
      setId(planRef.current.next);
      return true;
    }
    return false;
  }, [queue, pos, save]);

  const prev = () => {
    if (queue.length && pos > 0) {
      setPos(pos - 1);
      setId(queue[pos - 1]);
    } else void seekTo(0);
  };

  // keys while the controls are hidden: OK pauses, left/right jump, anything else shows them
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".overlay")) return;
      if (e.key === "MediaPlayPause" || e.key === " " ) {
        e.preventDefault();
        togglePause();
        return;
      }
      if (e.key === "MediaTrackNext") { next(); return; }
      if (e.key === "MediaTrackPrevious") { prev(); return; }
      if (e.key === "MediaFastForward") { jump(30); return; }
      if (e.key === "MediaRewind") { jump(-10); return; }
      if (osd) {
        idle.current = Date.now();
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "ArrowLeft") jump(-10);
        else if (e.key === "ArrowRight") jump(30);
        else if (e.key === "Enter") togglePause();
        else {
          poke();
          window.setTimeout(() => setFocus("pl-play"), 0);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useBackHandler(() => {
    if (panel) {
      setPanel(false);
      window.setTimeout(() => setFocus("pl-subs"), 0);
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (osd && !getCurrentFocusKey()?.startsWith("pl-")) window.setTimeout(() => setFocus("pl-play"), 0);
  }, [osd]);

  const onError = () => {
    const p = planRef.current;
    const err = video.current?.error;
    // the browser said it could play it but couldn't: let the server convert it
    if (p && p.mode === "direct" && !triedStream.current) {
      triedStream.current = true;
      void load({ at: time(), forceStream: true });
      return;
    }
    const tok = p?.url.match(/\/api\/stream\/([^?]+)/)?.[1];
    void (async () => {
      let why = "";
      if (tok) why = (await api<{ error: string }>(`/api/stream-error/${tok}`).catch(() => ({ error: "" }))).error;
      if (!why) why = p?.mode === "direct" ? "this device couldn't decode it" : "the server couldn't make a stream of it";
      await ui.message("Couldn't play this", `"${p?.title ?? ""}" stopped: ${why}.`);
      nav.back();
    })();
  };

  const sub = cues.find((c) => now >= c.start && now <= c.end + 0.05);
  const progress = duration ? Math.min(1, (pendingSeek ?? now) / duration) : 0;
  const audioOnly = /^t/.test(plan?.id ?? "") || (!!album);
  return (
    <div className="player" onMouseMove={poke} onClick={() => !osd && poke()}>
      <video
        ref={video}
        playsInline
        autoPlay
        onPlaying={() => { setWaiting(false); setPaused(false); }}
        onPause={() => { setPaused(true); poke(); }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => {
          save(true);
          if (!next()) nav.back();
        }}
        onError={onError}
      />
      {audioOnly && <div className="cover">{cover && <img src={pic(cover, 600)} alt="" />}</div>}
      {sub && <div className={"subs" + (osd ? " up" : "")}><span>{sub.text}</span></div>}
      {waiting && <div className="center"><div className="spinner" /></div>}
      <div className={"osd" + (osd ? "" : " hidden")}>
        <div className="head">
          <h1>{plan?.title ?? ""}</h1>
          {plan?.subtitle && <small>{plan.subtitle}</small>}
        </div>
        <G fk="pl" className="foot" stop={["up", "down", "left", "right"]}>
          {!plan?.live && (
            <F fk="pl-seek" className="seek" onArrow={(d) => {
              if (d === "left") { jump(-10); return false; }
              if (d === "right") { jump(30); return false; }
              return true;
            }} onEnter={togglePause}>
              <span>{fmtTime(pendingSeek ?? now)}</span>
              <div className="track-bar"><i style={{ width: `${progress * 100}%` }} /><b style={{ left: `${progress * 100}%` }} /></div>
              <span>{duration ? fmtTime(duration) : ""}</span>
            </F>
          )}
          <G fk="pl-buttons" className="ctl">
            {queue.length > 0 && <F fk="pl-prev" className="btn icon" onEnter={prev}><SkipBack /></F>}
            {!plan?.live && <F fk="pl-back10" className="btn icon" onEnter={() => jump(-10)}><RotateCcw /></F>}
            <F fk="pl-play" className="btn icon" onEnter={togglePause}>{paused ? <Play /> : <Pause />}</F>
            {!plan?.live && <F fk="pl-fwd30" className="btn icon" onEnter={() => jump(30)}><RotateCw /></F>}
            {(plan?.next || (queue.length && pos + 1 < queue.length)) ? <F fk="pl-next" className="btn" onEnter={() => next()}><SkipForward />Next</F> : null}
            <span className="grow" />
            {plan && (plan.audio.length > 1 || plan.subs.length > 0) && (
              <F fk="pl-subs" className="btn" onEnter={() => { setPanel(true); window.setTimeout(() => setFocus("pl-panel"), 0); }}><Subtitles />Audio & subtitles</F>
            )}
          </G>
        </G>
      </div>
      {panel && plan && (
        <G fk="pl-panel" className="panel" stop={["up", "down", "left", "right"]}>
          {plan.audio.length > 1 && <h3>Audio</h3>}
          {plan.audio.length > 1 && plan.audio.map((a) => (
            <F key={a.id} fk={`pl-a-${a.id}`} className="item" onEnter={() => {
              setPanel(false);
              void load({ audio: Number(a.id), at: time() });
            }}>
              {Number(a.id) === plan.audioIndex ? <Check /> : <span style={{ width: "1.4rem" }} />}<div className="grow">{a.label}</div>
            </F>
          ))}
          <h3>Subtitles</h3>
          <F fk="pl-s-off" className="item" onEnter={() => { setSubId(null); setPanel(false); }}>
            {subId === null ? <Check /> : <span style={{ width: "1.4rem" }} />}<div className="grow">Off</div>
          </F>
          {plan.subs.map((s) => (
            <F key={s.id} fk={`pl-s-${s.id}`} className="item" onEnter={() => {
              setPanel(false);
              if (s.burn) void load({ audio: plan.audioIndex, burn: Number(s.id.slice(1)), at: time() });
              else setSubId(s.id);
            }}>
              {subId === s.id ? <Check /> : <span style={{ width: "1.4rem" }} />}<div className="grow">{s.label}</div>
            </F>
          ))}
        </G>
      )}
      {android && null}
    </div>
  );
}
