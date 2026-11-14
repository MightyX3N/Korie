// A film, series, album or game: its page. It opens with Play focused.
import { useState } from "react";
import { ChevronLeft, Play, RotateCcw, Heart, Eye, EyeOff, Wand2, Shuffle } from "lucide-react";
import { api, pic } from "../api.ts";
import { F, G, useFocusOnMount } from "../focus.tsx";
import { useData } from "../data.ts";
import { useNav } from "../nav.tsx";
import { useUI } from "../ui.tsx";
import { rem } from "../cards.tsx";
import type { Me } from "../App.tsx";
import { Status, fixMatch, fmtRuntime, fmtTime } from "./common.tsx";

interface Ep { id: string; n: number; title: string; overview: string; runtime: number; thumb: string; progress: number; watched: boolean }
interface Details {
  id: string; kind: string; title: string; year: string; overview: string; genres: string[]; rating: number; runtime: number; director: string;
  cast: { name: string; role: string; photo: string }[]; poster: string; backdrop: string; thumb: string; favourite: boolean; source: string;
  local: boolean; position: number; duration: number; watched: boolean; subtitle?: string; error?: string;
  seasons?: { n: number; title: string; episodes: Ep[] }[]; artist?: string; tracks?: { id: string; n: number; title: string; artist: string; duration: number }[];
}

