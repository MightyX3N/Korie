// Finding the server on the network: a client sends "KORIE_DISCOVER" by UDP
// broadcast to port 7361 and every Korie server answers with its name, id and
// web port. (Jellyfin does the same on 7359; Korie keeps out of its way.)
import dgram from "node:dgram";
import { DISCOVERY_PORT, PORT, VERSION, log } from "./config.ts";
import { setting } from "./db.ts";
import { serverId } from "./ident.ts";

export function startDiscovery(): void {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("message", (msg, from) => {
    if (msg.toString("utf8").trim() !== "KORIE_DISCOVER") return;
    const answer = JSON.stringify({ korie: true, id: serverId(), name: String(setting("server_name") || "Korie"), port: PORT, version: VERSION });
    sock.send(answer, from.port, from.address);
  });
  sock.on("error", (e) => log("discovery", `can't listen on UDP ${DISCOVERY_PORT}: ${e.message}`));
  sock.bind(DISCOVERY_PORT, () => {
    try {
      sock.setBroadcast(true);
    } catch {
      /* fine */
    }
    log("discovery", `answering on UDP ${DISCOVERY_PORT}`);
  });
}
