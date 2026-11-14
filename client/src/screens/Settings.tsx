// Settings: libraries (folders on the server), the server, people, and about.
import { FolderPlus, Folder as FolderI, RefreshCw, Server, Languages, KeyRound, UserPlus, User, Info, Trash2, Shield, Lock, Palette, Puzzle, Pencil } from "lucide-react";
import { api } from "../api.ts";
import { F, G } from "../focus.tsx";
import { useData } from "../data.ts";
import { useNav } from "../nav.tsx";
import { useUI } from "../ui.tsx";
import type { Me } from "../App.tsx";
import { Status, Top } from "./common.tsx";
import { COLORS } from "./Profiles.tsx";
import { desktopApp } from "../host.ts";

interface Folder { id: number; path: string; kind: string; scanned: number; error: string }
interface SettingsData { settings: Record<string, any>; folders: Folder[]; status: { scanning: boolean; text: string }; counts: Record<string, number>; tmdb: boolean; version: string }
interface PersonFull { id: string; name: string; color: string; hasPin: boolean; admin: boolean; canSettings: boolean; addons: "all" | string[] }

const LANGS = [["en-US", "English"], ["da-DK", "Dansk"], ["sv-SE", "Svenska"], ["nb-NO", "Norsk"], ["de-DE", "Deutsch"], ["fr-FR", "Français"], ["es-ES", "Español"]];

export function Settings({ me, refresh }: { me: Me; refresh: () => void }) {
  const nav = useNav();
  const tab = nav.top.params.tab ?? "libraries";
  const tabs = [["libraries", "Libraries"], ["server", "Server"], ...(me.person.admin ? [["people", "People"]] : [["me", "You"]]), ["about", "About"]];
  return (
    <div className="page">
      <Top title="Settings" />
      <G fk="settings-tabs" className="pills">
        {tabs.map(([id, label]) => <F key={id} fk={`st-${id}`} className={"pill" + (tab === id ? " on" : "")} onEnter={() => nav.replace({ tab: id })}>{label}</F>)}
      </G>
      {!me.person.canSettings && tab !== "about" && tab !== "me" ? <Status text="Ask an admin to let you change settings." /> :
        tab === "libraries" ? <Libraries me={me} /> : tab === "server" ? <ServerSettings /> : tab === "people" ? <People me={me} refresh={refresh} /> : tab === "me" ? <You me={me} refresh={refresh} /> : <About me={me} />}
    </div>
  );
}

