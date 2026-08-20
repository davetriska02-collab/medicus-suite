/* Capture each mock frame to /opt/cursor/artifacts/screenshots/ */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = resolve(here, "mock.html");
const outDir = process.argv[2] || "/opt/cursor/artifacts/screenshots";
const frames = [
  "today",
  "pulse-scan",
  "pulse-why",
  "act-stage",
  "act-confirm",
  "thread",
  "silent",
  "composed",
  "colorblind",
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-gpu"],
});

const page = await browser.newPage({
  viewport: { width: 1320, height: 980 },
  deviceScaleFactor: 2,
});

for (const id of frames) {
  await page.goto("file://" + html + "?shot=" + id, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".frame.is-on .desk");
  const el = await page.locator(".frame.is-on");
  await el.screenshot({
    path: resolve(outDir, `triage-${id}.png`),
    animations: "disabled",
  });
  console.log("wrote triage-" + id + ".png");
}

await browser.close();
