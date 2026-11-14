// Fetching what a screen shows, and fetching it again when the server says
// that part changed (library, add-on rows, Store ...).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, onChange } from "./api.ts";

export function useData<T>(path: string | null, topics: string[] = []): { data: T | null; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    api<T>(path)
      .then((d) => {
        if (n === seq.current) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (n === seq.current) setError(e.message);
      });
  }, [path]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  useEffect(() => {
    if (!topics.length) return;
    let t = 0;
    return onChange((what) => {
      if (what.some((w) => topics.includes(w))) {
        clearTimeout(t);
        t = window.setTimeout(load, 150);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, topics.join(",")]);
  return { data, error, reload: load };
}
