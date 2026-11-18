// Libraries: the folders with films, series and music; adding one with the folder picker.
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { api } from "../api";
import { go } from "../router";
import { ui, useData } from "../ui";
import { Dot, GOOD, BUSY, BAD, ago } from "./Admin";

interface Folder { id: number; path: string; kind: "films" | "series" | "music"; scanned: number; error: string; counts: Record<string, number> }
interface Dir { name: string; path: string; videos: number; songs: number; inLibrary: string | null }
interface Dirs { path: string; parent: string | null; missing: boolean; dirs: Dir[]; here?: { videos: number; songs: number; inLibrary: string | null } }

const KINDS: [Folder["kind"], string][] = [["films", "Films"], ["series", "Series"], ["music", "Music"]];

function countText(f: Folder): string {
  const c = f.counts;
  const n = (x: number | undefined, one: string, many: string) => `${x ?? 0} ${(x ?? 0) === 1 ? one : many}`;
  if (f.kind === "films") return n(c.film, "film", "films");
  if (f.kind === "series") return `${n(c.series, "series", "series")} · ${n(c.episode, "episode", "episodes")}`;
  return `${n(c.album, "album", "albums")} · ${n(c.track, "song", "songs")}`;
}

/** What a folder probably holds, from its name and what's in it. */
function guess(name: string, d?: { videos: number; songs: number }): Folder["kind"] {
  const n = name.toLowerCase();
  if (/music|musik|audio|sange/.test(n) || (d && d.songs > d.videos)) return "music";
  if (/serie|tv|show/.test(n)) return "series";
  return "films";
}

export function Libraries() {
  const { data, error, reload } = useData(() => api<{ folders: Folder[]; status: { scanning: boolean; text: string; done: number; total: number }; missing: number }>("/api/admin/folders"), [], ["library", "status"]);
  const [adding, setAdding] = useState(new URLSearchParams(location.search).has("add"));
  const removed = useData(() => api<{ items: { id: string; kind: string; title: string; year: string; file: string }[] }>("/api/removed"), [], ["library"]);

  const scan = async () => {
    await ui.attempt("Couldn't start", () => api("/api/scan", {}));
    reload();
  };
  const remove = async (f: Folder) => {
    if (!(await ui.confirm(`Take ${f.path.split("/").pop()} out of Korie?`, "Its films, series or music go from Korie (and what people have watched in it). The files stay on the NAS.", "Take it out", true))) return;
    await ui.attempt("Couldn't take it out", () => api(`/api/folders/${f.id}`, undefined, "DELETE"));
    reload();
  };
  const st = data?.status;
  return (
    <>
      <header className="adm-head">
        <div>
          <h1 className="adm-h1">Libraries</h1>
          <p className="adm-soft max">Folders on the NAS with films, series or music. They show up on the TVs a moment after you add them.</p>
        </div>
        <div className="adm-row">
          <button className="adm-btn" onClick={() => void scan()} disabled={st?.scanning}>{st?.scanning ? "Looking…" : "Look for new files"}</button>
          <button className="adm-btn primary" onClick={() => setAdding(true)}>Add a folder</button>
        </div>
      </header>
      {error && <p className="adm-bad">{error}</p>}

      <section aria-label="Folders" className="adm-stack">
        {data && !data.folders.length && !adding && <p className="adm-soft">No folders yet. Add the folders where your films, series and music are.</p>}
        {data?.folders.map((f) => {
          const busy = st?.scanning && (st.text.includes(f.path) || st.text.startsWith("Getting details"));
          const state = f.error ? { c: BAD, t: f.error } : busy ? { c: BUSY, t: st!.text.startsWith("Getting details") ? `Getting details ${st!.done} / ${st!.total}` : "Looking through it" } : { c: GOOD, t: f.scanned ? `Up to date · ${ago(f.scanned * 1000)}` : "Waiting" };
          return (
            <div key={f.id} className="adm-card adm-folder">
              <div className="adm-folder-name">
                <strong>{f.path.split("/").filter(Boolean).pop()}</strong>
                <span className="adm-mono">{f.path}</span>
              </div>
              <span className={`adm-kind ${f.kind}`}>{KINDS.find((k) => k[0] === f.kind)?.[1]}</span>
              <span className="adm-text2">{countText(f)}</span>
              <span className="adm-state" style={{ color: state.c }}><Dot color={state.c} />{state.t}</span>
              <button className="adm-square" aria-label={`More for ${f.path}`} onClick={() => void ui.menu(f.path.split("/").pop() ?? f.path, [
                { label: "Look for new files", run: scan },
                { label: "Take it out of Korie…", danger: true, run: () => remove(f) },
              ])}><MoreHorizontal size={18} /></button>
            </div>
          );
        })}
      </section>

      {adding && <AddFolder close={() => { setAdding(false); go("/admin/libraries", true); }} added={reload} />}

      {!!data?.missing && <p className="adm-soft">Getting posters and descriptions: {data.missing} films and series still to do. Everything is already watchable.</p>}

      {!!removed.data?.items.length && (
        <section className="adm-card adm-list">
          <h2 className="adm-h2">Taken out of the library</h2>
          <p className="adm-soft small">Their files are still there. Put them back to show them again.</p>
          {removed.data.items.map((r) => (
            <div key={r.id} className="adm-line">
              <div className="adm-line-text"><strong>{r.title}{r.year ? ` (${r.year})` : ""}</strong><span className="adm-mono small">{r.file}</span></div>
              <button className="adm-btn" onClick={async () => { await ui.attempt("Couldn't put it back", () => api("/api/remove", { id: r.id, restore: true })); removed.reload(); }}>Put back</button>
            </div>
          ))}
        </section>
      )}

      <p className="adm-soft max">Names work the Jellyfin way: Films/Alien (1979)/Alien (1979).mkv, Series/Arcane/Season 1/Arcane S01E01.mkv. Your own .nfo files and pictures (poster.jpg, fanart.jpg) win over TMDb.</p>
    </>
  );
}

