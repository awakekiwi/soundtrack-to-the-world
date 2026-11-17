#!/usr/bin/env node
/**
 * Builds public/textures/clouds-live.jpg: today's real clouds, for the globe's
 * cloud layer.
 *
 * Source: EUMETSAT's "Geostationary Ring IR10.8" world cloud map, which joins
 * the infrared images of the weather satellites around the equator
 * (Meteosat, GOES, Himawari...) into one picture of the whole planet. It's
 * published every 3 hours. We use the image from at least 3 hours ago, which
 * EUMETSAT makes free of charge (see their data policy), and credit them in
 * the app.
 *
 * Infrared shows how cold things are: high cloud tops are cold (bright),
 * warm ground and sea are dark. That's turned into a soft white-on-black
 * cloud map like the static one. The polar caps, which the satellites can't
 * see, keep the static clouds.
 *
 * Runs with the station snapshot on every build (and every 3 hours by the
 * refresh workflow). Never fails the build: without it the app just uses
 * the static clouds. Run it locally:  node scripts/build-clouds.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../public/textures/clouds-live.jpg");
const INFO = resolve(here, "../public/data/clouds.json");
const STATIC = resolve(here, "../public/textures/clouds.jpg");

const W = 2048;
const H = 1024;
// CLOUDS_WMS can point elsewhere (used for testing)
const WMS = process.env.CLOUDS_WMS || "https://view.eumetsat.int/geoserver/wms";
const LAYER = "mumi:worldcloudmap_ir108";
const STEP_H = 3;
/** Only use images at least this old (EUMETSAT's free tier) */
const MIN_AGE_H = 3;
const UA = "SoundtrackToTheWorld/1.0 (+https://soundtracktotheworld.com)";

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The newest 3-hourly time that's at least 3 hours old */
function frameTimes() {
  const now = Date.now() - MIN_AGE_H * 3600e3;
  const step = STEP_H * 3600e3;
  const newest = Math.floor(now / step) * step;
  // If the newest isn't there yet, try a couple of older ones
  return [0, 1, 2].map((i) => new Date(newest - i * step).toISOString().replace(".000Z", "Z"));
}

async function fetchFrame(time) {
  const qs = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: LAYER,
    styles: "",
    crs: "CRS:84",
    bbox: "-180,-90,180,90",
    width: String(W),
    height: String(H),
    format: "image/png",
    transparent: "true",
    time,
  });
  const res = await fetch(`${WMS}?${qs}`, { headers: { "User-Agent": UA } });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/png")) throw new Error(`EUMETSAT answered ${res.status} ${type}`);
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  if (png.width !== W || png.height !== H) throw new Error(`unexpected size ${png.width}×${png.height}`);
  // A frame that's all transparent (not processed yet) is no use
  let seen = 0;
  for (let i = 3; i < png.data.length; i += 4 * 97) if (png.data[i] > 128) seen++;
  if (seen < 1000) throw new Error("frame is empty");
  return png;
}

/** The static cloud map, stretched to our size, for the polar caps */
async function staticClouds() {
  try {
    const img = jpeg.decode(await readFile(STATIC), { useTArray: true });
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(img.height - 1, Math.floor((y / H) * img.height));
      for (let x = 0; x < W; x++) {
        const sx = Math.min(img.width - 1, Math.floor((x / W) * img.width));
        out[y * W + x] = img.data[(sy * img.width + sx) * 4];
      }
    }
    return out;
  } catch {
    return new Uint8Array(W * H);
  }
}

async function main() {
  const started = Date.now();
  let png;
  let time;
  for (const t of frameTimes()) {
    try {
      png = await fetchFrame(t);
      time = t;
      break;
    } catch (e) {
      console.log(`  clouds ${t}: ${e.message}`);
    }
  }
  if (!png) throw new Error("no recent cloud map available");

  const fallback = await staticClouds();
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const a = Math.abs(lat);
    // Cold ground near the poles looks bright in infrared too: ask more of
    // it before calling it cloud
    const s = Math.min(1, (a / 75) ** 2);
    const lo = 110 + 36 * s;
    const hi = 202 + 22 * s;
    // Beyond about 70° the satellites see poorly: blend into static clouds
    const live = 1 - smooth(64, 74, a);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const seen = png.data[i + 3] / 255;
      const cloud = 255 * Math.pow(smooth(lo, hi, png.data[i]), 0.9);
      const w = live * seen;
      const v = Math.round(cloud * w + fallback[y * W + x] * (1 - w));
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  const jpg = jpeg.encode({ data: out, width: W, height: H }, 80);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, jpg.data);
  await mkdir(dirname(INFO), { recursive: true });
  await writeFile(INFO, JSON.stringify({ time, source: "EUMETSAT Geostationary Ring IR10.8" }));
  console.log(
    `Wrote live clouds from ${time} to public/textures/clouds-live.jpg: ` +
      `${(jpg.data.length / 1024).toFixed(0)} KB, in ${((Date.now() - started) / 1000).toFixed(0)}s`
  );
}

main().catch((e) => {
  // Never fail the build over this: the app uses the static clouds instead
  console.warn("Live clouds not built:", e.message || e);
  process.exitCode = 0;
});
