/**
 * Renders the product tour (docs/brand/explainer/index.html) to a video, frame by frame.
 *
 * The tour is a pure function of time — `window.__seek(t)` draws the frame for second `t` —
 * so this does not film a browser playing it. It asks for each frame in turn, screenshots
 * it, and pipes the stills to ffmpeg at a fixed rate. The result is exactly as smooth as the
 * frame rate, on any machine, however busy; filming CSS animations in real time is what made
 * the first version stutter (ADR 0041).
 *
 * ffmpeg is the build Playwright already downloads for its own video capture, so there is
 * nothing to install. It encodes VP8/WebM only, which every current desktop browser plays.
 *
 *   pnpm --filter @magicmis/web exec tsx e2e/support/record-tour.ts [fps]
 *
 * Writes public/brand/tour.webm and public/brand/tour-poster.png.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const WIDTH = 1280;
const HEIGHT = 720;
/** 1.25× the layout size: 1600×900 from a 720p stage, crisp full-screen at a third the bytes of 1080p. */
const SCALE = 1.25;
/** The still shown before anyone presses play: the finished workbook and dashboard. */
const POSTER_AT = 20.9;

// Frames, not money: parsed and counted in whole numbers all the same.
const fps = Number.parseInt(process.argv[2] ?? "30", 10);
if (!Number.isInteger(fps) || fps < 12 || fps > 60) throw new Error("fps must be 12–60");

const repo = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const source = path.join(repo, "docs", "brand", "explainer", "index.html");
const outDir = path.join(repo, "apps", "web", "public", "brand");

/** Playwright's own ffmpeg, wherever this platform keeps it. */
function findFfmpeg(): string {
  const home = os.homedir();
  const roots = [
    process.env["PLAYWRIGHT_BROWSERS_PATH"],
    process.env["LOCALAPPDATA"] === undefined
      ? undefined
      : path.join(process.env["LOCALAPPDATA"], "ms-playwright"),
    path.join(home, "Library", "Caches", "ms-playwright"),
    path.join(home, ".cache", "ms-playwright"),
  ].filter((r): r is string => r !== undefined && existsSync(r));
  for (const root of roots) {
    for (const dir of readdirSync(root).filter((d) => d.startsWith("ffmpeg-"))) {
      for (const name of ["ffmpeg-win64.exe", "ffmpeg-mac", "ffmpeg-linux"]) {
        const candidate = path.join(root, dir, name);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error(
    "Playwright's ffmpeg was not found; run `npx playwright install ffmpeg`",
  );
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: SCALE,
  });
  // `?still` stops the page playing itself; every frame below is asked for by time.
  await page.goto(`${pathToFileURL(source).href}?still`);
  await page.evaluate(() => document.fonts.ready);
  const duration = await page.evaluate(
    () => (window as unknown as { __duration: number }).__duration,
  );
  const seek = (t: number) =>
    page.evaluate((at) => {
      (window as unknown as { __seek: (t: number) => void }).__seek(at);
    }, t);

  await seek(POSTER_AT);
  await page.screenshot({ path: path.join(outDir, "tour-poster.png"), type: "png" });

  const out = path.join(outDir, "tour.webm");
  const ffmpeg = spawn(
    findFfmpeg(),
    [
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-c:v",
      "mjpeg",
      "-framerate",
      fps.toString(),
      "-i",
      "pipe:0",
      "-y",
      "-an",
      "-c:v",
      "vp8",
      // Flat colour and type compress well; the bitrate cap is what sets the file size
      // (about 1.2 Mbit/s × 32 s ≈ 4.5 MB), and the page only fetches it on play.
      "-qmin",
      "4",
      "-qmax",
      "40",
      "-crf",
      "10",
      "-b:v",
      "1200k",
      "-deadline",
      "good",
      "-cpu-used",
      "1",
      "-threads",
      "4",
      out,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const finished = once(ffmpeg, "close") as Promise<[number | null]>;

  const frames = Math.trunc(duration * fps);
  for (let i = 0; i <= frames; i += 1) {
    await seek(i / fps);
    const still = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ffmpeg.stdin.write(still)) await once(ffmpeg.stdin, "drain");
    if (i % (fps * 4) === 0)
      process.stdout.write(`  ${Math.trunc((i * 100) / frames).toString()}%\n`);
  }
  ffmpeg.stdin.end();
  const [code] = await finished;
  if (code !== 0) throw new Error(`ffmpeg exited with ${String(code)}`);
  process.stdout.write(
    `recorded ${out} — ${frames.toString()} frames at ${fps.toString()} fps\n`,
  );
} finally {
  await browser.close();
}
