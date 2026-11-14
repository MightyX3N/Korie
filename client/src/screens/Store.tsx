// The Store: add-ons to get, the ones you have, and each add-on's page with
// its settings.
import { useState } from "react";
import { ChevronLeft, Download, Power, Trash2, RefreshCw, Gamepad2, Clapperboard, Puzzle, KeyRound, List, Type } from "lucide-react";
import { api } from "../api.ts";
import { F, G, useFocusOnMount } from "../focus.tsx";
import { useData } from "../data.ts";
import { useNav } from "../nav.tsx";
import { useUI } from "../ui.tsx";
import type { Me } from "../App.tsx";
import { Status, Top } from "./common.tsx";

interface Setting { key: string; label: string; type: "text" | "password" | "list"; help?: string; value: unknown }
interface Addon {
  id: string; name: string; version: string; storeVersion: string; author: string; description: string; games: boolean; installed: boolean;
  builtin: boolean; enabled: boolean; error: string; status: string; busy: boolean; internet: boolean; hosts: string[]; hostsFromSettings: boolean;
  settings: Setting[]; log: string[];
}

function icon(a: Addon) {
  return a.games ? <Gamepad2 /> : a.id.includes("drtv") || a.id.includes("stremio") || a.id.includes("films") ? <Clapperboard /> : <Puzzle />;
}

function state(a: Addon): string {
  if (a.busy) return "Installing…";
  if (a.error) return "Can't run";
  if (!a.installed) return "Get";
  if (a.status === "update") return "Update ready";
  if (a.builtin) return a.enabled ? "Built in · On" : "Built in · Off";
  return a.enabled ? "On" : "Off";
}

export function Store({ me }: { me: Me }) {
  const nav = useNav();
  const tab = nav.top.params.tab ?? "store";
  const { data } = useData<{ addons: Addon[]; store: { loading: boolean; error: string } }>("/api/addons", ["store", "addons"]);
  const list = (data?.addons ?? []).filter((a) => (tab === "store" ? !a.builtin : a.installed));
  return (
    <div className="page">
      <Top title="Store" />
      <G fk="store-tabs" className="pills">
        {[["store", "Store"], ["installed", `Installed · ${(data?.addons ?? []).filter((a) => a.installed).length}`]].map(([id, label]) => (
          <F key={id} fk={`store-tab-${id}`} className={"pill" + (tab === id ? " on" : "")} onEnter={() => nav.replace({ tab: id })}>{label}</F>
        ))}
      </G>
      <G fk={`store-list-${tab}`} className="tiles">
        {list.map((a) => (
          <F key={a.id} fk={`addon-${a.id}`} className="tile" onEnter={() => nav.push("addon", { id: a.id })}>
            <div className="head">
              <span className="ico">{icon(a)}</span>
              <div><h3>{a.name}</h3><small>{state(a)}{a.version ? ` · ${a.version}` : ""}</small></div>
            </div>
            <p>{a.description}</p>
          </F>
        ))}
      </G>
      <Status text={data?.store.error || (data && !list.length ? (tab === "store" ? (data.store.loading ? "Loading the Store…" : "The Store is empty.") : "No add-ons installed.") : "")} />
      {!me.person.admin && <p className="note">Only an admin can get, turn on or set up add-ons.</p>}
    </div>
  );
}

