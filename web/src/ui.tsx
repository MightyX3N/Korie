// Things that pop up over a page: a message, a question, typing a name or a PIN, and a menu.
// Each returns a promise with the answer; Escape or a click outside closes it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { onChange as onChangeLazy, pic } from "./api";

type Layer =
  | { kind: "message"; title: string; text: string; done: (v: void) => void }
  | { kind: "confirm"; title: string; text: string; yes: string; danger: boolean; done: (v: boolean) => void }
  | { kind: "prompt"; title: string; label: string; value: string; secret: boolean; done: (v: string | null) => void }
  | { kind: "pin"; title: string; text: string; done: (v: string | null) => void }
  | { kind: "menu"; title: string; items: MenuItem[]; done: (v: void) => void }
  | { kind: "pick"; title: string; options: PickOption[]; other: string; done: (v: number | null) => void };

export interface PickOption { label: string; hint?: string; image?: string }

export interface MenuItem { label: string; run: () => void | Promise<void>; danger?: boolean; hint?: string }

let layers: (Layer & { n?: number })[] = [];
let made = 0;
const subs = new Set<() => void>();
const changed = () => subs.forEach((s) => s());

function open<T>(make: (done: (v: T) => void) => Layer): Promise<T> {
  return new Promise<T>((resolve) => {
    const l: Layer & { n?: number } = make((v: T) => {
      layers = layers.filter((x) => x !== l);
      changed();
      resolve(v);
    });
    l.n = ++made;
    layers = [...layers, l];
    changed();
  });
}

export const ui = {
  message: (title: string, text = "") => open<void>((done) => ({ kind: "message", title, text, done })),
  confirm: (title: string, text = "", yes = "OK", danger = false) => open<boolean>((done) => ({ kind: "confirm", title, text, yes, danger, done })),
  prompt: (title: string, label: string, value = "", secret = false) => open<string | null>((done) => ({ kind: "prompt", title, label, value, secret, done })),
  pin: (title: string, text = "") => open<string | null>((done) => ({ kind: "pin", title, text, done })),
  menu: (title: string, items: MenuItem[]) => open<void>((done) => ({ kind: "menu", title, items, done })),
  /** Pictures to choose from: the index picked, -1 for the "other" button, null when closed. */
  pick: (title: string, options: PickOption[], other = "") => open<number | null>((done) => ({ kind: "pick", title, options, other, done })),
  /** Runs something and shows its error as a message instead of failing quietly. */
  async attempt<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      await ui.message(what, e instanceof Error ? e.message : String(e));
      return undefined;
    }
  },
};

function Box({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [close]);
  return (
    <div className="layer" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Prompt({ l }: { l: Extract<Layer, { kind: "prompt" }> }) {
  const [v, setV] = useState(l.value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <Box title={l.title} close={() => l.done(null)}>
      <form onSubmit={(e) => { e.preventDefault(); l.done(v); }}>
        <label className="field">
          <span>{l.label}</span>
          <input ref={ref} autoFocus type={l.secret ? "password" : "text"} value={v} onChange={(e) => setV(e.target.value)} />
        </label>
        <div className="buttons">
          <button type="button" className="btn" onClick={() => l.done(null)}>Cancel</button>
          <button type="submit" className="btn primary">OK</button>
        </div>
      </form>
    </Box>
  );
}

function Pin({ l }: { l: Extract<Layer, { kind: "pin" }> }) {
  const [v, setV] = useState("");
  const answered = useRef(false);
  const add = (d: string) => setV((x) => {
    const n = (x + d).slice(0, 4);
    if (n.length === 4 && !answered.current) {
      answered.current = true;
      setTimeout(() => l.done(n), 120);
    }
    return n;
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) add(e.key);
      else if (e.key === "Backspace") setV((x) => x.slice(0, -1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <Box title={l.title} close={() => l.done(null)}>
      {l.text && <p className="soft">{l.text}</p>}
      <div className="pin-dots" aria-label={`${v.length} of 4 digits`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < v.length ? "on" : ""} />)}
      </div>
      <div className="pin-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} type="button" className="btn" onClick={() => add(d)}>{d}</button>)}
        <button type="button" className="btn" onClick={() => l.done(null)}>Cancel</button>
        <button type="button" className="btn" onClick={() => add("0")}>0</button>
        <button type="button" className="btn" aria-label="Delete" onClick={() => setV((x) => x.slice(0, -1))}>⌫</button>
      </div>
    </Box>
  );
}

export function UiHost() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  const l = layers[layers.length - 1];
  if (!l) return null;
  switch (l.kind) {
    case "message":
      return (
        <Box title={l.title} close={() => l.done()}>
          {l.text && <p className="soft pre">{l.text}</p>}
          <div className="buttons"><button autoFocus className="btn primary" onClick={() => l.done()}>OK</button></div>
        </Box>
      );
    case "confirm":
      return (
        <Box title={l.title} close={() => l.done(false)}>
          {l.text && <p className="soft pre">{l.text}</p>}
          <div className="buttons">
            <button className="btn" onClick={() => l.done(false)}>Cancel</button>
            <button autoFocus className={`btn ${l.danger ? "danger" : "primary"}`} onClick={() => l.done(true)}>{l.yes}</button>
          </div>
        </Box>
      );
    case "prompt":
      return <Prompt key={l.n} l={l} />;
    case "pin":
      return <Pin key={l.n} l={l} />;
    case "pick":
      return (
        <Box title={l.title} close={() => l.done(null)}>
          <div className="pick">
            {l.options.map((o, i) => (
              <button key={i} className="pick-item" onClick={() => l.done(i)}>
                {o.image ? <img src={pic(o.image, 200)} alt="" loading="lazy" /> : <span className="pick-none" />}
                <span>{o.label}</span>
                {o.hint && <small>{o.hint}</small>}
              </button>
            ))}
          </div>
          <div className="buttons">
            {l.other && <button className="btn" onClick={() => l.done(-1)}>{l.other}</button>}
            <button className="btn" onClick={() => l.done(null)}>Cancel</button>
          </div>
        </Box>
      );
    case "menu":
      return (
        <Box title={l.title} close={() => l.done()}>
          <div className="menu">
            {l.items.map((m, i) => (
              <button key={i} autoFocus={i === 0} className={`menu-item${m.danger ? " danger" : ""}`} onClick={() => { l.done(); void m.run(); }}>
                <span>{m.label}</span>
                {m.hint && <small>{m.hint}</small>}
              </button>
            ))}
          </div>
        </Box>
      );
  }
}

/** Data from the server that reloads when it changes there (topics) or when asked. */
export function useData<T>(load: () => Promise<T>, deps: unknown[], topics: string[] = []): { data: T | null; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    load().then((d) => { if (live) { setData(d); setError(""); } }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => {
      live = false;
    };
  }, [...deps, n]);
  useEffect(() => {
    if (!topics.length) return;
    let t = 0;
    return onChangeLazy((w) => {
      if (w.some((x) => topics.includes(x))) {
        clearTimeout(t);
        t = window.setTimeout(() => setN((x) => x + 1), 300);
      }
    });
  }, [topics.join(",")]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

