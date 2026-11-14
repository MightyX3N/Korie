// Things on top of the screens: messages, questions, choices, the on-screen
// keyboard, menus and short notices. Each takes the focus while it's open
// (and Back closes it); closing puts the focus back where it was.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { F, G, getCurrentFocusKey, setFocus, doesFocusableExist, useFocusOnMount } from "./focus.tsx";
import { useBackHandler } from "./nav.tsx";
import { Delete, ClipboardPaste, Check } from "lucide-react";

interface Choice { label: string; value: string; icon?: ReactNode; danger?: boolean; primary?: boolean }

interface UI {
  message(title: string, text: string): Promise<void>;
  ask(title: string, text: string, choices: Choice[]): Promise<string | null>;
  menu(title: string, choices: Choice[]): Promise<string | null>;
  text(title: string, value?: string, opts?: { secret?: boolean; hint?: string }): Promise<string | null>;
  pin(title: string): Promise<string | null>;
  toast(text: string): void;
}

const UICtx = createContext<UI>(null as unknown as UI);
export const useUI = () => useContext(UICtx);

type Overlay = { id: number; node: (close: (v: any) => void) => ReactNode; resolve: (v: any) => void; returnTo: string };

let oseq = 1;

export function UIProvider({ children }: { children: ReactNode }) {
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [toastText, setToast] = useState("");
  const toastTimer = useRef<number>(0);

  const open = <T,>(node: (close: (v: T) => void) => ReactNode): Promise<T> =>
    new Promise<T>((resolve) => {
      const o: Overlay = { id: oseq++, node, resolve, returnTo: getCurrentFocusKey() };
      setOverlays((list) => [...list, o]);
    });

  const close = (o: Overlay, v: unknown) => {
    setOverlays((list) => list.filter((x) => x.id !== o.id));
    o.resolve(v);
    const key = o.returnTo;
    window.setTimeout(() => {
      if (key && doesFocusableExist(key)) setFocus(key);
    }, 30);
  };

  const ui: UI = {
    message: (title, text) => open<void>((done) => <Dialog title={title} text={text} choices={[{ label: "OK", value: "ok", primary: true }]} onPick={() => done()} />),
    ask: (title, text, choices) => open<string | null>((done) => <Dialog title={title} text={text} choices={choices} onPick={done} />),
    menu: (title, choices) => open<string | null>((done) => <Menu title={title} choices={choices} onPick={done} />),
    text: (title, value = "", opts = {}) => open<string | null>((done) => <TextEntry title={title} value={value} secret={opts.secret} hint={opts.hint} onDone={done} />),
    pin: (title) => open<string | null>((done) => <PinPad title={title} onDone={done} />),
    toast: (text) => {
      setToast(text);
      clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(""), 3500);
    },
  };

  return (
    <UICtx.Provider value={ui}>
      {children}
      {overlays.map((o) => (
        <div className="overlay" key={o.id}>
          {o.node((v) => close(o, v))}
        </div>
      ))}
      {toastText && <div className="toast">{toastText}</div>}
    </UICtx.Provider>
  );
}

function Dialog({ title, text, choices, onPick }: { title: string; text: string; choices: Choice[]; onPick: (v: string | null) => void }) {
  const fk = useRef("dlg" + oseq).current;
  useBackHandler(() => {
    onPick(null);
    return true;
  });
  const first = choices.findIndex((c) => c.primary);
  useFocusOnMount(`${fk}-${Math.max(0, first)}`);
  return (
    <G fk={fk} className="dialog" stop={["up", "down", "left", "right"]}>
      <h1>{title}</h1>
      {text && <p>{text}</p>}
      <div className="actions">
        {choices.map((c, i) => (
          <F key={c.value} fk={`${fk}-${i}`} className={"btn" + (c.primary ? " primary" : "") + (c.danger ? " danger" : "")} onEnter={() => onPick(c.value)}>
            {c.icon}
            {c.label}
          </F>
        ))}
      </div>
    </G>
  );
}

function Menu({ title, choices, onPick }: { title: string; choices: Choice[]; onPick: (v: string | null) => void }) {
  const fk = useRef("menu" + oseq).current;
  useBackHandler(() => {
    onPick(null);
    return true;
  });
  useFocusOnMount(`${fk}-0`);
  return (
    <G fk={fk} className="dialog" stop={["up", "down", "left", "right"]} style={{ width: "min(30rem, 100%)", gap: "0.3rem" }}>
      {title && <h2 style={{ marginBottom: "0.6rem" }}>{title}</h2>}
      {choices.map((c, i) => (
        <F key={c.value} fk={`${fk}-${i}`} className="item" onEnter={() => onPick(c.value)}>
          {c.icon}
          <div className="grow">{c.label}</div>
        </F>
      ))}
    </G>
  );
}

