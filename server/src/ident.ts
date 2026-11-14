import crypto from "node:crypto";
import { SECRET } from "./config.ts";

/** A stable id for this server (so a client remembers which one it picked). */
export function serverId(): string {
  return crypto.createHash("sha256").update(SECRET).update("id").digest("hex").slice(0, 16);
}
