// Finding the server on the network: a client sends "KORIE_DISCOVER" by UDP
// broadcast to port 7361 and every Korie server answers with its name, id and
// web port. (Jellyfin does the same on 7359; Korie keeps out of its way.)
import dgram from "node:dgram";
import { DISCOVERY_PORT, PORT, VERSION, log } from "./config.ts";
import { setting } from "./db.ts";
import { serverId } from "./ident.ts";
import { jellyfinServerId } from "./jellyfin.ts";

/** Jellyfin's apps look for servers the same way, on UDP 7359 with "who is JellyfinServer?":
 *  Korie answers too, so they list it under Discovered servers. (If a Jellyfin server runs on the
 *  same machine and holds the port, Korie leaves it be: its apps can still type the address.) */
function startJellyfinDiscovery(): void {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("message", (msg, from) => {
    if (!/who is jellyfinserver\?/i.test(msg.toString("utf8"))) return;
    // the address of this machine as the asking device sees it
    const probe = dgram.createSocket("udp4");
    probe.connect(from.port, from.address, () => {
      const ip = probe.address().address;
      probe.close();
      const answer = JSON.stringify({ Address: `http://${ip}:${PORT}`, Id: jellyfinServerId(), Name: String(setting("server_name") || "Korie"), EndpointAddress: null });
      sock.send(answer, from.port, from.address);
    });
  });
  sock.on("error", (e) => log("discovery", `Jellyfin's apps can't find Korie by themselves (UDP 7359: ${e.message})`));
  sock.bind(7359, () => log("discovery", "answering Jellyfin's apps on UDP 7359"));
}

export function startDiscovery(): void {
  startJellyfinDiscovery();
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
