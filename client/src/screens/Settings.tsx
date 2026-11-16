// Settings: categories on the left (Look, Playback, Libraries, People, Server, Add-ons, This
// device, About), their settings on the right, and a search across all of them. People opens its
// own page: everyone on the left, what the chosen person may do on the right.
import { createContext, useContext, useState, type ReactNode } from "react";
import { Search as SearchI, ChevronDown, Check, Plus, FolderPlus, Folder as FolderI } from "lucide-react";
import { api, deviceId, deviceName } from "../api.ts";
import { F, G, pointer, useFocusOnMount } from "../focus.tsx";
import { useData } from "../data.ts";
import { useNav } from "../nav.tsx";
import { useUI } from "../ui.tsx";
import type { Me } from "../App.tsx";
import { Clock, Status } from "./common.tsx";
import { COLORS } from "./Profiles.tsx";
import { desktopApp } from "../host.ts";

interface Folder { id: number; path: string; kind: string; scanned: number; error: string }
interface SettingsData { settings: Record<string, any>; folders: Folder[]; status: { scanning: boolean; text: string }; counts: Record<string, number>; tmdb: boolean; version: string }
export interface PersonFull {
  id: string; name: string; color: string; hasPin: boolean; admin: boolean; canSettings: boolean; addons: "all" | string[]; music: boolean;
  canInstall: boolean; canDelete: boolean; apps: "all" | string[]; maxAge: number | null; autoDevice: string | null;
}
interface PeopleData { people: PersonFull[]; addons: { id: string; name: string }[]; apps: { pkg: string; label: string }[]; devices: { id: string; name: string; seen: number }[] }