export function Item({ id, me }: { id: string; me: Me }) {
  const nav = useNav();
  const ui = useUI();
  const { data, error, reload } = useData<Details>(`/api/item?id=${encodeURIComponent(id)}`, ["library"]);
  const [season, setSeason] = useState<number | null>(null);
  useFocusOnMount(data ? "item-play" : null, [data !== null]);

  if (!data) return <div className="page"><F fk="item-back" className="back" onEnter={() => nav.back()}><ChevronLeft />Back</F><Status text={error || "Loading…"} /></div>;
  const d = data;
  const isSeries = d.kind === "series";
  const isAlbum = d.kind === "album";
  const seasons = d.seasons ?? [];
  const cur = seasons.find((s) => s.n === season) ?? seasons.find((s) => s.episodes.some((e) => !e.watched)) ?? seasons[0];
  const nextEp = isSeries ? seasons.flatMap((s) => s.episodes).find((e) => e.progress > 0) ?? seasons.flatMap((s) => s.episodes).find((e) => !e.watched) : undefined;
  const play = (mode: string, target = d.id, extra: Record<string, unknown> = {}) => nav.push("player", { id: target, mode, ...extra });
  const toggleFav = async () => {
    await api("/api/favourite", { id: d.id }).catch((e) => ui.toast(e.message));
    reload();
  };
  const toggleWatched = async () => {
    await api("/api/watched", { id: d.id, watched: !d.watched }).catch((e) => ui.toast(e.message));
    reload();
  };
  const meta = [d.year, fmtRuntime(d.runtime), d.genres.slice(0, 3).join(", "), d.subtitle && d.kind === "game" ? d.subtitle : "", d.director ? `Directed by ${d.director}` : "", d.artist ?? "", d.source ? `From ${d.source}` : ""].filter(Boolean);
  const canFix = d.local && (d.kind === "film" || isSeries) && me.person.canSettings;
  const firstLabel = isSeries ? (nextEp ? (nextEp.progress > 0 ? `Resume S${cur?.n}E${nextEp.n}` : `Play S${seasons.find((s) => s.episodes.includes(nextEp))?.n}E${nextEp.n}`) : "Play") : isAlbum ? "Play" : d.position > 30 ? `Resume from ${fmtTime(d.position)}` : "Play";

  return (
    <>
      <div className="hero">{(d.backdrop || d.poster) && <img src={pic(d.backdrop || d.poster, window.innerWidth)} alt="" />}</div>
      <div className="detail">
        <G fk="item-top">
          <F fk="item-back" className="back" onEnter={() => nav.back()}><ChevronLeft />Back</F>
          <div className="dtop">
            <div className={"poster" + (isAlbum ? " square" : "")}>{d.poster && <img src={pic(d.poster, rem(15))} alt="" />}</div>
            <div className="dinfo">
              <h1>{d.title}</h1>
              <div className="meta">
                {meta.map((m) => <span key={m}>{m}</span>)}
                {d.rating > 0 && <span className="rate">★ {d.rating.toFixed(1)}</span>}
              </div>
              <G fk="item-actions" className="actions">
                <F fk="item-play" className="btn primary" onEnter={() => {
                  if (isSeries) {
                    if (nextEp) play("resume", nextEp.id);
                  } else if (isAlbum) {
                    if (d.tracks?.length) play("start", d.tracks[0].id, { album: d.id, index: 0 });
                  } else play("resume");
                }}><Play />{firstLabel}</F>
                {!isSeries && !isAlbum && d.position > 30 && <F fk="item-start" className="btn" onEnter={() => play("start")}><RotateCcw />From the start</F>}
                {isAlbum && <F fk="item-shuffle" className="btn" onEnter={() => d.tracks?.length && play("start", d.tracks[0].id, { album: d.id, index: 0, shuffle: true })}><Shuffle />Shuffle</F>}
                {d.kind !== "game" && <F fk="item-fav" className="btn icon" onEnter={toggleFav} title="Favourite"><Heart fill={d.favourite ? "currentColor" : "none"} /></F>}
                {!isAlbum && d.kind !== "game" && <F fk="item-watched" className="btn icon" onEnter={toggleWatched} title={d.watched ? "Mark as not watched" : "Mark as watched"}>{d.watched ? <EyeOff /> : <Eye />}</F>}
                {canFix && <F fk="item-fix" className="btn icon" onEnter={async () => { await fixMatch(d.id, d.title, ui); reload(); }} title="Fix details"><Wand2 /></F>}
              </G>
              {d.overview && <p className="overview">{d.overview}</p>}
              {d.error && <p className="status">{d.error}</p>}
              {!d.local && d.kind === "film" && !d.overview && !d.error && <p className="status"> </p>}
            </div>
          </div>
        </G>
        {isSeries && seasons.length > 0 && (
          <div className="seasons">
            {seasons.length > 1 && (
              <G fk="item-seasons" className="pills">
                {seasons.map((s) => (
                  <F key={s.n} fk={`season-${s.n}`} className={"pill" + (s === cur ? " on" : "")} onEnter={() => setSeason(s.n)} onFocus={() => setSeason(s.n)}>{s.title}</F>
                ))}
              </G>
            )}
            <G fk={`eps-${cur?.n}`} className="episodes">
              {cur?.episodes.map((e) => (
                <F key={e.id} fk={`ep-${e.id}`} className="ep" onEnter={() => play("resume", e.id)}>
                  <div className="pic">
                    {e.thumb && <img src={pic(e.thumb, rem(12))} alt="" loading="lazy" />}
                    {e.progress > 0 && <div className="bar"><i style={{ width: `${e.progress * 100}%` }} /></div>}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="n">Episode {e.n}{e.runtime ? ` · ${fmtRuntime(e.runtime)}` : ""}{e.watched ? " · Watched" : ""}</div>
                    <div className="tt">{e.title}</div>
                    {e.overview && <div className="ov">{e.overview}</div>}
                  </div>
                </F>
              ))}
            </G>
          </div>
        )}
        {isSeries && !seasons.length && <Status text={d.error ? "" : d.local ? "No episodes found." : "Loading the episodes…"} />}
        {isAlbum && (
          <G fk="item-tracks" className="tracks">
            {d.tracks?.map((t, i) => (
              <F key={t.id} fk={`track-${t.id}`} className="track" onEnter={() => play("start", t.id, { album: d.id, index: i })}>
                <span className="n">{t.n || i + 1}</span>
                <span className="tt">{t.title}{t.artist && t.artist !== d.artist ? <small style={{ color: "var(--dim)" }}> · {t.artist}</small> : null}</span>
                <span className="d">{t.duration ? fmtTime(t.duration) : ""}</span>
              </F>
            ))}
          </G>
        )}
        {d.cast.length > 0 && (
          <div className="cast">
            {d.cast.slice(0, 8).map((c) => (
              <div key={c.name + c.role} className="person">
                <span className="face">{c.photo ? <img src={pic(c.photo, rem(2.4))} alt="" loading="lazy" /> : c.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                <span>{c.name}{c.role && <small>{c.role}</small>}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
