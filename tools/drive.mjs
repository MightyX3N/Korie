// Drives Korie's web client like a person with a remote: node tools/drive.mjs <url> <WxH> "<steps>" <shot-prefix>
// steps: comma separated: right,left,up,down,enter,back,wait<ms>,shot:<name>,type:<text>,click:<css>,log
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? "playwright");
const [url, size, steps, prefix] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
await page.goto(url);
await page.waitForTimeout(800);
const keys = { right: "ArrowRight", left: "ArrowLeft", up: "ArrowUp", down: "ArrowDown", enter: "Enter", back: "Escape" };
for (const s of steps.split(",").filter(Boolean)) {
  if (keys[s]) { await page.keyboard.press(keys[s]); await page.waitForTimeout(160); }
  else if (s.startsWith("wait")) await page.waitForTimeout(Number(s.slice(4)) || 500);
  else if (s.startsWith("shot:")) await page.screenshot({ path: `${prefix}${s.slice(5)}.png` });
  else if (s.startsWith("type:")) { await page.keyboard.type(s.slice(5)); await page.waitForTimeout(200); }
  else if (s.startsWith("click:")) { await page.click(s.slice(6)); await page.waitForTimeout(300); }
  else if (s === "log") console.log(await page.evaluate(() => document.querySelector(".focused")?.textContent?.slice(0, 60) ?? "(nothing focused)"));
  else if (/^\d+x[a-z]+$/.test(s)) { const [n, k] = [Number(s.split("x")[0]), s.split("x")[1]]; for (let i = 0; i < n; i++) { await page.keyboard.press(keys[k]); await page.waitForTimeout(120); } }
}
for (const l of logs) console.log(l);
await browser.close();
