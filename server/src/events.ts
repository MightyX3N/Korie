// Telling clients that something changed (library, add-on rows, scan status),
// over Server-Sent Events: the client keeps one connection open and fetches
// again what it shows when told.
import type { ServerResponse } from "node:http";

const clients = new Set<ServerResponse>();
const pending = new Set<string>();
let timer: NodeJS.Timeout | null = null;

export function subscribe(res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 3000\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  res.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

/** what: "library" | "status" | "browse" | "store" | "addons" | "people" — sent at most every 300 ms. */
export function emit(what: string): void {
  pending.add(what);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const msg = `data: ${JSON.stringify([...pending])}\n\n`;
    pending.clear();
    for (const c of clients) c.write(msg);
  }, 300);
}
