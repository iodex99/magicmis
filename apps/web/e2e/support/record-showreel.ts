/**
 * Renders the thirty-second showreel (docs/brand/showreel/index.html) to video, with its
 * soundtrack, frame by frame.
 *
 * The same method as the tour (record-tour.ts, ADR 0041): the page is a pure function of
 * time, so each frame is asked for by `window.__seek(t)` and screenshotted rather than
 * filmed. The music is built against the same beat grid and rendered offline in the page
 * (`window.__score()` returns a WAV), so picture and sound cannot drift.
 *
 * Unlike the tour this needs an ffmpeg with H.264, AAC, VP9 and Opus. Playwright's own build
 * encodes VP8 only and has no audio encoder, so point FFMPEG at a full build or put one on
 * the PATH:
 *
 *   FFMPEG=/path/to/ffmpeg pnpm --filter @magicmis/web exec tsx e2e/support/record-showreel.ts [fps]
 *
 * Writes docs/brand/showreel/out/showreel.mp4 (H.264 + AAC, for sharing anywhere),
 * showreel.webm (VP9 + Opus, for a web page) and showreel-poster.png, the final frame.
 * `out/` is ignored by git: the source is the page, and the video is reproducible from it.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const WIDTH = 1920;
const HEIGHT = 1080;

// Frames, not money: parsed and counted in whole numbers all the same.
const fps = Number.parseInt(process.argv[2] ?? "60", 10);
if (!Number.isInteger(fps) || fps < 24 || fps > 60) throw new Error("fps must be 24–60");

const repo = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const source = path.join(repo, "docs", "brand", "showreel", "index.html");
const outDir = path.join(repo, "docs", "brand", "showreel", "out");
const ffmpegPath = process.env["FFMPEG"] ?? "ffmpeg";

type Reel = {
  __duration: number;
  __ready: Promise<unknown>;
  __seek: (t: number) => void;
  __score: () => Promise<{ wav: string; peak: number }>;
};

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // `?still` stops the page playing itself; every frame below is asked for by time.
  await page.goto(`${pathToFileURL(source).href}?still`);
  await page.evaluate(() => (window as unknown as Reel).__ready);
  const duration = await page.evaluate(() => (window as unknown as Reel).__duration);
  const seek = (t: number) =>
    page.evaluate((at) => {
      (window as unknown as Reel).__seek(at);
    }, t);

  const score = await page.evaluate(() => (window as unknown as Reel).__score());
  if (score.peak > 1) throw new Error(`the score clips (peak ${score.peak.toFixed(3)})`);
  const wav = path.join(outDir, "score.wav");
  writeFileSync(wav, Buffer.from(score.wav, "base64"));

  await seek(duration);
  await page.screenshot({ path: path.join(outDir, "showreel-poster.png"), type: "png" });

  const ffmpeg = spawn(
    ffmpegPath,
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
      "-i",
      wav,
      "-y",
      // MP4: plays everywhere a showreel is sent.
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "16",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "256k",
      "-shortest",
      path.join(outDir, "showreel.mp4"),
      // WebM: for a page, where the browser may not license H.264.
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      "28",
      "-row-mt",
      "1",
      "-deadline",
      "good",
      "-cpu-used",
      "4",
      "-c:a",
      "libopus",
      "-b:a",
      "160k",
      "-shortest",
      path.join(outDir, "showreel.webm"),
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const finished = once(ffmpeg, "close") as Promise<[number | null]>;

  const frames = Math.trunc(duration * fps);
  for (let i = 0; i < frames; i += 1) {
    await seek(i / fps);
    const still = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ffmpeg.stdin.write(still)) await once(ffmpeg.stdin, "drain");
    if (i % (fps * 3) === 0)
      process.stdout.write(`  ${Math.trunc((i * 100) / frames).toString()}%\n`);
  }
  ffmpeg.stdin.end();
  const [code] = await finished;
  rmSync(wav);
  if (code !== 0) throw new Error(`ffmpeg exited with ${String(code)}`);
  if (errors.length > 0) throw new Error(`the page threw:\n${errors.join("\n")}`);
  process.stdout.write(
    `recorded ${outDir} — ${frames.toString()} frames at ${fps.toString()} fps, ` +
      `score peak ${score.peak.toFixed(3)}\n`,
  );
} finally {
  await browser.close();
}