function Libraries({ me }: { me: Me }) {
  const ui = useUI();
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
    const v = await ui.menu(f.path, [{ label: "Look through it again", value: "scan", icon: <RefreshCw /> }, { label: "Remove from the library", value: "remove", icon: <Trash2 /> }]);
    if (v === "scan") await api("/api/scan", {});
    if (v === "remove") {
      const ok = await ui.ask("Remove this folder?", `${f.path}\nIts films, series or music leave Korie. The files themselves stay where they are.`, [{ label: "Remove", value: "yes", danger: true }, { label: "Keep it", value: "no", primary: true }]);
      if (ok === "yes") await api(`/api/folders/${f.id}`, undefined, "DELETE").catch((e) => ui.toast(e.message));
    }
    reload();
  };
  return (
    <>
      <G fk="lib-list" className="list">
        {data.folders.map((f) => (
          <F key={f.id} fk={`folder-${f.id}`} className="item" onEnter={() => folder(f)}>
            <FolderI />
            <div className="grow">{f.path}<small>{f.kind[0].toUpperCase() + f.kind.slice(1)}{f.error ? ` · ${f.error}` : f.scanned ? ` · looked through ${new Date(f.scanned * 1000).toLocaleString()}` : " · looking through it…"}</small></div>
          </F>
        ))}
        {me.person.admin && <F fk="folder-add" className="item" onEnter={add}><FolderPlus /><div className="grow">Add a folder<small>A folder on the server with films, series or music</small></div></F>}
        <F fk="folder-scan" className="item" onEnter={async () => { await api("/api/scan", {}); ui.toast("Looking for new files…"); }}><RefreshCw /><div className="grow">Look for new files now<small>{data.status.scanning ? data.status.text || "Looking…" : `${data.counts.film ?? 0} films, ${data.counts.series ?? 0} series, ${data.counts.album ?? 0} albums`}</small></div></F>
      </G>
      <p className="note">Names work the Kodi and Jellyfin way: Films/Alien (1979)/Alien (1979).mkv, Series/Arcane/Season 1/Arcane S01E01.mkv, Music/Artist/Album/01 Song.flac. Your own .nfo files and pictures (poster.jpg, fanart.jpg) win over TMDb.</p>
    </>
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
    <G fk="srv-list" className="list">
      <F fk="srv-name" className="item" onEnter={async () => { const t = await ui.text("The server's name", s.server_name); if (t?.trim()) await set("server_name", t.trim()); }}>
        <Server /><div className="grow">Server name<small>What devices show when they find it</small></div><span className="val">{s.server_name}</span>
      </F>
      <F fk="srv-lang" className="item" onEnter={async () => { const v = await ui.menu("Language for details from TMDb", LANGS.map(([id, l]) => ({ label: (id === s.language ? "✓ " : "") + l, value: id }))); if (v) await set("language", v); }}>
        <Languages /><div className="grow">Language of film and series details</div><span className="val">{LANGS.find((l) => l[0] === s.language)?.[1] ?? s.language}</span>
      </F>
      <F fk="srv-tmdb" className="item" onEnter={async () => { const t = await ui.text("Your own TMDb API key (empty: Korie's)", "", { secret: true }); if (t !== null) await set("tmdb_key", t.trim()); }}>
        <KeyRound /><div className="grow">TMDb key<small>{data.tmdb ? "Details and pictures come from TMDb." : "No key: Korie can't fetch details."}</small></div><span className="val">{s.tmdb_key ? "Your own" : "Korie's"}</span>
      </F>
      <F fk="srv-scan" className="item" onEnter={() => set("scan_on_start", !s.scan_on_start)}>
        <RefreshCw /><div className="grow">Look for new files when the server starts</div><span className={"toggle" + (s.scan_on_start ? " on" : "")} />
      </F>
    </G>
  );
}