export function AddonInfo({ id, me }: { id: string; me: Me }) {
  const nav = useNav();
  const ui = useUI();
  const [busy, setBusy] = useState(false);
  const { data: a, error, reload } = useData<Addon>(`/api/addon?id=${encodeURIComponent(id)}`, ["store", "addons"]);
  useFocusOnMount(a ? "addon-main" : null, [a !== null]);
  if (!a) return <div className="page"><F fk="addon-back" className="back" onEnter={() => nav.back()}><ChevronLeft />Store</F><Status text={error || "Loading…"} /></div>;

  const run = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      return await api<any>(`/api/addon/${action}`, { id: a.id, ...body });
    } catch (e: any) {
      await ui.message("That didn't work", e.message);
      return null;
    } finally {
      setBusy(false);
      reload();
    }
  };

  const turnOn = async () => {
    const r = await run("enable");
    if (r?.needsInternet) {
      const where = r.hosts.length ? `It can fetch things from ${r.hosts.join(", ")}${r.hostsFromSettings ? ", and from the addresses an admin types into its settings" : ""}.` : "It can fetch things only from the addresses an admin types into its settings.";
      const v = await ui.ask(`Let ${a.name} use the internet?`, `${where}\nNothing else: it can't open the server's files or run programs.\n\nFrom: ${a.author} · version ${a.version}`, [
        { label: "Allow", value: "yes", primary: true }, { label: "Don't allow", value: "no" },
      ]);
      if (v === "yes") await run("enable", { internet: true });
    }
  };

  const get = async () => {
    const ok = await run("install");
    if (ok) await turnOn();
  };

  const remove = async () => {
    const v = await ui.ask(`Remove ${a.name}?`, "Its settings are kept, in case you get it again.", [{ label: "Remove", value: "yes", danger: true }, { label: "Keep it", value: "no", primary: true }]);
    if (v === "yes" && (await run("remove"))) nav.back();
  };

  const edit = async (s: Setting) => {
    if (s.type === "list") {
      const list = Array.isArray(s.value) ? (s.value as string[]) : [];
      const v = await ui.menu(s.label, [...list.map((x, i) => ({ label: `Remove ${x}`, value: String(i) })), { label: "Add one", value: "add" }]);
      if (v === "add") {
        const t = await ui.text(s.label, "", { hint: s.help });
        if (t?.trim()) await run("setting", { key: s.key, value: [...list, t.trim()] });
      } else if (v !== null) {
        await run("setting", { key: s.key, value: list.filter((_, i) => String(i) !== v) });
      }
      return;
    }
    const t = await ui.text(s.label, s.type === "password" ? "" : String(s.value ?? ""), { secret: s.type === "password", hint: s.help });
    if (t !== null) await run("setting", { key: s.key, value: s.type === "password" ? t : t.trim() });
  };

  const admin = me.person.admin;
  const buttons: { fk: string; label: string; icon: JSX.Element; act: () => void; primary?: boolean; danger?: boolean }[] = [];
  if (admin && !a.error) {
    if (!a.installed) buttons.push({ fk: "addon-main", label: a.busy || busy ? "Getting it…" : "Get", icon: <Download />, act: get, primary: true });
    else {
      if (a.status === "update") buttons.push({ fk: "addon-main", label: "Update", icon: <Download />, act: async () => { if (await run("install")) ui.toast(`${a.name} updated`); }, primary: true });
      buttons.push({ fk: buttons.length ? "addon-power" : "addon-main", label: a.enabled ? "Turn off" : "Turn on", icon: <Power />, act: a.enabled ? () => run("disable") : turnOn, primary: !buttons.length });
      if (a.enabled) buttons.push({ fk: "addon-refresh", label: "Load again", icon: <RefreshCw />, act: async () => { await run("refresh"); ui.toast(`${a.name} is loading again`); } });
      if (!a.builtin) buttons.push({ fk: "addon-remove", label: "Remove", icon: <Trash2 />, act: remove, danger: true });
    }
  }
  return (
    <div className="page">
      <G fk="addon-page">
        <F fk="addon-back" className="back" onEnter={() => nav.back()}><ChevronLeft />Store</F>
        <div className="dinfo" style={{ maxWidth: "60rem" }}>
          <div className="tile" style={{ background: "none", padding: 0, minHeight: 0 }}>
            <div className="head"><span className="ico" style={{ width: "3.6rem", height: "3.6rem" }}>{icon(a)}</span><div><h1>{a.name}</h1><small style={{ fontSize: "1rem" }}>{state(a)} · version {a.version || a.storeVersion} · by {a.author}</small></div></div>
          </div>
          {buttons.length > 0 && (
            <G fk="addon-buttons" className="actions">
              {buttons.map((b) => <F key={b.fk} fk={b.fk} className={"btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : "")} onEnter={b.act}>{b.icon}{b.label}</F>)}
            </G>
          )}
          <p className="overview" style={{ WebkitLineClamp: 12 }}>{a.description}</p>
          {a.error && <p className="status">{a.error}</p>}
          {a.internet && <p className="note">{a.hosts.length ? `Fetches from ${a.hosts.join(", ")}${a.hostsFromSettings ? " and the addresses in its settings" : ""}.` : "Fetches only from the addresses in its settings."} It can't open the server's files or run programs.</p>}
        </div>
        {a.installed && a.settings.length > 0 && (
          <>
            <h2 className="section-title">Settings</h2>
            <G fk="addon-settings" className="list">
              {a.settings.map((s) => (
                <F key={s.key} fk={`set-${s.key}`} className="item" onEnter={() => edit(s)}>
                  {s.type === "password" ? <KeyRound /> : s.type === "list" ? <List /> : <Type />}
                  <div className="grow">{s.label}{s.help && <small>{s.help}</small>}</div>
                  <span className="val">{s.type === "password" ? (s.value ? "••••••••" : "Not set") : s.type === "list" ? `${(s.value as string[]).length} added` : String(s.value || "Not set")}</span>
                </F>
              ))}
            </G>
            {a.settings.find((s) => s.type === "list") && Array.isArray(a.settings.find((s) => s.type === "list")!.value) && (
              <p className="note">{(a.settings.find((s) => s.type === "list")!.value as string[]).join("\n")}</p>
            )}
          </>
        )}
        {admin && a.log.length > 0 && (
          <>
            <h2 className="section-title">What it said lately</h2>
            <pre className="note" style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{a.log.join("\n")}</pre>
          </>
        )}
      </G>
    </div>
  );
}
