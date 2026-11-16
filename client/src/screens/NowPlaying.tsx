// Now playing (the NowPlaying artboard): the cover, the song, the controls, and what's up next.
// The music keeps playing when you go back; the bar on Music brings you here again.
import { ChevronLeft, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { pic } from "../api.ts";
import { rem } from "../cards.tsx";
import { F, G, useFocusOnMount } from "../focus.tsx";
import { useNav } from "../nav.tsx";
import * as music from "../music.ts";
import { Clock, Status, fmtTime } from "./common.tsx";

export function NowPlaying() {
  const nav = useNav();
  const m = music.useMusic();
  useFocusOnMount("np-play", []);
  const s = m.queue[m.pos];
  if (!s) {
    return (
      <div className="page">
        <F fk="np-back" className="back" onEnter={() => nav.back()}><ChevronLeft />Music</F>
        <Status text="Nothing is playing." />
      </div>
    );
  }
  const frac = m.duration ? Math.min(1, m.time / m.duration) : 0;
  return (
    <div className="page nowplaying">
      <div className="top">
        <F fk="np-back" className="back" onEnter={() => nav.back()}><ChevronLeft />Music</F>
        <span className="fill" />
        <Clock />
      </div>
      <div className="np">
        <div className="np-cover">{s.cover && <img src={pic(s.cover, rem(22))} alt="" />}</div>
        <div className="np-main">
          <small>Now playing · song {m.pos + 1} of {m.queue.length}</small>
          <h1>{s.title}</h1>
          <p className="np-artist">{s.artist}</p>
          <p className="np-album">{[s.album, s.year].filter(Boolean).join(" · ")}</p>
          <div className="np-bar"><i style={{ width: `${frac * 100}%` }} /></div>
          <div className="np-times"><span>{fmtTime(m.time)}</span><span>{m.duration ? fmtTime(m.duration) : ""}</span></div>
          <G fk="np-ctl" className="np-ctl">
            <F fk="np-shuffle" className={"npb small" + (m.shuffle ? " on" : "")} onEnter={() => music.setShuffle(!m.shuffle)} title="Shuffle"><Shuffle /></F>
            <F fk="np-prev" className="npb" onEnter={music.prev} title="Previous"><SkipBack /></F>
            <F fk="np-play" className="npb big" onEnter={music.toggle} title={m.playing ? "Pause" : "Play"}>{m.playing ? <Pause /> : <Play />}</F>
            <F fk="np-next" className="npb" onEnter={music.next} title="Next"><SkipForward /></F>
            <F fk="np-repeat" className={"npb small" + (m.repeat ? " on" : "")} onEnter={() => music.setRepeat(!m.repeat)} title="Repeat"><Repeat /></F>
          </G>
          {m.error && <p className="status">{m.error}</p>}
        </div>
        <div className="np-next">
          <h2>Up next</h2>
          <G fk="np-queue" className="np-queue">
            {m.queue.slice(m.pos, m.pos + 8).map((q, i) => (
              <F key={q.id + i} fk={`np-q-${m.pos + i}`} className={"np-q" + (i === 0 ? " on" : "")} onEnter={() => music.jumpTo(m.pos + i)}>
                <span className="grow">{m.pos + i + 1}. {q.title}</span>
                <span>{q.duration ? fmtTime(q.duration) : ""}</span>
              </F>
            ))}
          </G>
        </div>
      </div>
    </div>
  );
}

/** The bar along the bottom of Music while a song plays (the Music artboard): OK opens Now playing. */
export function MusicBar() {
  const nav = useNav();
  const m = music.useMusic();
  const s = m.queue[m.pos];
  if (!s) return null;
  const frac = m.duration ? Math.min(1, m.time / m.duration) : 0;
  return (
    <G fk="musicbar" className="musicbar">
      <F fk="mb-open" className="mb-song" onEnter={() => nav.push("nowplaying")}>
        <span className="mb-cover">{s.cover && <img src={pic(s.cover, rem(3.2))} alt="" />}</span>
        <span className="mb-text"><b>{s.title}</b><small>{[s.artist, s.album].filter(Boolean).join(" · ")}</small></span>
      </F>
      <span className="mb-time">{fmtTime(m.time)}</span>
      <div className="mb-bar"><i style={{ width: `${frac * 100}%` }} /></div>
      <span className="mb-time">{m.duration ? fmtTime(m.duration) : ""}</span>
      <F fk="mb-play" className="npb small" onEnter={music.toggle} title={m.playing ? "Pause" : "Play"}>{m.playing ? <Pause /> : <Play />}</F>
    </G>
  );
}
