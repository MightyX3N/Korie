// Posters, wide tiles and rows of them.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Check, MoreHorizontal, Play } from "lucide-react";
import { pic } from "../api";
import { follow, href, itemPath } from "../router";
import type { Card, Row } from "../types";
import { cardMenu } from "./menus";

export type Shape = "poster" | "wide" | "square" | "text";

export function shapeOf(kind: string): Shape {
  if (kind === "wide") return "wide";
  if (kind === "square") return "square";
  if (kind === "text") return "text";
  return "poster";
}

/** Where a card goes: a page of an add-on opens its rows, a channel or a game starts at once. */
export function cardPath(c: Card): string {
  if (c.kind === "page") return `/page/${encodeURIComponent(c.id)}${c.only ? `?only=${c.only}` : ""}`;
  if (c.kind === "live" || c.kind === "game") return `/play/${encodeURIComponent(c.id)}`;
  if (c.kind === "artist") return `/music?artist=${encodeURIComponent(c.title)}`;
  if (c.kind === "genre") return `/music?genre=${encodeURIComponent(c.title)}`;
  if (c.kind === "playlist") return itemPath(c.id);
  // an episode (Continue watching, Next up) opens its series, at that episode
  if (c.kind === "episode" && c.series) return `${itemPath(c.series)}?ep=${encodeURIComponent(c.id)}`;
  return itemPath(c.id);
}

export function CardView({ c, shape, onChanged }: { c: Card; shape: Shape; onChanged?: () => void }) {
  const picture = shape === "wide" ? c.thumb || c.backdrop || c.poster : shape === "square" ? c.poster || c.thumb : c.poster || c.thumb;
  const width = shape === "wide" ? 420 : shape === "square" ? 260 : 240;
  const to = cardPath(c);
  const menuable = !["page", "artist", "genre"].includes(c.kind);
  return (
    <div className={`card card-${shape}`}>
      <a className="card-link" href={href(to)} onClick={(e) => follow(e, to)} title={c.title}>
        <span className="card-pic">
          {picture && shape !== "text" ? <img src={pic(picture, width)} alt="" loading="lazy" /> : <span className="card-name">{c.title}</span>}
          {c.progress > 0 && !c.watched && <span className="card-bar"><i style={{ width: `${Math.round(c.progress * 100)}%` }} /></span>}
          {c.watched && <span className="card-seen" title="Watched"><Check size={14} /></span>}
          {(c.kind === "live" || c.kind === "game") && <span className="card-play"><Play size={22} fill="currentColor" /></span>}
        </span>
        {shape !== "text" && (
          <span className="card-text">
            <span className="card-title">{c.title}</span>
            <span className="card-sub">{[c.subtitle || c.year, c.cert].filter(Boolean).join(" · ")}</span>
          </span>
        )}
      </a>
      {menuable && (
        <button className="card-more" aria-label={`Options for ${c.title}`} onClick={() => void cardMenu(c, onChanged)}>
          <MoreHorizontal size={18} />
        </button>
      )}
    </div>
  );
}

/** A row that scrolls sideways, with arrows on the sides when there's more. */
export function RowView({ row, onChanged }: { row: Row; onChanged?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const check = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    check();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [row.items.length]);
  const move = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });
  const shape = shapeOf(row.kind);
  if (!row.items.length) return null;
  return (
    <section className="row">
      <h2 className="row-title">{row.title}</h2>
      <div className="row-wrap">
        {edges.left && <button className="row-arrow left" aria-label="Scroll left" onClick={() => move(-1)}><ChevronLeft /></button>}
        <div className={`row-items row-${shape}`} ref={ref} onScroll={check}>
          {row.items.map((c) => <CardView key={c.id} c={c} shape={shape} onChanged={onChanged} />)}
        </div>
        {edges.right && <button className="row-arrow right" aria-label="Scroll right" onClick={() => move(1)}><ChevronRight /></button>}
      </div>
    </section>
  );
}

export function Grid({ items, shape, onChanged }: { items: Card[]; shape: Shape; onChanged?: () => void }) {
  return <div className={`grid grid-${shape}`}>{items.map((c) => <CardView key={c.id} c={c} shape={shape} onChanged={onChanged} />)}</div>;
}

export function Status({ text, error }: { text?: string; error?: string }) {
  if (error) return <p className="status bad pre">{error}</p>;
  if (!text) return null;
  return <p className="status pre">{text}</p>;
}

export function Loading() {
  return <div className="loading" aria-label="Loading"><i /><i /><i /></div>;
}
