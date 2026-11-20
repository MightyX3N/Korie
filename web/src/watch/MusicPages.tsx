// Music: albums, artists, genres, songs and playlists; the bar at the bottom and Now playing.
import { ListMusic, Pause, Play, Plus, Radio, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, X } from "lucide-react";
import { api, pic } from "../api";
import { follow, go, href, type Route } from "../router";
import { ui, useData } from "../ui";
import type { Card } from "../types";
import { Grid, Loading, Status } from "./Cards";
import { music, useMusic } from "./music";
import { time } from "./ItemPage";

const TABS: [string, string][] = [["albums", "Albums"], ["artists", "Artists"], ["genres", "Genres"], ["songs", "Songs"], ["playlists", "Playlists"]];

export function MusicPage({ route }: { route: Route }) {
  const artist = route.query.get("artist") ?? "";
  const genre = route.query.get("genre") ?? "";
  const by = artist || genre ? "albums" : route.query.get("by") ?? "albums";
  const sort = route.query.get("sort") ?? "added";
  const q = new URLSearchParams({ by, sort });
  if (artist) q.set("artist", artist);
  if (genre) q.set("genre", genre);
  const { data, error, reload } = useData(() => api<{ items: Card[]; status: string; counts: { albums: number; artists: number } }>(`/api/music?${q}`), [q.toString()], ["library", "playlists"]);
  const newPlaylist = async () => {
    const name = await ui.prompt("New playlist", "Name");
    if (!name?.trim()) return;
    await ui.attempt("Couldn't make the playlist", () => api("/api/playlists", { name: name.trim() }));
    reload();
  };
  const songs = by === "songs";
  return (
    <div className="page">
      <header className="page-head">
        <h1>{artist || genre || "Music"}</h1>
        {!artist && !genre ? (
          <div className="chips" role="tablist">
            {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={by === id} className={`chip${by === id ? " on" : ""}`} onClick={() => go(id === "albums" ? "/music" : `/music?by=${id}`, true)}>{label}</button>)}
          </div>
        ) : (
          <a className="chip" href={href("/music")} onClick={(e) => follow(e, "/music")}>All music</a>
        )}
      </header>
      <div className="tools">
        {by === "albums" && !artist && !genre && (
          <label className="select"><span>Sort</span>
            <select value={sort} onChange={(e) => go(`/music${e.target.value === "added" ? "" : "?sort=" + e.target.value}`, true)}>
              <option value="added">Newest</option><option value="title">A–Z</option><option value="artist">Artist</option><option value="year">Year</option>
            </select>
          </label>
        )}
        {by === "playlists" && <button className="btn" onClick={() => void newPlaylist()}><Plus size={18} />New playlist</button>}
        {songs && data?.items.length ? (
          <>
            <button className="btn primary" onClick={() => music.playTracks(data.items.map(toTrack), 0, false)}><Play size={18} fill="currentColor" />Play all</button>
            <button className="btn" onClick={() => music.playTracks(data.items.map(toTrack), 0, true)}><Shuffle size={18} />Shuffle</button>
          </>
        ) : null}
        {data && <span className="soft count">{data.items.length} {data.items.length === 1 ? { albums: "album", artists: "artist", genres: "genre", songs: "song", playlists: "playlist" }[by] : by}</span>}
      </div>
      <Status error={error} text={data?.status} />
      {!data && !error && <Loading />}
      {data && songs && <SongList items={data.items} />}
      {data && !songs && <Grid items={data.items} shape="square" onChanged={reload} />}
    </div>
  );
}

function toTrack(c: Card) {
  return { id: c.id, n: c.n ?? 0, title: c.title, artist: c.subtitle, duration: c.length ?? 0, poster: c.poster, albumTitle: "" };
}