/** When a device was last used: today, yesterday or the date. */
function seen(t: number): string {
  const d = new Date(t * 1000);
  const day = (x: Date) => x.toDateString();
  if (day(d) === day(new Date())) return "today";
  if (day(d) === day(new Date(Date.now() - 86400000))) return "yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

const LANGS = [["en-US", "English"], ["da-DK", "Dansk"], ["sv-SE", "Svenska"], ["nb-NO", "Norsk"], ["de-DE", "Deutsch"], ["fr-FR", "Français"], ["es-ES", "Español"]];
export const AGES: (number | null)[] = [null, 15, 11, 7, 0];
export const ageLabel = (a: number | null | undefined) => (a === null || a === undefined ? "Everything" : a === 0 ? "For everyone" : `Age ${a}`);

/** What's typed in "Search settings": rows that don't match it hide themselves. */
const Query = createContext("");

/** One setting: its name and a line about it on the left, its value on the right. */
function Row({ fk, label, help, onEnter, children, words = "" }: { fk: string; label: string; help?: string; onEnter?: () => void; children?: ReactNode; words?: string }) {
  const q = useContext(Query);
  if (q && !`${label} ${help ?? ""} ${words}`.toLowerCase().includes(q)) return null;
  return (
    <F fk={fk} className="srow" onEnter={onEnter}>
      <div className="grow"><b>{label}</b>{help && <small>{help}</small>}</div>
      {children}
    </F>
  );
}

/** A value you change by choosing (a dropdown, with the remote: a menu). */
const Sel = ({ text }: { text: string }) => <span className="sel">{text}<ChevronDown /></span>;
/** A box that's ticked or not. */
const Tick = ({ on }: { on: boolean }) => <span className={"tickbox" + (on ? " on" : "")}>{on && <Check />}</span>;

const CATS: [string, string][] = [
  ["look", "Look"], ["playback", "Playback"], ["libraries", "Libraries"], ["people", "People"], ["server", "Server"],
  ["addons", "Add-ons"], ["device", "This device"], ["about", "About"],
];

export function Settings({ me, refresh, signOut }: { me: Me; refresh: () => void; signOut: () => void }) {
  const nav = useNav();
  const ui = useUI();
  const [q, setQ] = useState("");
  const cat = nav.top.params.tab ?? "playback";
  const cats = CATS.map(([id, label]) => (id === "people" && !me.person.admin ? ["people", "You"] : [id, label]));
  useFocusOnMount(`st-${cat}`, []);
  const search = async () => {
    const t = await ui.text("Search settings", q);
    if (t !== null) setQ(t.trim().toLowerCase());
  };
  const body = (id: string) => {
    const may = me.person.canSettings;
    switch (id) {
      case "look": return <Look />;
      case "playback": return <Playback me={me} refresh={refresh} />;
      case "libraries": return may ? <Libraries me={me} /> : <Locked />;
      case "people": return me.person.admin ? <PeopleSummary /> : <You me={me} refresh={refresh} />;
      case "server": return may ? <ServerSettings /> : <Locked />;
      case "addons": return <AddonsList />;
      case "device": return <ThisDevice me={me} signOut={signOut} />;
      default: return <About me={me} />;
    }
  };
  return (
    <div className="page settings">
      <div className="top">
        <h1>Settings</h1>
        <F fk="st-search" className="st-search" onEnter={search}><SearchI />{q ? <span>{q}</span> : <span className="ph">Search settings</span>}</F>
        {q && <F fk="st-clear" className="pill" onEnter={() => setQ("")}>Clear</F>}
        <span className="fill" />
        <Clock />
      </div>
      <div className="st-body">
        {!q && (
          <G fk="st-cats" className="st-cats">
            {cats.map(([id, label]) => (
              <F key={id} fk={`st-${id}`} className={"st-cat" + (id === cat ? " on" : "")}
                onFocus={() => { if (!pointer.active && id !== cat) nav.replace({ tab: id }); }}
                onEnter={() => (id === "people" && me.person.admin ? nav.push("people") : nav.replace({ tab: id }))}>{label}</F>
            ))}
          </G>
        )}
        <G fk="st-pane" className="st-pane">
          <Query.Provider value={q}>
            {q ? cats.map(([id, label]) => <section key={id} className="st-sec"><h2>{label}</h2>{body(id)}</section>) : body(cat)}
          </Query.Provider>
        </G>
      </div>
    </div>
  );
}

function Locked() {
  const q = useContext(Query);
  return q ? null : <Status text="Ask an admin to let you change settings." />;
}

function Look() {
  const nav = useNav();
  return (
    <div className="srows">
      <Row fk="look-theme" label="Theme on the TVs" help="Colours and fonts of Korie in Kodi. Each TV picks its own in its settings." words="colours fonts" onEnter={() => nav.push("store", { tab: "themes" })}>
        <Sel text="Themes" />
      </Row>
    </div>
  );
}

/** Your own languages: every screen in the house starts films in them. */
function Playback({ me, refresh }: { me: Me; refresh: () => void }) {
  const ui = useUI();
  const langs = me.languages ?? [];
  const name = (code: string) => langs.find(([c]) => c === code)?.[1] ?? code;
  const q = useContext(Query);
  const audio = me.person.audio ?? "";
  const subs = me.person.subs ?? "";
  const save = async (body: Record<string, string>) => {
    await api("/api/me/playback", body).catch((e) => ui.toast(e.message));
    refresh();
  };
  return (
    <div className="srows">
      <Row fk="pb-audio" label="Audio language" help="Picked first when a film has several" onEnter={async () => {
        const v = await ui.menu("Audio language", [{ label: (audio === "" ? "✓ " : "") + "Original language", value: "@orig" }, ...langs.map(([c, n]) => ({ label: (c === audio ? "✓ " : "") + n, value: c }))]);
        if (v) await save({ audio: v === "@orig" ? "" : v });
      }}><Sel text={audio ? name(audio) : "Original language"} /></Row>
      <Row fk="pb-subs" label="Subtitles" help="Shown when the audio isn't in your language" onEnter={async () => {
        const v = await ui.menu("Subtitles", [...langs.map(([c, n]) => ({ label: (c === subs ? "✓ " : "") + n, value: c })), { label: (subs === "off" ? "✓ " : "") + "Off", value: "off" }, { label: (subs === "" ? "✓ " : "") + "As the film says", value: "@file" }]);
        if (v) await save({ subs: v === "@file" ? "" : v });
      }}><Sel text={subs === "off" ? "Off" : subs ? name(subs) : "As the film says"} /></Row>
      {!q && <p className="note">Yours, on every screen. DVD menus, frame rate and hardware decoding are set on each TV (Korie in Kodi: Settings, Playback).</p>}
    </div>
  );
}

function Libraries({ me }: { me: Me }) {
  const ui = useUI();
  const q = useContext(Query);
  const { data, reload } = useData<SettingsData>("/api/settings", ["library", "status"]);
  if (!data) return null;
  const add = async () => {
    // walk the server's folders with the remote
    let path = "";
    for (;;) {
      const d = await api<{ path: string; parent: string | null; dirs: string[] }>(`/api/dirs?path=${encodeURIComponent(path)}`).catch((e) => {
        ui.toast(e.message);
        return null;
      });
      if (!d) return;
      const v = await ui.menu(d.path, [
        ...(d.path !== "/" ? [{ label: "✓ Use this folder", value: "@use" }] : []),
        { label: "Type a path", value: "@type" },
        ...(d.parent ? [{ label: "‹ Up one level", value: "@up" }] : []),
        ...d.dirs.map((n) => ({ label: n, value: n, icon: <FolderI /> })),
      ]);
      if (v === null) return;
      if (v === "@up") path = d.parent ?? "/";
      else if (v === "@type") {
        const t = await ui.text("The folder's path on the server", d.path, { hint: "Like /media/films. In Docker, the folders you mapped into the container." });
        if (t) path = t.trim();
      } else if (v === "@use") break;
      else path = (d.path.endsWith("/") ? d.path : d.path + "/") + v;
    }
    const kind = await ui.menu(`What's in ${path}?`, [{ label: "Films", value: "films" }, { label: "Series", value: "series" }, { label: "Music", value: "music" }]);
    if (!kind) return;
    await api("/api/folders", { path, kind }).then(() => ui.toast("Added. Korie is looking through it.")).catch((e) => ui.message("Couldn't add it", e.message));
    reload();
  };
  const folder = async (f: Folder) => {
    const v = await ui.menu(f.path, [{ label: "Look through it again", value: "scan" }, { label: "Remove from the library", value: "remove", danger: true }]);
    if (v === "scan") await api("/api/scan", {});
    if (v === "remove") {
      const ok = await ui.ask("Remove this folder?", `${f.path}\nIts films, series or music leave Korie. The files themselves stay where they are.`, [{ label: "Remove", value: "yes", danger: true }, { label: "Keep it", value: "no", primary: true }]);
      if (ok === "yes") await api(`/api/folders/${f.id}`, undefined, "DELETE").catch((e) => ui.toast(e.message));
    }
    reload();
  };
  const kindName = (k: string) => k[0].toUpperCase() + k.slice(1);
  return (
    <div className="srows">
      {data.folders.map((f) => (
        <Row key={f.id} fk={`folder-${f.id}`} label={f.path} words="folder library"
          help={f.error ? f.error : f.scanned ? `Looked through ${new Date(f.scanned * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "Looking through it…"}
          onEnter={() => folder(f)}><span className="val">{kindName(f.kind)}</span></Row>
      ))}
      {me.person.admin && <Row fk="folder-add" label="Add a folder" help="A folder on the server with films, series or music" words="library" onEnter={add}><FolderPlus className="ico" /></Row>}
      <Row fk="folder-scan" label="Look for new files now" words="scan library"
        help={data.status.scanning ? data.status.text || "Looking…" : `${data.counts.film ?? 0} films, ${data.counts.series ?? 0} series, ${data.counts.album ?? 0} albums`}
        onEnter={async () => { await api("/api/scan", {}); ui.toast("Looking for new files…"); }} />
      <Row fk="folder-removed" label="Removed from the library" help="Films and series removed with the options menu; bring them back here" onEnter={async () => {
        const r = await api<{ items: { id: string; title: string; year: string; kind: string }[] }>("/api/removed").catch((e) => { ui.toast(e.message); return null; });
        if (!r) return;
        if (!r.items.length) return ui.toast("Nothing has been removed.");
        const id = await ui.menu("Bring back to the library", r.items.map((i) => ({ label: `${i.title}${i.year ? ` (${i.year})` : ""}`, value: i.id })));
        if (id) { await api("/api/remove", { id, restore: true }); ui.toast("It's back in the library."); }
      }} />
      {!q && <p className="note">Names work the Kodi and Jellyfin way: Films/Alien (1979)/Alien (1979).mkv, Series/Arcane/Season 1/Arcane S01E01.mkv, Music/Artist/Album/01 Song.flac. Your own .nfo files and pictures (poster.jpg, fanart.jpg) win over TMDb.</p>}
    </div>
  );
}

function ServerSettings() {
  const ui = useUI();
  const { data, reload } = useData<SettingsData>("/api/settings", []);
  if (!data) return null;
  const s = data.settings;
  const set = async (key: string, value: unknown) => {
    await api("/api/settings", { key, value }).catch((e) => ui.toast(e.message));
    reload();
  };
  return (
    <div className="srows">
      <Row fk="srv-name" label="Server name" help="What devices show when they find it" onEnter={async () => { const t = await ui.text("The server's name", s.server_name); if (t?.trim()) await set("server_name", t.trim()); }}>
        <Sel text={s.server_name} />
      </Row>
      <Row fk="srv-lang" label="Language of film and series details" help="Titles and descriptions from TMDb" onEnter={async () => { const v = await ui.menu("Language for details from TMDb", LANGS.map(([id, l]) => ({ label: (id === s.language ? "✓ " : "") + l, value: id }))); if (v) await set("language", v); }}>
        <Sel text={LANGS.find((l) => l[0] === s.language)?.[1] ?? s.language} />
      </Row>
      <Row fk="srv-tmdb" label="TMDb key" help={data.tmdb ? "Details and pictures come from TMDb" : "No key: Korie can't fetch details"} onEnter={async () => { const t = await ui.text("Your own TMDb API key (empty: Korie's)", "", { secret: true }); if (t !== null) await set("tmdb_key", t.trim()); }}>
        <Sel text={s.tmdb_key ? "Your own" : "Korie's"} />
      </Row>
      <Row fk="srv-scan" label="Look for new files when the server starts" help="Off: only when you ask, or when a folder is added" onEnter={() => set("scan_on_start", !s.scan_on_start)}>
        <Tick on={!!s.scan_on_start} />
      </Row>
    </div>
  );
}

function AddonsList() {
  const nav = useNav();
  const { data } = useData<{ addons: { id: string; name: string; description: string; installed: boolean; enabled: boolean; error: string }[] }>("/api/addons", ["addons"]);
  if (!data) return null;
  const mine = data.addons.filter((a) => a.installed);
  return (
    <div className="srows">
      {mine.map((a) => (
        <Row key={a.id} fk={`sa-${a.id}`} label={a.name} help={a.error || a.description} words="add-on addon" onEnter={() => nav.push("addon", { id: a.id })}>
          <span className="val">{a.enabled ? "On" : "Off"}</span>
        </Row>
      ))}
      <Row fk="sa-more" label="Get more add-ons" help="Radio, podcasts, online catalogues and more from the Store" words="store install" onEnter={() => nav.push("store", { tab: "store" })}>
        <Plus className="ico" />
      </Row>
    </div>
  );
}

function ThisDevice({ me, signOut }: { me: Me; signOut: () => void }) {
  const nav = useNav();
  const q = useContext(Query);
  const { data } = useData<PeopleData>(me.person.admin ? "/api/people/all" : null, ["people"]);
  const auto = data?.people.find((p) => p.autoDevice === deviceId());
  return (
    <div className="srows">
      <Row fk="dev-who" label="Switch person" help="Back to Who's watching" words="profile sign out" onEnter={signOut}><span className="val">{me.person.name}</span></Row>
      {me.person.admin && (
        <Row fk="dev-auto" label="Signs in by itself as" help={`${deviceName()}: skip Who's watching and start as one person (set in People)`} words="automatic sign in"
          onEnter={() => nav.push("people", auto ? { id: auto.id } : {})}><Sel text={auto ? auto.name : "Nobody: asks who's watching"} /></Row>
      )}
      {window.KorieAndroid && <Row fk="dev-server" label="Change server" help="Look for Korie servers again, or type an address" onEnter={() => window.KorieAndroid?.forgetServer()} />}
      {desktopApp && !q && <p className="note">To change server, press Ctrl+Shift+S.</p>}
    </div>
  );
}

function About({ me }: { me: Me }) {
  const q = useContext(Query);
  return (
    <div className="srows">
      <Row fk="about-v" label={`Korie ${me.server.version}`} help={`Server “${me.server.name}”${window.KorieAndroid ? ` · TV app ${window.KorieAndroid.version()}` : ""}`} words="version" />
      {!q && <p className="note">Film and series details and pictures come from The Movie Database (TMDb). This product uses the TMDb API but is not endorsed or certified by TMDb. Video is converted with FFmpeg when a device can't play a file as it is.</p>}
    </div>
  );
}

function You({ me, refresh }: { me: Me; refresh: () => void }) {
  const ui = useUI();
  return (
    <div className="srows">
      <Row fk="you-name" label="Your name" onEnter={async () => { const t = await ui.text("Your name", me.person.name); if (t?.trim()) { await api(`/api/people/${me.person.id}`, { name: t.trim() }, "PATCH"); refresh(); } }}>
        <Sel text={me.person.name} />
      </Row>
      <Row fk="you-pin" label={me.person.hasPin ? "Change your PIN" : "Set a PIN"} help="Asked for when you pick yourself in Who's watching" onEnter={async () => { const pin = await ui.pin("A new four-digit PIN"); if (pin) await api(`/api/people/${me.person.id}/pin`, { pin }).then(() => ui.toast("PIN set")); }} />
    </div>
  );
}

export function personNote(p: PersonFull): string {
  if (p.admin) return "Runs the server";
  const limited = p.maxAge !== null || p.addons !== "all" || p.apps !== "all" || !p.music;
  return [p.hasPin ? "PIN" : "", limited ? "Limited" : ""].filter(Boolean).join(" · ") || "May watch everything";
}

/** In Settings: everyone, each opening People. */
function PeopleSummary() {
  const nav = useNav();
  const ui = useUI();
  const { data, reload } = useData<PeopleData>("/api/people/all", ["people"]);
  if (!data) return null;
  return (
    <div className="srows">
      {data.people.map((p) => (
        <Row key={p.id} fk={`sp-${p.id}`} label={p.name} help={personNote(p)} words="people person pin" onEnter={() => nav.push("people", { id: p.id })}>
          <span className="face" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>
        </Row>
      ))}
      <Row fk="sp-add" label="Add person" words="people new" onEnter={async () => { const t = await ui.text("Name of the new person"); if (t?.trim()) { const p = await api<PersonFull>("/api/people", { name: t.trim() }); reload(); nav.push("people", { id: p.id }); } }}>
        <Plus className="ico" />
      </Row>
    </div>
  );
}

/** Settings › People: who may do what (the People artboard). */
export function People({ me, refresh }: { me: Me; refresh: () => void }) {
  const nav = useNav();
  const ui = useUI();
  const { data, reload } = useData<PeopleData>("/api/people/all", ["people"]);
  const chosen = data?.people.find((x) => x.id === nav.top.params.id) ?? data?.people[0];
  useFocusOnMount(chosen ? `pp-${chosen.id}` : null, [!!data]);
  if (!data || !chosen) return null;
  const p = chosen;
  const change = async (body: Record<string, unknown>) => {
    await api(`/api/people/${p.id}`, body, "PATCH").catch((e) => ui.toast(e.message));
    reload();
    refresh();
  };
  const choose = async (key: "addons" | "apps", id: string) => {
    const all = (key === "addons" ? data.addons.map((a) => a.id) : data.apps.map((a) => a.pkg));
    const cur = p[key] === "all" ? all : [...(p[key] as string[])];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    await change({ [key]: next.length === all.length ? "all" : next });
  };
  const mayAddon = (id: string) => p.addons === "all" || p.addons.includes(id);
  const mayApp = (pkg: string) => p.apps === "all" || p.apps.includes(pkg);
  const pin = async () => {
    if (p.hasPin) {
      const w = await ui.menu(`PIN for ${p.name}`, [{ label: "Change the PIN", value: "set" }, { label: "No PIN", value: "clear", danger: true }]);
      if (w === "clear") await api(`/api/people/${p.id}/pin`, { pin: null });
      if (w !== "set") return reload();
    }
    const v = await ui.pin(`A new four-digit PIN for ${p.name}`);
    if (v) await api(`/api/people/${p.id}/pin`, { pin: v }).then(() => ui.toast("PIN set")).catch((e) => ui.toast(e.message));
    reload();
  };
  const device = async () => {
    const thisOne = deviceId();
    const v = await ui.menu(`${p.name} signs in by itself on`, [
      { label: (p.autoDevice ? "" : "✓ ") + "No device", value: "@none" },
      ...data.devices.map((d) => ({ label: (p.autoDevice === d.id ? "✓ " : "") + d.name + (d.id === thisOne ? " (this one)" : ` · used ${seen(d.seen)}`), value: d.id })),
    ]);
    if (v) await change({ autoDevice: v === "@none" ? null : v });
  };
  const age = async () => {
    const v = await ui.menu(`Films and series ${p.name} may watch`, AGES.map((a) => ({ label: (p.maxAge === a ? "✓ " : "") + ageLabel(a) + (a === null ? "" : a === 0 ? " (rated for all ages)" : ` (rated ${a} and under)`), value: String(a) })));
    if (v !== null) await change({ maxAge: v === "null" ? null : Number(v) });
  };
  const more = async () => {
    const v = await ui.menu(p.name, [
      { label: "Rename", value: "name" }, { label: "Colour", value: "color" },
      { label: p.admin ? "Not an admin" : "Make an admin", value: "admin" },
      ...(p.id !== me.person.id ? [{ label: `Remove ${p.name}…`, value: "remove", danger: true }] : []),
    ]);
    if (v === "name") { const t = await ui.text("Name", p.name); if (t?.trim()) await change({ name: t.trim() }); }
    else if (v === "color") { const c = await ui.menu("Colour", COLORS.map((x) => ({ label: (x === p.color ? "✓ " : "") + x, value: x, icon: <span className="face" style={{ background: x }} /> }))); if (c) await change({ color: c }); }
    else if (v === "admin") await change({ admin: !p.admin });
    else if (v === "remove") {
      const ok = await ui.ask(`Remove ${p.name}?`, "What they watched and their favourites go too.", [{ label: "Remove", value: "yes", danger: true }, { label: "Keep", value: "no", primary: true }]);
      if (ok === "yes") {
        await api(`/api/people/${p.id}`, undefined, "DELETE").catch((e) => ui.message("Couldn't remove", e.message));
        nav.replace({ id: undefined });
        reload();
      }
    }
  };
  const devName = data.devices.find((d) => d.id === p.autoDevice)?.name ?? "No device";
  return (
    <div className="page settings">
      <div className="top">
        <span className="crumb">Settings ›</span><h1>People</h1>
        <span className="fill" />
        <Clock />
      </div>
      <div className="st-body">
        <G fk="pp-list" className="st-cats pp-list">
          {data.people.map((x) => (
            <F key={x.id} fk={`pp-${x.id}`} className={"pp" + (x.id === p.id ? " on" : "")}
              onFocus={() => { if (!pointer.active && x.id !== p.id) nav.replace({ id: x.id }); }} onEnter={() => nav.replace({ id: x.id })}>
              <span className="face" style={{ background: x.color }}>{x.name.slice(0, 1).toUpperCase()}</span>
              <div><b>{x.name}</b><small>{personNote(x)}</small></div>
            </F>
          ))}
          <F fk="pp-add" className="pp add" onEnter={async () => { const t = await ui.text("Name of the new person"); if (t?.trim()) { const n = await api<PersonFull>("/api/people", { name: t.trim() }); reload(); nav.replace({ id: n.id }); } }}>
            <span className="face"><Plus /></span><div><b>Add person</b></div>
          </F>
        </G>
        <G fk="pp-pane" className="pp-pane">
          <div className="pp-card">
            <h3>Signing in</h3>
            <F fk="pp-pin" className="pline" onEnter={pin}><span className="grow">Needs a PIN</span><Tick on={p.hasPin} /></F>
            <F fk="pp-auto" className="pline" onEnter={device}><span className="grow">Signs in by itself on</span><Sel text={devName} /></F>
          </div>
          <div className="pp-card">
            <h3>Films and series</h3>
            {!p.admin && <F fk="pp-age" className="pline" onEnter={age}><span className="grow">Only rated up to</span><Sel text={ageLabel(p.maxAge)} /></F>}
            <F fk="pp-music" className="pline" onEnter={() => change({ music: !p.music })}><span className="grow">Music</span><Tick on={p.music} /></F>
            {p.admin && <p className="note">Admins may watch everything.</p>}
          </div>
          {!p.admin && (
            <div className="pp-card">
              <h3>Add-ons they may use</h3>
              {data.addons.map((a) => (
                <F key={a.id} fk={`pp-a-${a.id}`} className="pline" onEnter={() => choose("addons", a.id)}><span className="grow">{a.name}</span><Tick on={mayAddon(a.id)} /></F>
              ))}
              {!data.addons.length && <p className="note">No add-ons yet.</p>}
            </div>
          )}
          {!p.admin && data.apps.length > 0 && (
            <div className="pp-card">
              <h3>Android apps they may use</h3>
              {data.apps.map((a) => (
                <F key={a.pkg} fk={`pp-p-${a.pkg}`} className="pline" onEnter={() => choose("apps", a.pkg)}><span className="grow">{a.label}</span><Tick on={mayApp(a.pkg)} /></F>
              ))}
            </div>
          )}
          {!p.admin && (
            <div className="pp-card wide row">
              <F fk="pp-install" className="pline" onEnter={() => change({ canInstall: !p.canInstall })}><Tick on={p.canInstall} /><span>Install add-ons</span></F>
              <F fk="pp-settings" className="pline" onEnter={() => change({ canSettings: !p.canSettings })}><Tick on={p.canSettings} /><span>Change settings</span></F>
              <F fk="pp-delete" className="pline" onEnter={() => change({ canDelete: !p.canDelete })}><Tick on={p.canDelete} /><span>Delete from the library</span></F>
            </div>
          )}
          <div className="pp-card wide row">
            <F fk="pp-more" className="btn" onEnter={more}>Name, colour and admin…</F>
            {p.maxAge !== null && <p className="note">Films and series without an age rating are hidden from {p.name} too. Give one with the options menu on the film (Age rating).</p>}
          </div>
        </G>
      </div>
    </div>
  );
}
