// Writes server/secret.dat: the TMDb key, scrambled so it isn't readable in the
// files or by searching them for text. Not real security (the server has to be
// able to read it); it keeps the key out of the source and out of sight.
// Usage: node tools/make_secret.mjs <file with the key>   (secret.dat is never committed)
import fs from "node:fs";
import crypto from "node:crypto";
const key = Buffer.from(fs.readFileSync(process.argv[2], "utf8").trim());
const pad = crypto.createHash("sha256").update("korie:tmdb:v1").digest();
const nonce = crypto.randomBytes(8);
let stream = Buffer.alloc(0);
for (let i = 0; stream.length < key.length; i++) {
  const n = Buffer.alloc(4); n.writeUInt32LE(i);
  stream = Buffer.concat([stream, crypto.createHash("sha256").update(Buffer.concat([pad, nonce, n])).digest()]);
}
const out = new URL("../server/secret.dat", import.meta.url);
fs.writeFileSync(out, Buffer.concat([nonce, Buffer.from(key.map((b, i) => b ^ stream[i]))]));
console.log("wrote server/secret.dat");