function SongList({ items }: { items: Card[] }) {
  const m = useMusic();
  const tracks = items.map(toTrack);
  const current = m.queue[m.index]?.id;
  return (
    <ol className="tracks">
      {items.map((c, i) => (
        <li key={c.id} className={`track${current === c.id ? " now" : ""}`}>
          <button className="track-main" onClick={() => music.playTracks(tracks, i, false)}>
            {c.poster ? <img className="track-pic" src={pic(c.poster, 80)} alt="" loading="lazy" /> : <span className="track-pic" />}
            <span className="track-title">{c.title}<small>{c.subtitle}</small></span>
            <span className="track-len">{c.length ? time(c.length) : ""}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function MusicBar() {
  const m = useMusic();
  const t = m.queue[m.index];
  if (!t) return null;
  return (
    <div className="musicbar">
      {!t.live && <div className="musicbar-progress"><i style={{ width: `${m.duration ? (m.time / m.duration) * 100 : 0}%` }} /></div>}
      <a className="musicbar-what" href={href("/nowplaying")} onClick={(e) => follow(e, "/nowplaying")}>
        {t.poster ? <img src={pic(t.poster, 96)} alt="" /> : <span className="track-pic">{t.live && <Radio size={22} />}</span>}
        <span><strong>{t.title}</strong><small>{t.live ? <><span className="live-tag">Live</span> {t.artist}</> : t.artist}</small></span>
      </a>
      <div className="musicbar-buttons">
        {!t.live && <button className="icon" onClick={() => void music.prev()} aria-label="Previous"><SkipBack size={20} fill="currentColor" /></button>}
        <button className="icon big" onClick={() => music.toggle()} aria-label={m.playing ? "Pause" : "Play"}>{m.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button>
        {!t.live && <button className="icon" onClick={() => void music.next()} aria-label="Next"><SkipForward size={20} fill="currentColor" /></button>}
        <a className="icon" href={href("/nowplaying")} onClick={(e) => follow(e, "/nowplaying")} aria-label="Now playing"><ListMusic size={20} /></a>
        <button className="icon" onClick={() => music.stop()} aria-label="Stop the music"><X size={20} /></button>
      </div>
    </div>
  );
}

export function NowPlaying() {
  const m = useMusic();
  const t = m.queue[m.index];
  if (!t) return <div className="page"><h1>Now playing</h1><p className="status">Nothing is playing. Pick an album or a song in Music.</p></div>;
  return (
    <div className="page nowplaying">
      <div className="np-main">
        {t.poster ? <img className="np-cover" src={pic(t.poster, 600)} alt="" /> : <span className="np-cover np-cover-icon">{t.live && <Radio size={96} />}</span>}
        <div className="np-info">
          <h1>{t.title}</h1>
          <p className="soft">{t.live ? <><span className="live-tag">Live</span> {[t.artist, t.albumTitle].filter(Boolean).join(" · ")}</> : [t.artist, t.albumTitle].filter(Boolean).join(" · ")}</p>
          {t.live ? (
            <div className="np-buttons">
              <button className="icon huge" onClick={() => music.toggle()} aria-label={m.playing ? "Pause" : "Play"}>{m.playing ? <Pause size={34} fill="currentColor" /> : <Play size={34} fill="currentColor" />}</button>
              <button className="icon" onClick={() => music.stop()} aria-label="Stop"><X size={26} /></button>
            </div>
          ) : <>
          <div className="seek np-seek" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); music.seek(((e.clientX - r.left) / r.width) * m.duration); }}>
            <div className="seek-track"><i style={{ width: `${m.duration ? (m.time / m.duration) * 100 : 0}%` }} /></div>
          </div>
          <p className="soft small">{time(m.time)} / {time(m.duration)}</p>
          <div className="np-buttons">
            <button className={`icon${m.shuffle ? " on" : ""}`} onClick={() => music.setShuffle(!m.shuffle)} aria-pressed={m.shuffle} aria-label="Shuffle"><Shuffle size={22} /></button>
            <button className="icon" onClick={() => void music.prev()} aria-label="Previous"><SkipBack size={26} fill="currentColor" /></button>
            <button className="icon huge" onClick={() => music.toggle()} aria-label={m.playing ? "Pause" : "Play"}>{m.playing ? <Pause size={34} fill="currentColor" /> : <Play size={34} fill="currentColor" />}</button>
            <button className="icon" onClick={() => void music.next()} aria-label="Next"><SkipForward size={26} fill="currentColor" /></button>
            <button className={`icon${m.repeat !== "off" ? " on" : ""}`} onClick={() => music.cycleRepeat()} aria-label={`Repeat: ${m.repeat}`}>{m.repeat === "one" ? <Repeat1 size={22} /> : <Repeat size={22} />}</button>
          </div>
          </>}
        </div>
      </div>
      {!t.live && <h2 className="row-title">Up next</h2>}
      {!t.live && <ol className="tracks">
        {m.queue.map((q, i) => (
          <li key={q.id + i} className={`track${i === m.index ? " now" : ""}`}>
            <button className="track-main" onClick={() => music.jump(i)}>
              <span className="track-n">{i + 1}</span>
              <span className="track-title">{q.title}<small>{q.artist}</small></span>
              <span className="track-len">{q.duration ? time(q.duration) : ""}</span>
            </button>
          </li>
        ))}
      </ol>}
    </div>
  );
}
