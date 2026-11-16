// Apps on the Android TV box (Korie as the launcher): opens them.
import { androidApps } from "../host.ts";
import { F, G } from "../focus.tsx";
import { Status, Top } from "./common.tsx";
import type { Me } from "../App.tsx";
import { useEffect } from "react";
import { api } from "../api.ts";

export function Apps({ me }: { me: Me }) {
  const allowed = me.person.apps ?? "all";
  const every = androidApps();
  const apps = every.filter((a) => allowed === "all" || allowed.includes(a.pkg));
  // the server learns which apps this TV has, so an admin can choose who may open which
  useEffect(() => {
    if (every.length) api("/api/apps", { apps: every.map((a) => ({ pkg: a.pkg, label: a.label })) }).catch(() => {});
  }, [every.length]);
  return (
    <div className="page">
      <Top title="Apps" />
      <G fk="apps" className="grid" style={{ "--card-w": "11rem" } as React.CSSProperties}>
        {apps.map((a, i) => (
          <F key={a.pkg} fk={`app-${i}`} className="card wide" onEnter={() => window.KorieAndroid?.launch(a.pkg)}>
            <div className="pic" style={{ display: "grid", placeItems: "center", background: "var(--panel)" }}>
              {a.icon && <img src={a.icon} alt="" style={{ width: "45%", height: "auto", objectFit: "contain" }} />}
            </div>
            <div className="t">{a.label}</div>
          </F>
        ))}
      </G>
      {!apps.length && <Status text="No apps found." />}
    </div>
  );
}