function People({ me, refresh }: { me: Me; refresh: () => void }) {
  const ui = useUI();
  const { data, reload } = useData<{ people: PersonFull[]; addons: { id: string; name: string }[] }>("/api/people/all", ["people"]);
  if (!data) return null;
  const change = async (p: PersonFull, body: Record<string, unknown>) => {
    await api(`/api/people/${p.id}`, body, "PATCH").catch((e) => ui.toast(e.message));
    reload();
    refresh();
  };
  const open = async (p: PersonFull) => {
    const v = await ui.menu(p.name, [
      { label: "Rename", value: "name", icon: <Pencil /> },
      { label: "Colour", value: "color", icon: <Palette /> },
      { label: p.hasPin ? "Change or remove PIN" : "Set a PIN", value: "pin", icon: <Lock /> },
      { label: p.admin ? "Admin: yes (press to remove)" : "Admin: no (press to make admin)", value: "admin", icon: <Shield /> },
      ...(!p.admin ? [{ label: p.canSettings ? "May change settings: yes" : "May change settings: no", value: "settings", icon: <Server /> }] : []),
      ...(!p.admin ? [{ label: `Add-ons: ${p.addons === "all" ? "all" : `${p.addons.length} chosen`}`, value: "addons", icon: <Puzzle /> }] : []),
      ...(p.id !== me.person.id ? [{ label: "Remove", value: "remove", icon: <Trash2 /> }] : []),
    ]);
    if (v === "name") {
      const t = await ui.text("Name", p.name);
      if (t?.trim()) await change(p, { name: t.trim() });
    } else if (v === "color") {
      const c = await ui.menu("Colour", COLORS.map((x) => ({ label: x, value: x, icon: <span className="avatar" style={{ background: x, width: "1.2rem", height: "1.2rem" }} /> })));
      if (c) await change(p, { color: c });
    } else if (v === "pin") {
      const w = p.hasPin ? await ui.menu("PIN", [{ label: "Change PIN", value: "set" }, { label: "Remove PIN", value: "clear" }]) : "set";
      if (w === "clear") await api(`/api/people/${p.id}/pin`, { pin: null });
      if (w === "set") {
        const pin = await ui.pin("A new four-digit PIN");
        if (pin) await api(`/api/people/${p.id}/pin`, { pin }).then(() => ui.toast("PIN set")).catch((e) => ui.toast(e.message));
      }
      reload();
    } else if (v === "admin") await change(p, { admin: !p.admin });
    else if (v === "settings") await change(p, { canSettings: !p.canSettings });
    else if (v === "addons") {
      const all = p.addons === "all";
      const pick = await ui.menu("Which add-ons may they use?", [{ label: (all ? "✓ " : "") + "All of them", value: "@all" }, ...data.addons.map((a) => ({ label: (!all && (p.addons as string[]).includes(a.id) ? "✓ " : "") + a.name, value: a.id }))]);
      if (pick === "@all") await change(p, { addons: "all" });
      else if (pick) {
        const cur = all ? data.addons.map((a) => a.id) : [...(p.addons as string[])];
        await change(p, { addons: cur.includes(pick) ? cur.filter((x) => x !== pick) : [...cur, pick] });
      }
    } else if (v === "remove") {
      const ok = await ui.ask(`Remove ${p.name}?`, "What they watched and their favourites go too.", [{ label: "Remove", value: "yes", danger: true }, { label: "Keep", value: "no", primary: true }]);
      if (ok === "yes") await api(`/api/people/${p.id}`, undefined, "DELETE").catch((e) => ui.message("Couldn't remove", e.message));
      reload();
    }
  };
  return (
    <G fk="people-list" className="list">
      {data.people.map((p) => (
        <F key={p.id} fk={`person-${p.id}`} className="item" onEnter={() => open(p)}>
          <span className="avatar" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>
          <div className="grow">{p.name}<small>{[p.admin ? "Admin" : p.canSettings ? "May change settings" : "", p.hasPin ? "PIN" : "No PIN", p.id === me.person.id ? "You" : ""].filter(Boolean).join(" · ")}</small></div>
        </F>
      ))}
      <F fk="person-add" className="item" onEnter={async () => { const t = await ui.text("Name of the new person"); if (t?.trim()) { await api("/api/people", { name: t.trim() }); reload(); } }}>
        <UserPlus /><div className="grow">Add a person</div>
      </F>
    </G>
  );
}

function You({ me, refresh }: { me: Me; refresh: () => void }) {
  const ui = useUI();
  return (
    <G fk="you-list" className="list">
      <F fk="you-name" className="item" onEnter={async () => { const t = await ui.text("Your name", me.person.name); if (t?.trim()) { await api(`/api/people/${me.person.id}`, { name: t.trim() }, "PATCH"); refresh(); } }}>
        <User /><div className="grow">Name</div><span className="val">{me.person.name}</span>
      </F>
      <F fk="you-pin" className="item" onEnter={async () => { const pin = await ui.pin("A new four-digit PIN"); if (pin) await api(`/api/people/${me.person.id}/pin`, { pin }).then(() => ui.toast("PIN set")); }}>
        <Lock /><div className="grow">{me.person.hasPin ? "Change your PIN" : "Set a PIN"}</div>
      </F>
    </G>
  );
}

function About({ me }: { me: Me }) {
  return (
    <G fk="about-list" className="list">
      <F fk="about-v" className="item"><Info /><div className="grow">Korie {me.server.version}<small>Server “{me.server.name}”{window.KorieAndroid ? ` · TV app ${window.KorieAndroid.version()}` : ""}</small></div></F>
      {window.KorieAndroid && <F fk="about-server" className="item" onEnter={() => window.KorieAndroid?.forgetServer()}><Server /><div className="grow">Change server<small>Look for Korie servers again, or type an address</small></div></F>}
      {desktopApp && <p className="note">To change server, press Ctrl+Shift+S.</p>}
      <p className="note">Film and series details and pictures come from The Movie Database (TMDb). This product uses the TMDb API but is not endorsed or certified by TMDb. Video is converted with FFmpeg when a device can't play a file as it is.</p>
    </G>
  );
}