const KEYS = "abcdefghijklmnopqrstuvwxyz0123456789.-_:/@".split("");

function TextEntry({ title, value, secret, hint, onDone }: { title: string; value: string; secret?: boolean; hint?: string; onDone: (v: string | null) => void }) {
  const [text, setText] = useState(value);
  const [upper, setUpper] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;
  const lastWasTyping = useRef(false);
  const fk = useRef("kb" + oseq).current;
  useBackHandler(() => {
    onDone(null);
    return true;
  });
  useFocusOnMount(`${fk}-a`);
  useEffect(() => {
    // typing on a real keyboard works too; Enter is Done
    document.body.classList.add("typing");
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "v") return; // paste event below
      if (e.key === "Enter") {
        // Enter after typing on a real keyboard is Done; the remote's OK presses the focused key
        if (lastWasTyping.current) {
          e.preventDefault();
          e.stopPropagation();
          onDone(textRef.current);
        }
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        setText((t) => t.slice(0, -1));
        lastWasTyping.current = true;
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        setText((t) => t + e.key);
        lastWasTyping.current = true;
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.clipboardData?.getData("text") ?? "";
      if (t) setText((x) => x + t.replace(/[\r\n]+/g, " ").trim());
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("paste", onPaste);
    return () => {
      document.body.classList.remove("typing");
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("paste", onPaste);
    };
  }, [onDone]);
  const type = (c: string) => {
    lastWasTyping.current = false;
    setText((t) => t + (upper ? c.toUpperCase() : c));
  };
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText((x) => x + t.replace(/[\r\n]+/g, " ").trim());
    } catch {
      /* not allowed here */
    }
  };
  return (
    <G fk={fk} className="dialog" stop={["up", "down", "left", "right"]} style={{ width: "min(44rem, 100%)" }}>
      <h1>{title}</h1>
      <div className="field">
        <span>{secret ? "•".repeat(text.length) : text}</span>
        <i className="caret" />
      </div>
      {hint && <p style={{ fontSize: "0.95rem", color: "var(--dim)" }}>{hint}</p>}
      <div className="keys">
        {KEYS.map((k) => (
          <F key={k} fk={`${fk}-${k}`} className="key" onEnter={() => type(k)}>
            {upper ? k.toUpperCase() : k}
          </F>
        ))}
        <F fk={`${fk}-shift`} className="key wide" onEnter={() => setUpper((u) => !u)}>{upper ? "abc" : "ABC"}</F>
        <F fk={`${fk}-space`} className="key wide" onEnter={() => type(" ")}>Space</F>
        <F fk={`${fk}-del`} className="key wide" onEnter={() => setText((t) => t.slice(0, -1))}><Delete style={{ width: "1.2rem", height: "1.2rem", verticalAlign: "-0.2rem" }} /></F>
        <F fk={`${fk}-paste`} className="key wide" onEnter={paste}><ClipboardPaste style={{ width: "1.1rem", height: "1.1rem", verticalAlign: "-0.2rem" }} /> Paste</F>
      </div>
      <div className="actions">
        <F fk={`${fk}-ok`} className="btn primary" onEnter={() => onDone(text)}><Check />Done</F>
        <F fk={`${fk}-cancel`} className="btn" onEnter={() => onDone(null)}>Cancel</F>
      </div>
      <p style={{ fontSize: "0.9rem", color: "var(--dim)" }}>Typing on a keyboard works too. Enter is Done.</p>
    </G>
  );
}

function PinPad({ title, onDone }: { title: string; onDone: (v: string | null) => void }) {
  const [pin, setPin] = useState("");
  const fk = useRef("pin" + oseq).current;
  useBackHandler(() => {
    onDone(null);
    return true;
  });
  useFocusOnMount(`${fk}-1`);
  const add = (d: string) => {
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) window.setTimeout(() => onDone(next), 120);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        add(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        setPin((p) => p.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  return (
    <G fk={fk} className="dialog" stop={["up", "down", "left", "right"]} style={{ width: "min(26rem, 100%)", alignItems: "center" }}>
      <h1 style={{ textAlign: "center" }}>{title}</h1>
      <div className="dots">{[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? "on" : ""} />)}</div>
      <div className="pinpad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <F key={d} fk={`${fk}-${d}`} className="key" onEnter={() => add(d)}>{d}</F>)}
        <F fk={`${fk}-x`} className="key" onEnter={() => onDone(null)}>✕</F>
        <F fk={`${fk}-0`} className="key" onEnter={() => add("0")}>0</F>
        <F fk={`${fk}-del`} className="key" onEnter={() => setPin((p) => p.slice(0, -1))}><Delete style={{ width: "1.4rem", height: "1.4rem", verticalAlign: "-0.25rem" }} /></F>
      </div>
    </G>
  );
}
