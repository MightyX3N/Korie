// Films, Series and Music: your own library as a grid (sort and filter), or an
// add-on's rows. The sources and the filters are one row of pills, so the
// remote moves straight from one to the next.
import { ArrowDownUp, Plus } from "lucide-react";
import { api, type Card, type Row } from "../api.ts";
import * as music from "../music.ts";
import { MusicBar } from "./NowPlaying.tsx";
import { F, G } from "../focus.tsx";
import { Grid, Pills, Rows } from "../cards.tsx";
import { useData } from "../data.ts";
import { useNav } from "../nav.tsx";
import { useUI } from "../ui.tsx";
import { Status, Top, fmtTime, useOpener } from "./common.tsx";

const SORTS = [["added", "Recently added"], ["title", "A–Z"], ["year", "Newest first"], ["rating", "Best rated"]] as const;
const SHOWS = [["all", "All"], ["unwatched", "Unwatched"], ["progress", "In progress"]] as const;

interface Section { sources: { id: string; name: string }[]; source: string; items?: Card[]; rows?: Row[]; status: string }

function LibraryScreen({ kind, title, source }: { kind: "films" | "series"; title: string; source: string }) {
  const nav = useNav();
  const ui = useUI();
  const sort = nav.top.params.sort ?? "added";
  const show = nav.top.params.show ?? "all";
  const { data } = useData<Section>(`/api/${kind}?source=${encodeURIComponent(source)}&sort=${sort}&show=${show}`, ["library", "browse"]);
  const { open, menu } = useOpener();
  const pickSort = async () => {
    const v = await ui.menu("Sort by", SORTS.map(([id, label]) => ({ label: (id === sort ? "✓ " : "") + label, value: id })));
    if (v) nav.replace({ sort: v });
  };
  const sources = data?.sources ?? [{ id: "", name: title === "Films" ? "Your films" : "Your series" }];
  return (
    <div className="page">
      <Top title={title} count={data?.items ? `${data.items.length} ${kind}` : undefined} />
      <G fk={`${kind}-pills`} className="pills">
        {sources.map((s) => (
          <F key={s.id || "-"} fk={`${kind}-src-${s.id || "-"}`} className={"pill" + (s.id === source ? " on" : "")} onEnter={() => nav.replace({ source: s.id })}>{s.name}</F>
        ))}
        {!source && <span className="sep" />}
        {!source && SHOWS.map(([id, label]) => (
          <F key={id} fk={`${kind}-show-${id}`} className={"pill" + (id === show ? " on" : "")} onEnter={() => nav.replace({ show: id })}>{label}</F>
        ))}
        {!source && (
          <F fk={`${kind}-sort`} className="pill" onEnter={pickSort}><ArrowDownUp />{SORTS.find((s) => s[0] === sort)?.[1]}</F>
        )}
      </G>
      {data?.items && <Grid items={data.items} fk={`${kind}-grid`} onOpen={open} onMenu={menu} />}
      {data?.rows && <Rows rows={data.rows} fk={`${kind}-rows-${source}`} onOpen={open} onMenu={menu} />}
      <Status text={data?.status} />
      <MusicBar />
    </div>
  );
}

export function Films({ source }: { source: string }) {
  return <LibraryScreen kind="films" title="Films" source={source} />;
}

export function Series({ source }: { source: string }) {
  return <LibraryScreen kind="series" title="Series" source={source} />;
}

const MUSIC_TABS = [{ id: "albums", label: "Albums" }, { id: "artists", label: "Artists" }, { id: "songs", label: "Songs" }, { id: "genres", label: "Genres" }, { id: "playlists", label: "Playlists" }];
const MUSIC_SORTS: [string, string][] = [["added", "Newest"], ["artist", "Artist A–Z"], ["title", "A to Z"], ["year", "Year"]];

/** Music: albums, artists, songs, genres and playlists; or one artist's or genre's albums, or a
 *  playlist's songs (params artist, genre, playlist). */
export function Music() {
  const nav = useNav();
  const ui = useUI();
  const p = nav.top.params;
  const by: string = p.by ?? "albums";
  const sort: string = p.sort ?? "added";
  const sub = p.artist ? `artist=${encodeURIComponent(p.artist)}` : p.genre ? `genre=${encodeURIComponent(p.genre)}` : p.playlist ? `playlist=${encodeURIComponent(p.playlist)}` : "";
  const { data, reload } = useData<{ items: (Card & { length?: number; album?: string; n?: number })[]; status: string; title?: string; counts?: { albums: number; artists: number } }>(
    `/api/music?${sub || `by=${by}&sort=${sort}`}`, ["library", "playlists"]);
  const { open, menu } = useOpener(reload);
  const pickSort = async () => {
    const v = await ui.menu("Sort by", MUSIC_SORTS.map(([id, label]) => ({ label: (id === sort ? "✓ " : "") + label, value: id })));
    if (v) nav.replace({ sort: v });
  };
  const newPlaylist = async () => {
    const name = await ui.text("Name of the playlist");
    if (name?.trim()) await api("/api/playlists", { name: name.trim() }).then(() => reload()).catch((e) => ui.toast(e.message));
  };
  const items = data?.items ?? [];
  const n = data?.counts;
  const title = p.artist || p.genre || (p.playlist ? data?.title ?? "Playlist" : "Music");
  const count = sub ? (items.length === 1 ? `1 ${p.playlist ? "song" : "album"}` : `${items.length} ${p.playlist ? "songs" : "albums"}`)
    : n ? `${n.albums} album${n.albums === 1 ? "" : "s"} · ${n.artists} artist${n.artists === 1 ? "" : "s"}` : undefined;
  const songs = p.playlist || (!sub && by === "songs");
  return (
    <div className="page">
      <Top title={title} count={count} />
      {!sub && (
        <Pills fk="music-tabs" items={MUSIC_TABS} value={by} onPick={(id) => nav.replace({ by: id })}
          extra={by === "albums" ? <><span className="fill" /><F fk="music-sort" className="pill plain" onEnter={pickSort}><ArrowDownUp />{MUSIC_SORTS.find((x) => x[0] === sort)?.[1]}</F></> : null} />
      )}
      {songs ? (
        <G fk="music-songs" className="tracks">
          {items.map((t, i) => (
            <F key={t.id} fk={`song-${t.id}`} className="track" onEnter={() => void music.playList(p.playlist ? `playlist:${p.playlist}` : t.album ?? "", t.id).then(() => nav.push("nowplaying"))}
              onLong={() => menu(t, p.playlist)}>
              <span className="n">{t.n || i + 1}</span>
              <span className="tt">{t.title}<small style={{ color: "var(--dim)" }}> · {t.subtitle}</small></span>
              <span className="d">{t.length ? fmtTime(t.length) : ""}</span>
            </F>
          ))}
        </G>
      ) : (
        <>
          {data && <Grid items={items} fk="music-grid" shape="square" onOpen={(c) => {
            if (c.kind === "artist") nav.push("music", { artist: c.title });
            else if (c.kind === "genre") nav.push("music", { genre: c.title });
            else if (c.kind === "playlist") nav.push("music", { playlist: c.id.slice(9) });
            else open(c);
          }} onMenu={(c) => menu(c)} />}
          {by === "playlists" && !sub && (
            <G fk="music-new" className="pills" style={{ marginTop: "1.2rem" }}>
              <F fk="music-newpl" className="btn outline" onEnter={newPlaylist}><Plus />New playlist</F>
            </G>
          )}
        </>
      )}
      <Status text={data?.status} />
      <MusicBar />
    </div>
  );
}
