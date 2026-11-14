// Films, Series and Music: your own library as a grid (sort and filter), or an
// add-on's rows. The sources and the filters are one row of pills, so the
// remote moves straight from one to the next.
import { ArrowDownUp } from "lucide-react";
import type { Card, Row } from "../api.ts";
import { F, G } from "../focus.tsx";
import { Grid, Rows } from "../cards.tsx";
import { useData } from "../data.ts";
import { useNav } from "../nav.tsx";
import { useUI } from "../ui.tsx";
import { Status, Top, useOpener } from "./common.tsx";

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
    </div>
  );
}

export function Films({ source }: { source: string }) {
  return <LibraryScreen kind="films" title="Films" source={source} />;
}

export function Series({ source }: { source: string }) {
  return <LibraryScreen kind="series" title="Series" source={source} />;
}

export function Music() {
  const nav = useNav();
  const ui = useUI();
  const sort = nav.top.params.sort ?? "added";
  const { data } = useData<{ items: Card[]; status: string }>(`/api/music?sort=${sort}`, ["library"]);
  const { open } = useOpener();
  const pickSort = async () => {
    const v = await ui.menu("Sort by", SORTS.slice(0, 3).map(([id, label]) => ({ label: (id === sort ? "✓ " : "") + label, value: id })));
    if (v) nav.replace({ sort: v });
  };
  return (
    <div className="page">
      <Top title="Music" count={data ? `${data.items.length} albums` : undefined} />
      <G fk="music-pills" className="pills">
        <F fk="music-sort" className="pill" onEnter={pickSort}><ArrowDownUp />{SORTS.find((s) => s[0] === sort)?.[1]}</F>
      </G>
      {data && <Grid items={data.items} fk="music-grid" shape="square" onOpen={open} />}
      <Status text={data?.status} />
    </div>
  );
}