function AddFolder({ close, added }: { close: () => void; added: () => void }) {
  const [path, setPath] = useState("");
  const [dirs, setDirs] = useState<Dirs | null>(null);
  const [picked, setPicked] = useState<Dir | null>(null);
  const [kind, setKind] = useState<Folder["kind"]>("films");
  const [guessed, setGuessed] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = async (p: string) => {
    const d = await ui.attempt("Couldn't open that folder", () => api<Dirs>(`/api/admin/dirs?path=${encodeURIComponent(p)}`));
    if (!d) return;
    setDirs(d);
    if (!d.missing) {
      setPath(d.path);
      setPicked(null);
      if (d.here && (d.here.videos || d.here.songs)) {
        setKind(guess(d.path.split("/").pop() ?? "", d.here));
        setGuessed(true);
      }
    }
  };
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    void open("");
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const choose = (d: Dir) => {
    setPicked(d);
    setPath(d.path);
    setKind(guess(d.name, d));
    setGuessed(true);
  };

  const add = async () => {
    setBusy(true);
    const r = await ui.attempt("Couldn't add the folder", () => api("/api/folders", { path, kind }));
    setBusy(false);
    if (r) {
      added();
      close();
    }
  };
  const crumbs = (dirs?.path ?? "").split("/").filter(Boolean);
  const name = path.split("/").filter(Boolean).pop() ?? "";
  return (
    <section ref={box} role="dialog" aria-labelledby="addtitle" className="adm-card adm-dialog">
      <div className="adm-dialog-head">
        <h2 id="addtitle" className="adm-h2">Add a folder</h2>
        <button className="adm-square" onClick={close} aria-label="Close"><X size={18} /></button>
      </div>
      <form className="adm-field" onSubmit={(e) => { e.preventDefault(); void open(path); }}>
        <label htmlFor="folder-path">Folder</label>
        <input id="folder-path" className="adm-input mono" value={path} onChange={(e) => setPath(e.target.value)} onBlur={() => path && path !== dirs?.path && void open(path)} placeholder="/volume1/Media/Movies" />
        <span className="adm-soft small">Paste a path the way the NAS shows it, or pick below. Korie finds it inside its container by itself.</span>
        {dirs?.missing && <span className="adm-bad small">Korie can't find {dirs.path}. Check that the folder is shared with Korie's container (a volume mapped to /media).</span>}
      </form>
      <div className="adm-browser">
        <div className="adm-crumbs">
          <button className="adm-link" onClick={() => void open("/")}>/</button>
          {crumbs.map((c, i) => (
            <span key={i}>{i > 0 && <span className="adm-dim">/</span>}{i < crumbs.length - 1 ? <button className="adm-link" onClick={() => void open("/" + crumbs.slice(0, i + 1).join("/"))}>{c}</button> : <strong>{c}</strong>}</span>
          ))}
        </div>
        {dirs?.parent && <div className="adm-dir"><button className="adm-dir-pick" onClick={() => void open(dirs.parent!)}><span>.. (one folder up)</span></button></div>}
        {dirs?.dirs.map((d) => (
          <div key={d.path} className={`adm-dir${picked?.path === d.path ? " on" : ""}`}>
            <button className="adm-dir-pick" disabled={!!d.inLibrary} onClick={() => choose(d)} onDoubleClick={() => void open(d.path)}>
              <span>{d.name}</span>
              <span className="adm-soft small">{d.inLibrary ? `in ${KINDS.find((k) => k[0] === d.inLibrary)?.[1]} already` : d.videos ? `${d.videos} video ${d.videos === 1 ? "file" : "files"}` : d.songs ? `${d.songs} music ${d.songs === 1 ? "file" : "files"}` : "empty"}</span>
            </button>
            <button className="adm-link small" onClick={() => void open(d.path)} aria-label={`Open ${d.name}`}>Open</button>
          </div>
        ))}
        {dirs && !dirs.dirs.length && !dirs.missing && <p className="adm-soft small pad">No folders inside.</p>}
      </div>
      <fieldset className="adm-fieldset">
        <legend>What's in it</legend>
        <div className="adm-row">
          {KINDS.map(([id, label]) => <button key={id} type="button" aria-pressed={kind === id} className={`adm-toggle${kind === id ? " on" : ""}`} onClick={() => { setKind(id); setGuessed(false); }}>{label}</button>)}
        </div>
        {guessed && <span className="adm-soft small">Korie guessed {KINDS.find((k) => k[0] === kind)?.[1]} from the {kind === "music" ? "files" : "names"}.</span>}
      </fieldset>
      <div className="adm-row end">
        <button className="adm-btn" onClick={close}>Cancel</button>
        <button className="adm-btn primary" disabled={!path || busy || !!dirs?.missing} onClick={() => void add()}>{busy ? "Adding…" : `Add ${name || "the folder"}`}</button>
      </div>
    </section>
  );
}
