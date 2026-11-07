#!/usr/bin/env node
/**
 * Builds public/data/stations.json: the whole Radio Browser directory,
 * trimmed to what the app uses, so the globe can show every station from
 * one compact, cacheable file instead of asking the directory page by page.
 *
 * Runs in the GitHub deploy workflow once a day (and on every push). You can
 * also run it locally:  node scripts/build-snapshot.mjs
 *
 * No dependencies: plain Node 18+.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../public/data/stations.json");

// RB_MIRRORS can override the servers (used for testing)
const MIRRORS = (process.env.RB_MIRRORS ||
  "https://de1.api.radio-browser.info,https://fi1.api.radio-browser.info,https://nl1.api.radio-browser.info,https://de2.api.radio-browser.info"
).split(",");
const PAGE = 10000;
const UA = "SoundtrackToTheWorld/1.0 (+https://github.com/awakekiwi/soundtrack-to-the-world)";

async function getPage(offset) {
  const qs = new URLSearchParams({
    hidebroken: "true",
    order: "clickcount",
    reverse: "true",
    limit: String(PAGE),
    offset: String(offset),
  });
  let lastErr;
  for (const base of MIRRORS) {
    try {
      const res = await fetch(`${base}/json/stations/search?${qs}`, { headers: { "User-Agent": UA } });
      if (res.ok) return await res.json();
      lastErr = new Error(`${base} answered ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const clip = (s, n) => (s || "").trim().slice(0, n);
const round = (n) => Math.round(n * 10000) / 10000;

function keep(s) {
  const url = s.url_resolved || "";
  if (!/^https?:\/\//.test(url) || s.lastcheckok === 0 || !(s.name || "").trim()) return false;
  const geo = s.geo_lat != null && s.geo_long != null && !(s.geo_lat === 0 && s.geo_long === 0);
  return geo || /^[A-Z]{2}$/i.test(s.countrycode || "");
}

// One row per station, as an array (no repeated field names), in this order:
export const FIELDS = [
  "stationuuid", "name", "url_resolved", "favicon", "homepage", "countrycode", "country", "state",
  "geo_lat", "geo_long", "tags", "language", "codec", "bitrate", "clickcount", "votes", "hls",
];

function toRow(s) {
  const geo = s.geo_lat != null && s.geo_long != null && !(s.geo_lat === 0 && s.geo_long === 0);
  return [
    s.stationuuid,
    clip(s.name, 120),
    s.url_resolved,
    clip(s.favicon, 300),
    clip(s.homepage, 200),
    (s.countrycode || "").toUpperCase(),
    clip(s.country, 60),
    clip(s.state, 60),
    geo ? round(s.geo_lat) : null,
    geo ? round(s.geo_long) : null,
    (s.tags || "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10).join(","),
    clip(s.language, 80),
    clip(s.codec, 12),
    s.bitrate || 0,
    s.clickcount || 0,
    s.votes || 0,
    s.hls ? 1 : 0,
  ];
}

async function main() {
  const started = Date.now();
  const rows = [];
  const seenUrl = new Set();
  let seen = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await getPage(offset);
    seen += page.length;
    for (const s of page) {
      if (!keep(s) || seenUrl.has(s.url_resolved)) continue; // drop duplicate streams
      seenUrl.add(s.url_resolved);
      rows.push(toRow(s));
    }
    console.log(`  fetched ${seen} so far, keeping ${rows.length}`);
    if (page.length < PAGE) break;
    await new Promise((r) => setTimeout(r, 500)); // be gentle with a volunteer service
  }
  if (rows.length < 1000) throw new Error(`Only ${rows.length} stations: something's wrong, not overwriting`);

  const json = JSON.stringify({ v: 1, at: new Date().toISOString(), fields: FIELDS, rows });
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, json);
  console.log(
    `Wrote ${rows.length} stations (from ${seen}) to public/data/stations.json: ` +
      `${(json.length / 1024 / 1024).toFixed(1)} MB raw, in ${((Date.now() - started) / 1000).toFixed(0)}s`
  );
}

main().catch((e) => {
  // Never fail the deploy over this: the app falls back to loading the
  // directory directly when the snapshot isn't there
  console.warn("Snapshot not built:", e.message || e);
  process.exitCode = 0;
});
