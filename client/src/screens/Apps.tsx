// Apps on the Android TV box (Korie as the launcher): opens them.
import { androidApps } from "../host.ts";
import { F, G } from "../focus.tsx";
import { Status, Top } from "./common.tsx";

export function Apps() {
  const apps = androidApps();
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
