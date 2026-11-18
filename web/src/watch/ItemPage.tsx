// A film, series, episode, album or playlist: what it is, and play.
import { useEffect, useState } from "react";
import { Check, Heart, MoreHorizontal, Play, RotateCcw, Shuffle } from "lucide-react";
import { api, pic } from "../api";
import { back, follow, go, href, itemPath } from "../router";
import { ui, useData } from "../ui";
import type { Item, Me, Track } from "../types";
import { Loading, Status } from "./Cards";
import { addToPlaylist, cardMenu } from "./menus";
import { music, useMusic } from "./music";

export function time(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function minutes(m: number): string {
  if (!m) return "";
  const h = Math.floor(m / 60);
  return h ? `${h} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
}

export function ItemPage({ id, me, ep }: { id: string; me: Me; ep?: string }) {
  const { data: it, error, reload } = useData(() => api<Item>(`/api/item?id=${encodeURIComponent(id)}${ep ? "&series=1" : ""}`), [id], ["library", "browse", "playlists"]);
  const [season, setSeason] = useState(0);
  useEffect(() => {
    if (!it?.seasons?.length) return;
    // the season of the episode it was opened at (Continue watching), or with the next episode to watch
    const at = ep ? it.seasons.findIndex((s) => s.episodes.some((e) => e.id === ep)) : -1;
    const next = it.seasons.findIndex((s) => s.episodes.some((e) => !e.watched));
    setSeason(at >= 0 ? at : next >= 0 ? next : 0);
    if (ep) window.setTimeout(() => document.getElementById(`ep-${ep}`)?.scrollIntoView({ block: "center" }), 50);
  }, [it?.id, ep]);

  if (error) return <div className="page"><Status error={error} /><button className="btn" onClick={() => back()}>Back</button></div>;
  if (!it) return <div className="page"><Loading /></div>;

  const play = (pid: string, from?: "start") => go(`/play/${encodeURIComponent(pid)}${from ? "?from=start" : ""}`);
  const asCard = { id: it.id, kind: it.kind, title: it.title, subtitle: it.subtitle ?? "", year: it.year, poster: it.poster, thumb: it.thumb, backdrop: it.backdrop, progress: it.duration ? it.position / it.duration : 0, watched: it.watched, source: it.source, favourite: it.favourite, local: it.local };
  const meta = [it.year, minutes(it.runtime), it.rating ? `★ ${it.rating.toFixed(1)}` : "", it.cert, it.source && !it.local ? it.source : "", it.disc ? it.disc.toUpperCase() : ""].filter(Boolean);
  const isMusic = it.kind === "album" || it.kind === "playlist";

  // a series: the next episode to watch
  let next: { id: string; label: string } | null = null;
  if (it.seasons?.length) {
    // the episode it was opened at, or one half watched, comes first
    for (const s of it.seasons) {
      const e = s.episodes.find((x) => (ep ? x.id === ep : x.position > 0 && !x.watched));
      if (e && !next) next = { id: e.id, label: `${e.position > 0 ? "Resume" : "Play"} S${s.n} E${e.n}` };
    }
    for (const s of next ? [] : it.seasons) {
      const e = s.episodes.find((x) => !x.watched);
      if (e) {
        next = { id: e.id, label: `${e.position > 0 ? "Resume" : "Play"} S${s.n} E${e.n}` };
        break;
      }
    }
    if (!next) next = { id: it.seasons[0].episodes[0]?.id ?? "", label: "Play from the start" };
  }

  const toggleFav = async () => {
    await ui.attempt("Couldn't change it", () => api("/api/favourite", { id: it.id }));
    reload();
  };
  const toggleSeen = async () => {
    await ui.attempt("Couldn't change it", () => api("/api/watched", { id: it.id, watched: !it.watched }));
    reload();
  };

  return (
    <div className={`item${it.backdrop ? "" : " plain"}`}>
      {it.backdrop && <div className="item-back" style={{ backgroundImage: `url(${pic(it.backdrop, 1600)})` }} />}
      <div className="item-top">
        {(it.poster || it.thumb) && <img className={`item-poster${isMusic ? " square" : ""}`} src={pic(it.poster || it.thumb, 400)} alt="" />}
        <div className="item-info">
          {it.kind === "episode" && it.series && <a className="soft" href={href(itemPath(it.series))} onClick={(e) => follow(e, itemPath(it.series!))}>{it.seriesTitle} · S{it.season} E{it.episode}</a>}
          <h1>{it.title}</h1>
          {it.artist && <p className="item-artist">{it.artist}</p>}
          {meta.length > 0 && <p className="item-meta">{meta.join(" · ")}</p>}
          {it.genres?.length > 0 && <p className="item-genres">{it.genres.join(", ")}</p>}
          <div className="item-buttons">
            {(it.kind === "film" || it.kind === "episode" || it.kind === "live") && (
              <>
                <button className="btn primary big" onClick={() => play(it.id)}><Play size={20} fill="currentColor" />{it.position > 0 ? `Resume from ${time(it.position)}` : "Play"}</button>
                {it.position > 0 && <button className="btn big" onClick={() => play(it.id, "start")}><RotateCcw size={18} />From the start</button>}
              </>
            )}
            {next && next.id && <button className="btn primary big" onClick={() => play(next!.id)}><Play size={20} fill="currentColor" />{next.label}</button>}
            {isMusic && it.tracks?.length ? (
              <>
                <button className="btn primary big" onClick={() => void music.playItem(it.id, false)}><Play size={20} fill="currentColor" />Play</button>
                <button className="btn big" onClick={() => void music.playItem(it.id, true)}><Shuffle size={18} />Shuffle</button>
              </>
            ) : null}
            {["film", "series", "album", "live"].includes(it.kind) && (
              <button className={`btn round${it.favourite ? " on" : ""}`} onClick={() => void toggleFav()} aria-pressed={it.favourite} title={it.favourite ? "In your favourites" : "Add to favourites"}>
                <Heart size={18} fill={it.favourite ? "currentColor" : "none"} />
              </button>
            )}
            {["film", "series", "episode"].includes(it.kind) && (
              <button className={`btn round${it.watched ? " on" : ""}`} onClick={() => void toggleSeen()} aria-pressed={it.watched} title={it.watched ? "Watched" : "Mark as watched"}>
                <Check size={18} />
              </button>
            )}
            {it.kind !== "playlist" && (
              <button className="btn round" aria-label="More options" onClick={() => void cardMenu(asCard, reload)}><MoreHorizontal size={18} /></button>
            )}
            {it.kind === "playlist" && <PlaylistTools it={it} done={reload} />}
          </div>
          {it.error && <p className="bad">{it.error}</p>}
          {it.overview && <p className="item-overview">{it.overview}</p>}
          {it.director && <p className="soft">Directed by {it.director}</p>}
        </div>
      </div>

      {it.seasons && it.seasons.length > 0 && (
        <section className="seasons">
          {it.seasons.length > 1 && (
            <div className="chips" role="tablist">
              {it.seasons.map((s, i) => <button key={s.n} role="tab" aria-selected={i === season} className={`chip${i === season ? " on" : ""}`} onClick={() => setSeason(i)}>{s.title || `Season ${s.n}`}</button>)}
            </div>
          )}
          <ol className="episodes">
            {it.seasons[season]?.episodes.map((e) => (
              <li key={e.id} id={`ep-${e.id}`} className={`episode${e.id === ep ? " here" : ""}`}>
                <button className="episode-pic" onClick={() => play(e.id)} aria-label={`Play episode ${e.n}`}>
                  {e.thumb ? <img src={pic(e.thumb, 360)} alt="" loading="lazy" /> : <i className="episode-none">{e.n}</i>}
                  <i className="episode-play"><Play size={22} fill="currentColor" /></i>
                  {e.progress > 0 && !e.watched && <span className="card-bar"><i style={{ width: `${Math.round(e.progress * 100)}%` }} /></span>}
                </button>
                <div className="episode-text">
                  <h3>{e.n}. {e.title || `Episode ${e.n}`}{e.watched && <Check size={16} className="good" aria-label="watched" />}</h3>
                  <p className="soft small">{minutes(e.runtime)}</p>
                  {e.overview && <p className="episode-overview">{e.overview}</p>}
                </div>
                <button className="card-more static" aria-label={`Options for ${e.title}`} onClick={() => void cardMenu({ id: e.id, kind: "episode", title: e.title, subtitle: "", year: "", poster: "", thumb: e.thumb, backdrop: "", progress: e.progress, watched: e.watched, source: "", local: it.local }, reload)}>
                  <MoreHorizontal size={18} />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {it.tracks && it.tracks.length > 0 && <Tracks tracks={it.tracks.map((t) => ({ ...t, albumTitle: t.albumTitle || it.title, poster: t.poster || it.poster }))} playlist={it.kind === "playlist" ? it.id.slice(9) : undefined} done={reload} music={me.person.music} />}
      {isMusic && !it.tracks?.length && <p className="status">Nothing on it yet. Add songs and albums with their options menu (⋯).</p>}

      {it.cast?.length > 0 && (
        <section className="cast">
          <h2 className="row-title">Cast</h2>
          <div className="cast-list">
            {it.cast.map((c, i) => (
              <div key={i} className="cast-one">
                {c.photo ? <img src={pic(c.photo, 160)} alt="" loading="lazy" /> : <span className="cast-none">{c.name.slice(0, 1)}</span>}
                <strong>{c.name}</strong>
                <span className="soft small">{c.role}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Tracks({ tracks, playlist, done, music: mayMusic }: { tracks: Track[]; playlist?: string; done: () => void; music: boolean }) {
  const m = useMusic();
  const current = m.queue[m.index]?.id;
  return (
    <ol className="tracks">
      {tracks.map((t, i) => (
        <li key={t.id + i} className={`track${current === t.id ? " now" : ""}`}>
          <button className="track-main" onClick={() => music.playTracks(tracks, i, false)}>
            <span className="track-n">{current === t.id && m.playing ? <Play size={14} fill="currentColor" /> : t.n || i + 1}</span>
            <span className="track-title">{t.title}<small>{[t.artist, playlist ? t.albumTitle : ""].filter(Boolean).join(" · ")}</small></span>
            <span className="track-len">{t.duration ? time(t.duration) : ""}</span>
          </button>
          {mayMusic && (
            <button className="card-more static" aria-label={`Options for ${t.title}`} onClick={() => void ui.menu(t.title, [
              { label: "Play", run: () => music.playTracks(tracks, i, false) },
              { label: "Add to a playlist…", run: () => addToPlaylist(t.id) },
              ...(playlist ? [{ label: "Take off this playlist", run: async () => { await ui.attempt("Couldn't change the playlist", () => api(`/api/playlists/${playlist}`, { take: t.id })); done(); } }] : []),
            ])}><MoreHorizontal size={18} /></button>
          )}
        </li>
      ))}
    </ol>
  );
}

function PlaylistTools({ it, done }: { it: Item; done: () => void }) {
  const pid = it.id.slice(9);
  return (
    <button className="btn round" aria-label="Playlist options" onClick={() => void ui.menu(it.title, [
      {
        label: "Rename…",
        run: async () => {
          const n = await ui.prompt("Rename the playlist", "Name", it.title);
          if (!n?.trim()) return;
          await ui.attempt("Couldn't rename it", () => api(`/api/playlists/${pid}`, { name: n.trim() }));
          done();
        },
      },
      {
        label: "Delete the playlist…", danger: true,
        run: async () => {
          if (!(await ui.confirm(`Delete ${it.title}?`, "The songs stay in your music.", "Delete", true))) return;
          if (await ui.attempt("Couldn't delete it", () => api(`/api/playlists/${pid}`, undefined, "DELETE"))) go("/music?by=playlists", true);
        },
      },
    ])}><MoreHorizontal size={18} /></button>
  );
}
