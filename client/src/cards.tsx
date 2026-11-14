// Cards, rows of cards and grids: the building blocks of most screens.
import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { F, G } from "./focus.tsx";
import { pic, type Card, type Row } from "./api.ts";

export function rem(n: number): number {
  return n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
}

function Picture({ src, width, alt }: { src: string; width: number; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="ph">{alt}</div>;
  return <img src={pic(src, width)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function CardView({ c, shape, fk, onOpen, onMenu }: { c: Card; shape: string; fk: string; onOpen: (c: Card) => void; onMenu?: (c: Card) => void }) {
  const wide = shape === "wide";
  const text = shape === "text";
  const src = wide ? c.thumb || c.backdrop || c.poster : c.poster || c.thumb;
  const w = wide ? rem(17) : rem(9.6);
  return (
    <F fk={fk} className={`card ${shape}`} onEnter={() => onOpen(c)} onLong={onMenu ? () => onMenu(c) : undefined} title={c.title}>
      <div className="pic">
        {text ? c.title : <Picture src={src} width={w} alt={c.title} />}
        {c.kind === "live" && <span className="live">LIVE</span>}
        {c.watched && c.kind !== "live" && <span className="tick"><Check /></span>}
        {c.progress > 0 && <div className="bar"><i style={{ width: `${Math.round(c.progress * 100)}%` }} /></div>}
      </div>
      {!text && <div className="t">{c.title}</div>}
      {!text && c.subtitle && <div className="s">{c.subtitle}</div>}
    </F>
  );
}

export function RowView({ row, fk, onOpen, onMenu }: { row: Row; fk: string; onOpen: (c: Card) => void; onMenu?: (c: Card) => void }) {
  return (
    <section className="row">
      {row.title && <h2>{row.title}</h2>}
      <G fk={fk} className="strip">
        {row.items.map((c, i) => (
          <CardView key={c.id + i} c={c} shape={row.kind} fk={`${fk}/${i}`} onOpen={onOpen} onMenu={onMenu} />
        ))}
      </G>
    </section>
  );
}

export function Rows({ rows, fk, onOpen, onMenu }: { rows: Row[]; fk: string; onOpen: (c: Card) => void; onMenu?: (c: Card) => void }) {
  return (
    <G fk={fk}>
      {rows.map((r, i) => (
        <RowView key={r.id + i} row={r} fk={`${fk}:${i}`} onOpen={onOpen} onMenu={onMenu} />
      ))}
    </G>
  );
}

export function Grid({ items, fk, shape = "poster", onOpen, onMenu }: { items: Card[]; fk: string; shape?: string; onOpen: (c: Card) => void; onMenu?: (c: Card) => void }) {
  return (
    <G fk={fk} className="grid" style={shape === "square" ? ({ "--card-w": "10.5rem" } as React.CSSProperties) : undefined}>
      {items.map((c, i) => (
        <CardView key={c.id} c={c} shape={shape} fk={`${fk}/${i}`} onOpen={onOpen} onMenu={onMenu} />
      ))}
    </G>
  );
}

export function Pills<T extends string>({ fk, items, value, onPick, extra }: { fk: string; items: { id: T; label: string; icon?: ReactNode }[]; value: T; onPick: (id: T) => void; extra?: ReactNode }) {
  return (
    <G fk={fk} className="pills">
      {items.map((p) => (
        <F key={p.id} fk={`${fk}/${p.id || "-"}`} className={"pill" + (p.id === value ? " on" : "")} onEnter={() => onPick(p.id)}>
          {p.icon}
          {p.label}
        </F>
      ))}
      {extra}
    </G>
  );
}
