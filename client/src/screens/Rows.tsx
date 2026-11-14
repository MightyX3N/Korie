// Screens that are rows from add-ons: Live TV, Games, and an add-on's category page.
import type { Row } from "../api.ts";
import { Rows } from "../cards.tsx";
import { useData } from "../data.ts";
import { F, useFocusOnMount } from "../focus.tsx";
import { useNav } from "../nav.tsx";
import { ChevronLeft } from "lucide-react";
import { Status, Top, useOpener } from "./common.tsx";

function RowsScreen({ path, title, fk, topics }: { path: string; title: string; fk: string; topics: string[] }) {
  const { data, error } = useData<{ rows: Row[]; status: string; title?: string }>(path, topics);
  const { open, menu } = useOpener();
  return (
    <div className="page">
      <Top title={data?.title || title} />
      {data && <Rows rows={data.rows} fk={fk} onOpen={open} onMenu={menu} />}
      <Status text={error || data?.status} />
    </div>
  );
}

export function Live() {
  return <RowsScreen path="/api/live" title="Live TV" fk="live" topics={["browse"]} />;
}

export function Games() {
  return <RowsScreen path="/api/games" title="Games" fk="games" topics={["browse", "addons"]} />;
}

export function AddonPage({ id, title }: { id: string; title: string }) {
  const nav = useNav();
  const { data, error } = useData<{ rows: Row[]; status: string; title: string }>(`/api/page?id=${encodeURIComponent(id)}`, []);
  const { open, menu } = useOpener();
  // a page opens on its first row, not on Back
  useFocusOnMount(data?.rows.length ? `page-${id}:0/0` : data ? "page-back" : null, [data !== null]);
  return (
    <div className="page">
      <F fk="page-back" className="back" onEnter={() => nav.back()}><ChevronLeft />Back</F>
      <Top title={data?.title || title} />
      {data && <Rows rows={data.rows} fk={`page-${id}`} onOpen={open} onMenu={menu} />}
      <Status text={error || (data ? data.status : "Loading…")} />
    </div>
  );
}
