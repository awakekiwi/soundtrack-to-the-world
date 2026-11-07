import type { Station } from "./stations";

/**
 * Even-density dots, the way map apps declutter place names.
 *
 * Picture the globe divided into a grid. At level 0 the cells are big
 * (16° across); each level halves them. A station's "reveal level" is the
 * first level at which it's the best station left in its cell. Zoomed out,
 * only level-0 stations show (one per big cell); zooming in raises the level,
 * the cells shrink, and the next-best station in each new cell fades in. So
 * busy regions like Europe never turn into a solid carpet, while a lone
 * station in the Pacific is the best in its cell from the start and always
 * shows.
 */

export const MAX_LEVEL = 10;
const BASE_CELL_DEG = 16;

function cellKey(lat: number, lon: number, size: number) {
  const row = Math.floor((lat + 90) / size);
  // Cells stay roughly square: wider in degrees of longitude towards the poles
  const lonSize = size / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const col = Math.floor(((lon + 540) % 360) / lonSize); // longitude as 0–360
  return row * 100000 + col;
}

/**
 * Reveal level for each station (MAX_LEVEL means "only when zoomed right
 * in"). Only stations where include[i] is set take part; the rest get
 * 99. `rank` decides who wins a cell (higher shows first).
 */
export function revealLevels(stations: Station[], include: Uint8Array | null, rank: (s: Station) => number): Float32Array {
  const n = stations.length;
  const level = new Float32Array(n).fill(Infinity);
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (!include || include[i]) order.push(i);
  const score = order.map((i) => rank(stations[i]));
  const byRank = order.map((_, k) => k).sort((a, b) => score[b] - score[a]).map((k) => order[k]);

  for (let L = 0; L < MAX_LEVEL; L++) {
    const size = BASE_CELL_DEG / 2 ** L;
    const taken = new Set<number>();
    // Cells already held by stations revealed at earlier (coarser) levels
    for (const i of byRank) if (level[i] < L) taken.add(cellKey(stations[i].lat, stations[i].lon, size));
    for (const i of byRank) {
      if (level[i] !== Infinity) continue;
      const key = cellKey(stations[i].lat, stations[i].lon, size);
      if (!taken.has(key)) {
        taken.add(key);
        level[i] = L;
      }
    }
  }
  for (const i of byRank) if (level[i] === Infinity) level[i] = MAX_LEVEL;
  // Stations not taking part: a plain big number (graphics cards prefer it to Infinity)
  for (let i = 0; i < n; i++) if (level[i] === Infinity) level[i] = 99;
  return level;
}

/**
 * The level shown at a given camera distance (globe radius is 2). Default
 * view (~7.2) shows level 2: a light, even sprinkle. Zoomed right in to the
 * surface (2.12) shows everything.
 */
export function levelForDistance(d: number) {
  // Height above the surface (globe radius 2). With the 45° camera, one
  // screen pixel covers about 0.03 × h degrees, so this level keeps each
  // grid cell roughly 20 pixels across at every zoom.
  const h = Math.max(d - 2, 0.05);
  let level = 4.62 - Math.log2(h);
  // Right down at the surface, reveal everything that's left
  if (h < 0.3) level += ((0.3 - h) / 0.18) * 3.5;
  return Math.max(0, Math.min(MAX_LEVEL + 1, level));
}

/**
 * The directory often gives every station in a city the same city-centre
 * point, so dozens can sit exactly on top of each other. Spread those into a
 * small sunflower around the spot (the most-listened keeps the exact point),
 * so each can be seen and picked when zoomed in.
 */
export function unstack(stations: Station[]) {
  const order = stations.map((_, i) => i).sort((a, b) => rankPopular(stations[b]) - rankPopular(stations[a]));
  const count = new Map<string, number>();
  for (const i of order) {
    const s = stations[i];
    const key = `${s.lat.toFixed(2)},${s.lon.toFixed(2)}`;
    const k = count.get(key) ?? 0;
    count.set(key, k + 1);
    if (k === 0) continue;
    const r = 0.012 * Math.sqrt(k); // degrees
    const t = k * 2.39996; // golden angle: an even sunflower
    s.lat = Math.max(-89, Math.min(89, s.lat + r * Math.sin(t)));
    s.lon += (r * Math.cos(t)) / Math.max(0.3, Math.cos((s.lat * Math.PI) / 180));
  }
  return stations;
}

/** Who wins a cell: the most-listened, or the least in "hidden gems" mode */
export const rankPopular = (s: Station) => s.clicks + s.votes * 0.05;
export const rankQuiet = (s: Station) => -(s.clicks + s.votes * 0.05);
