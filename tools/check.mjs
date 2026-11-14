// Korie's check: starts a fresh server with a test library, the Store's
// add-ons and a stand-in RomM server, then goes through every screen like a
// person with a remote (keys only) at TV, desktop and phone sizes.
// node tools/check.mjs   (needs: python3 http.server on the store, fake RomM on 8090)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.PW ?? "playwright");
const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = process.env.CHECK_DATA ?? path.join(os.tmpdir(), "korie-check");
const SHOTS = path.join(ROOT, "shots/check");
const BASE = "http://127.0.0.1:8100";
const MEDIA = process.env.MEDIA ?? path.join(ROOT, "testmedia");
fs.rmSync(DATA, { recursive: true, force: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

// --- the server ------------------------------------------------------------------------
const server = spawn("node", ["--disable-warning=ExperimentalWarning", "src/main.ts"], {
  cwd: path.join(ROOT, "server"),
  env: { ...process.env, KORIE_DATA: DATA, KORIE_STORE: process.env.STORE ?? "http://127.0.0.1:8765/" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(BASE + "/api/hello")).ok) break;
  } catch { /* starting */ }
  await sleep(200);
}

async function api(p, body, token, method) {
  const r = await fetch(BASE + p, { method: method ?? (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

const people = await api("/api/people");
const { token } = await api("/api/login", { person: people[0].id, device: "check" });
for (const [kind, dir] of [["films", "Films"], ["series", "Series"], ["music", "Music"]]) await api("/api/folders", { path: `${MEDIA}/${dir}`, kind }, token);
await api("/api/addons", undefined, token);
await sleep(1500);
for (const id of ["korie.drtv", "korie.stremio", "korie.romm"]) {
  const r = await api("/api/addon/install", { id }, token);
  ok(`Store installs ${id}`, r.ok, r.error ?? "");
  await api("/api/addon/enable", { id, internet: true }, token);
}
for (const [k, v] of [["server", "127.0.0.1:8090"], ["username", "admin"], ["password", "secret pw"]]) await api("/api/addon/setting", { id: "korie.romm", key: k, value: v }, token);
// wait for the library and the add-ons' rows
for (let i = 0; i < 60; i++) {
  const s = await api("/api/settings", undefined, token);
  const live = await api("/api/live", undefined, token);
  if (!s.status.scanning && s.counts.film > 0 && live.rows?.length) break;
  await sleep(500);
}

// --- the client ---------------------------------------------------------------------------
const browser = await chromium.launch();
const problems = [];

async function session(form, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => problems.push(`${form}: page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(404|net::ERR)/.test(m.text())) problems.push(`${form}: console: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`${form}: ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/?form=${form}`);
  await page.waitForTimeout(700);
  return page;
}
const key = async (page, k, n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press({ right: "ArrowRight", left: "ArrowLeft", up: "ArrowUp", down: "ArrowDown", enter: "Enter", back: "Escape" }[k] ?? k);
    await page.waitForTimeout(140);
  }
};
const focused = (page) => page.evaluate(() => {
  const f = document.querySelector(".focused");
  return f ? { text: (f.textContent ?? "").trim().slice(0, 80), cls: f.className, rect: f.getBoundingClientRect().toJSON() } : null;
});
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + ".png") });
const go = async (page, name) => {
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.korieBack?.());
  await page.waitForTimeout(300);
  await page.evaluate((n) => [...document.querySelectorAll(".rail .nav")].find((e) => e.textContent?.trim() === n)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), name);
  await page.waitForTimeout(1000);
  await key(page, "right"); // from the menu into the content
  if ((await focused(page))?.cls.includes("pill")) await key(page, "down"); // past the pills
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// TV: the whole tour with the remote
{
  const page = await session("tv", 1920, 1080);
  await shot(page, "tv-01-profiles");
  await key(page, "enter");
  await page.waitForTimeout(1500);
  let f = await focused(page);
  ok("TV: after signing in, Home in the menu is focused", f?.text === "Home", f?.text);
  await shot(page, "tv-02-home");
  await key(page, "up", 3);
  f = await focused(page);
  ok("TV: the menu stops at its top", f?.text === "Home", f?.text);
  await key(page, "down", 15);
  f = await focused(page);
  ok("TV: the menu stops at its bottom (doesn't jump to the content)", f?.cls.includes("who"), f?.text);
  const railNames = await page.$$eval(".rail .nav span", (els) => els.map((e) => e.textContent));
  ok("TV: Games is in the menu when RomM is on", railNames.includes("Games"), railNames.join(", "));
  ok("TV: menu icons are drawn", (await page.$$eval(".rail .nav svg", (e) => e.length)) === railNames.length);
  await key(page, "up", 15);
  await key(page, "right");
  f = await focused(page);
  ok("TV: right from the menu goes into the content", f?.cls.includes("card"), f?.text);
  // scrolling to the bottom of Home, with room below the last row
  await key(page, "down", 14);
  f = await focused(page);
  ok("TV: the last row on Home is fully visible with room below", f && f.rect.bottom <= 1080 - 20, JSON.stringify(f?.rect));
  await shot(page, "tv-03-home-bottom");
  await key(page, "up", 14);
  const top = await page.$eval(".scroll", (e) => e.scrollTop);
  ok("TV: scrolling back up reaches the very top", top === 0, `scrollTop ${top}`);

  // Films: pills in one row, the remote moves through all of them
  await go(page, "Films");
  await key(page, "up", 2);
  const pills = [];
  for (let i = 0; i < 9; i++) {
    f = await focused(page);
    if (!f?.cls.includes("pill")) break;
    if (!pills.includes(f.text)) pills.push(f.text);
    await key(page, "right");
  }
  ok("TV: Films' pills go Your films → add-ons → filters → sort with right", pills.includes("Your films") && pills.includes("DRTV") && pills.includes("All") && pills.length >= 7, pills.join(" | "));
  await key(page, "left", pills.length - 1);
  f = await focused(page);
  ok("TV: and back left to the first pill", f?.text === "Your films", f?.text);
  await key(page, "left");
  f = await focused(page);
  ok("TV: left from the first pill goes to the menu", f?.cls.includes("nav"), f?.text);
  await shot(page, "tv-04-films");
  // DRTV's rows, down to "Netop tilføjet"
  await key(page, "right");
  while ((await focused(page))?.text !== "DRTV") await key(page, "right");
  await key(page, "enter");
  await page.waitForTimeout(1500);
  const rowTitles = await page.$$eval(".row h2", (e) => e.map((x) => x.textContent));
  ok("TV: DRTV under Films has its rows (with Netop tilføjet)", rowTitles.includes("Netop tilføjet"), rowTitles.slice(0, 5).join(", "));
  const genreTiles = await page.$$eval(".card.text", (e) => e.length);
  ok("TV: DRTV's genres show as labelled tiles", genreTiles > 0, `${genreTiles} tiles`);
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    await key(page, "down");
    reached = await page.evaluate(() => document.querySelector(".focused")?.closest(".row")?.querySelector("h2")?.textContent === "Netop tilføjet");
  }
  ok("TV: Netop tilføjet can be reached with down", reached);
  await shot(page, "tv-05-drtv");
  await key(page, "enter");
  await page.waitForTimeout(1500);
  f = await focused(page);
  ok("TV: a DRTV film's page opens with Play focused", /^(Play|Resume)/.test(f?.text ?? ""), f?.text);
  await shot(page, "tv-05b-drtv-film");

  // a film of your own: opens with Play focused, plays, Back returns to it
  await go(page, "Films");
  for (let i = 0; i < 8 && !(await focused(page))?.text.startsWith("Nosferatu"); i++) await key(page, "right");
  await key(page, "enter");
  await page.waitForTimeout(1500);
  f = await focused(page);
  ok("TV: a film's page opens with Play focused (not Back)", /^(Play|Resume)/.test(f?.text ?? ""), f?.text);
  await shot(page, "tv-06-film");
  await key(page, "enter");
  await page.waitForTimeout(4000);
  const t1 = await page.$eval("video", (v) => v.currentTime).catch(() => -1);
  await page.waitForTimeout(1500);
  const t2 = await page.$eval("video", (v) => v.currentTime).catch(() => -1);
  ok("TV: the film plays", t2 > t1 && t1 >= 0, `${t1.toFixed?.(1)} → ${t2.toFixed?.(1)}`);
  await shot(page, "tv-07-player");
  const shown = async () => page.$eval(".seek span", (e) => e.textContent).catch(() => "");
  const before = await shown();
  await key(page, "right");
  await page.waitForTimeout(2500);
  const after = await shown();
  const secs = (t) => t.split(":").reduce((a, b) => a * 60 + Number(b), 0);
  ok("TV: right jumps forward 30 seconds", secs(after) >= secs(before) + 20, `${before} → ${after}`);
  await key(page, "back");
  await page.waitForTimeout(1200);
  f = await focused(page);
  ok("TV: Back leaves the player and returns to the film's page", /^(Play|Resume|From)/.test(f?.text ?? "") && !(await page.$("video")), f?.text);

  // a series: Play focused, real episode titles, then the episodes
  await go(page, "Series");
  await key(page, "enter");
  await page.waitForTimeout(1500);
  f = await focused(page);
  ok("TV: a series' page opens with Play focused", /^(Play|Resume)/.test(f?.text ?? ""), f?.text);
  const epTitles = await page.$$eval(".ep .tt", (e) => e.map((x) => x.textContent));
  ok("TV: episodes have their real titles", epTitles.length > 0 && epTitles.every((t) => t && t.length > 2), epTitles.join(" | "));
  await key(page, "down", 2);
  f = await focused(page);
  ok("TV: down from Play reaches the seasons and episodes", f?.cls.includes("pill") || f?.cls.includes("ep"), f?.text);
  await shot(page, "tv-08-series");
  await key(page, "down");
  await key(page, "enter");
  await page.waitForTimeout(4000);
  const tEp = await page.$eval("video", (v) => v.currentTime).catch(() => -1);
  ok("TV: an episode plays", tEp > 0, `${tEp}`);
  await key(page, "back");
  await page.waitForTimeout(800);

  // music: an album plays
  await go(page, "Music");
  await key(page, "down");
  await key(page, "enter");
  await page.waitForTimeout(1200);
  f = await focused(page);
  ok("TV: an album's page opens with Play focused", f?.text === "Play", f?.text);
  await shot(page, "tv-09-album");
  await key(page, "enter");
  await page.waitForTimeout(3500);
  const tMusic = await page.$eval("video", (v) => v.currentTime).catch(() => -1);
  ok("TV: music plays", tMusic > 0, `${tMusic}`);
  await shot(page, "tv-09b-music");
  await key(page, "back");
  await page.waitForTimeout(600);

  // every section opens without errors
  for (const [i, name] of ["Home", "Films", "Series", "Live TV", "Games", "Music", "Search", "Store", "Settings"].entries()) {
    await page.evaluate(() => window.korieBack?.());
    await page.waitForTimeout(200);
    await page.evaluate((n) => [...document.querySelectorAll(".rail .nav")].find((e) => e.textContent?.trim() === n)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), name);
    await page.waitForTimeout(1200);
    const h1 = await page.$eval(".main h1", (e) => e.textContent).catch(() => "");
    const status = await page.$eval(".main .status", (e) => e.textContent).catch(() => "");
    ok(`TV: ${name} opens`, name === "Search" ? true : h1 === name || (name === "Live TV" && h1 === "Live TV"), `${h1}${status ? " · " + status.slice(0, 80) : ""}`);
    await shot(page, `tv-10-${i}-${name.replace(" ", "")}`);
  }
  // Live TV has channels; Games has RomM's rows
  await page.evaluate(() => [...document.querySelectorAll(".rail .nav")].find((e) => e.textContent?.trim() === "Live TV")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(1000);
  const ch = await page.$$eval(".card", (e) => e.map((x) => x.textContent));
  ok("TV: Live TV lists DR's channels", ch.some((t) => t?.includes("DR1")), ch.slice(0, 4).join(", "));
  await page.evaluate(() => [...document.querySelectorAll(".rail .nav")].find((e) => e.textContent?.trim() === "Games")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(1000);
  const games = await page.$$eval(".row h2", (e) => e.map((x) => x.textContent));
  ok("TV: Games has RomM's rows", games.includes("New games") && games.includes("Super Nintendo"), games.join(", "));
  // Search with the remote's keyboard and a real keyboard
  await page.evaluate(() => [...document.querySelectorAll(".rail .nav")].find((e) => e.textContent?.trim() === "Search")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(600);
  await page.keyboard.type("golf");
  await page.waitForTimeout(3000);
  const groups = await page.$$eval(".row h2", (e) => e.map((x) => x.textContent));
  ok("TV: Search finds things in add-ons (RomM's Tiny Golf)", groups.some((g) => g?.startsWith("RomM")), groups.join(", "));
  await shot(page, "tv-11-search");
  // the Store and an add-on's page
  await page.evaluate(() => [...document.querySelectorAll(".rail .nav")].find((e) => e.textContent?.trim() === "Store")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(800);
  const tiles = await page.$$eval(".tile h3", (e) => e.map((x) => x.textContent));
  ok("TV: the Store lists DRTV, RomM and Stremio", ["DRTV", "RomM", "Stremio"].every((n) => tiles.includes(n)), tiles.join(", "));
  ok("TV: every Store tile has an icon", (await page.$$eval(".tile .ico svg", (e) => e.length)) === tiles.length);
  await page.evaluate(() => [...document.querySelectorAll(".tile")].find((e) => e.textContent?.includes("RomM"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(1000);
  const settings = await page.$$eval(".item .grow", (e) => e.map((x) => x.textContent));
  ok("TV: RomM's page shows its settings (password as dots)", settings.some((s) => s?.startsWith("RomM server")) && (await page.content()).includes("••••"), settings.join(" | "));
  f = await focused(page);
  ok("TV: an add-on's page opens on its main button", f?.cls.includes("btn"), f?.text);
  await shot(page, "tv-12-romm");
  await page.close();
}

// Games disappears when RomM is off
{
  await api("/api/addon/disable", { id: "korie.romm" }, token);
  const page = await session("tv", 1920, 1080);
  await key(page, "enter");
  await page.waitForTimeout(1200);
  const railNames = await page.$$eval(".rail .nav span", (els) => els.map((e) => e.textContent));
  ok("Games isn't in the menu without a games add-on", !railNames.includes("Games"), railNames.join(", "));
  await page.close();
  await api("/api/addon/enable", { id: "korie.romm", internet: true }, token);
}

// desktop and phone: layouts fit, no sideways scrolling, every section
for (const [form, w, h] of [["desktop", 1366, 768], ["desktop", 2560, 1440], ["phone", 412, 915]]) {
  const page = await session(form, w, h);
  await key(page, "enter");
  await page.waitForTimeout(1500);
  for (const name of ["Home", "Films", "Series", "Search"]) {
    await page.evaluate((n) => [...document.querySelectorAll(".rail .nav")].find((e) => e.textContent?.trim() === n)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), name);
    await page.waitForTimeout(1000);
    ok(`${form} ${w}x${h}: ${name} fits the width`, await noOverflow(page));
    await shot(page, `${form}-${w}-${name}`);
  }
  if (form === "phone") {
    const tabs = await page.$$eval(".rail .nav span", (e) => e.map((x) => x.textContent));
    ok("phone: tabs at the bottom (Home, Films, Series, Search, More)", tabs.join(",") === "Home,Films,Series,Search,More", tabs.join(","));
    const railBox = await page.$eval(".rail", (e) => e.getBoundingClientRect().toJSON());
    ok("phone: the tab bar is at the bottom", railBox.bottom >= h - 2 && railBox.top > h / 2, JSON.stringify(railBox));
  }
  await page.close();
}

ok("no page errors, console errors or server errors", problems.length === 0, problems.slice(0, 8).join(" || "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(path.join(SHOTS, "result.json"), JSON.stringify({ results, problems, serverLog: serverLog.split("\n").slice(-60) }, null, 2));
await browser.close();
server.kill();
process.exit(failed.length ? 1 : 0);
