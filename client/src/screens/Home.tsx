import type { Row } from "../api.ts";
import { Rows } from "../cards.tsx";
import { useData } from "../data.ts";
import { Status, Top, useOpener } from "./common.tsx";

export function Home() {
  const { data, error } = useData<{ rows: Row[]; empty: boolean; scanning: boolean; status: string }>("/api/home", ["library", "browse", "status"]);
  const { open, menu } = useOpener();
  return (
    <div className="page">
      <Top title="Home" date />
      {error && <Status text={error} />}
      {data && <Rows rows={data.rows} fk="home" onOpen={open} onMenu={menu} />}
      {data?.empty && <Status text={data.scanning ? "Looking through your folders…" : "Nothing here yet. Add folders with films, series or music in Settings → Libraries, or get add-ons in the Store."} />}
    </div>
  );
}
