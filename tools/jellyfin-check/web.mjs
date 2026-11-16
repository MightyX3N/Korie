// Uses Jellyfin's own web app (served by the server under test) in Chrome: signs in, opens Films,
// opens a film, plays it, then Series → season → episode. Logs every request that failed and every
// script error, and takes a screenshot at each step.  node web.mjs <base> <user> <password> <outdir>
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const [base, user, pw, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const log = [];
const note = (s) => { log.push(s); console.log(s); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--window-size=1600,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const bad = [];
page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/socket")) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(base, "").split("?")[0]}`); });
page.on("pageerror", (e) => bad.push("script error: " + e.message.split("\n")[0] + " @ " + String(e.stack).split("\n").slice(1, 6).map((x) => x.trim().replace(/https?:\/\/[^/]+\/web\//, "")).join(" < ")));
let n = 0;
const shot = async (name) => { await new Promise((r) => setTimeout(r, 1500)); await page.screenshot({ path: `${out}/${String(++n).padStart(2, "0")}_${name}.png` }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (sel, text) => {
  const ok = await page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && e.textContent.trim().toLowerCase().includes(text.toLowerCase()));
    if (el) { el.click(); return true; }
    return false;
  }, sel, text);
  if (!ok) throw new Error(`nothing to click: ${sel} "${text}"`);
};

try {
  await page.goto(base + "/web/", { waitUntil: "networkidle2", timeout: 60000 });
  await wait(3000);
  await shot("start");
  // sign in: pick the person if they're listed, otherwise type the name
  const manual = await page.$("#txtManualName");
  if (manual && await manual.isIntersectingViewport()) {
    await page.type("#txtManualName", user);
    if (pw) await page.type("#txtManualPassword", pw);
    await page.keyboard.press("Enter");
  } else {
    await clickText(".cardBox, .card, button", user);
    await wait(1500);
    if (pw) { await page.type("#txtManualPassword", pw); }
    const submit = await page.$(".manualLoginForm button[type=submit]");
    if (submit && await submit.isIntersectingViewport()) await submit.click();
  }
  await wait(5000);
  note("after sign-in: " + page.url().replace(base, ""));
  await shot("home");
  const home = await page.evaluate(() => [...document.querySelectorAll(".sectionTitle, .sectionTitle-cards")].map((e) => e.textContent.trim()).filter(Boolean));
  note("home sections: " + JSON.stringify(home));
  await clickText("a, button", "Films");
  await wait(4000);
  await shot("films");
  const films = await page.evaluate(() => [...document.querySelectorAll(".cardText-first, .cardText")].map((e) => e.textContent.trim()).filter(Boolean));
  note("films listed: " + JSON.stringify([...new Set(films)]));
  await clickText(".cardText-first a, .cardText a, .card a", "Sintel");
  await wait(4000);
  await shot("film_page");
  const title = await page.evaluate(() => document.querySelector(".itemName, h1, h3.itemName-primary")?.textContent?.trim());
  note("film page title: " + title);
  await page.evaluate(() => (document.querySelector(".btnPlay:not(.hide), .btnResume:not(.hide), button[data-action=resume], button[data-action=play]"))?.click());
  await wait(9000);
  const v = await page.evaluate(() => { const v = document.querySelector("video"); return v ? { src: v.currentSrc.replace(location.origin, "").split("?")[0], t: v.currentTime, paused: v.paused, err: v.error?.message ?? null, w: v.videoWidth } : null; });
  note("video after 9 s: " + JSON.stringify(v));
  await shot("playing");
  await wait(4000);
  const v2 = await page.evaluate(() => { const v = document.querySelector("video"); return v ? { t: v.currentTime, paused: v.paused } : null; });
  note("video 4 s later: " + JSON.stringify(v2));
  await page.keyboard.press("Escape"); await page.goBack(); await wait(2500);
  await page.goto(base + "/web/#/home", { waitUntil: "networkidle2" }); await wait(3500);
  await clickText("a, button", "Series");
  await wait(4000);
  await shot("series");
  await clickText(".cardText-first a, .cardText a, .card a", "Arcane");
  await wait(4000);
  await shot("series_page");
  const seasons = await page.evaluate(() => [...document.querySelectorAll(".cardText-first, .cardText")].map((e) => e.textContent.trim()).filter(Boolean));
  note("series page cards: " + JSON.stringify([...new Set(seasons)]));
  await clickText(".cardText-first a, .cardText a, .card a", "Season 1");
  await wait(4000);
  await shot("season");
  const eps = await page.evaluate(() => [...document.querySelectorAll(".listItemBodyText, .cardText-first")].map((e) => e.textContent.trim()).filter(Boolean));
  note("season 1 lists: " + JSON.stringify([...new Set(eps)]));
} catch (e) {
  note("STOPPED: " + e.message);
  await shot("stopped");
}
note("failed requests / errors: " + JSON.stringify([...new Set(bad)], null, 1));
fs.writeFileSync(`${out}/log.txt`, log.join("\n"));
await browser.close();
