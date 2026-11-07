import { BUILTIN_STATIONS as EXTRA_STATIONS } from "./builtinStations";
import { COUNTRY_CENTRES, SPREAD_DEG } from "./countryCentres";
import { PROXY_URL } from "./config";

// Station directory: Radio Browser (radio-browser.info), a free, open,
// community-run list of internet radio stations. No API key needed. It's run
// by volunteers "without guarantee", so we try a few mirrors in turn.
// (Same source and approach as Sun Chaser's local radio.)

export const MIRRORS = [
  "https://de1.api.radio-browser.info",
  "https://fi1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
];

export interface Station {
  id: string;
  name: string;
  url: string;
  favicon?: string;
  homepage?: string;
  country?: string;
  countryCode?: string;
  state?: string;
  lat: number;
  lon: number;
  tags: string[];
  languages: string[];
  codec?: string;
  bitrate?: number;
  /** Listens in the last day (the directory's own popularity measure) */
  clicks: number;
  votes: number;
  family: FamilyId;
  /** Streams in chunks (HLS, .m3u8) rather than one continuous stream */
  hls?: boolean;
  /** Your own station that you've shared to the Radio Browser directory */
  sharedAt?: number;
  /** The directory didn't say exactly where it is: placed somewhere in its country */
  approx?: boolean;
}

interface ApiStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  favicon: string;
  homepage: string;
  country: string;
  countrycode: string;
  state: string;
  geo_lat: number | null;
  geo_long: number | null;
  tags: string;
  language: string;
  codec: string;
  bitrate: number;
  clickcount: number;
  votes: number;
  hls: number;
  lastcheckok: number;
}

// ---------------------------------------------------------------------------
// Sound families: the directory's free-form tags squeezed into a handful of
// colours for the globe. A station joins whichever family most of its tags
// point to (ties go to the earlier family in this list).
// ---------------------------------------------------------------------------

export type FamilyId =
  | "electronic"
  | "chill"
  | "rock"
  | "jazz"
  | "hiphop"
  | "classical"
  | "world"
  | "pop"
  | "talk"
  | "eclectic";

export interface Family {
  id: FamilyId;
  label: string;
  color: string;
  words: string[];
}

export const FAMILIES: Family[] = [
  { id: "electronic", label: "Electronic", color: "#39e6ff", words: ["electronic", "techno", "house", "trance", "edm", "dance", "dubstep", "drum and bass", "dnb", "drum'n'bass", "electro", "breakbeat", "psytrance", "goa", "synthwave", "idm", "minimal", "club"] },
  { id: "chill", label: "Chill & ambient", color: "#7aa8ff", words: ["ambient", "chill", "chillout", "lounge", "downtempo", "lofi", "lo-fi", "new age", "meditation", "relax", "relaxation", "easy listening", "space", "drone", "sleep"] },
  { id: "rock", label: "Rock & alt", color: "#ff5d4f", words: ["rock", "metal", "punk", "alternative", "indie", "grunge", "hard rock", "classic rock", "psychedelic", "progressive", "shoegaze", "post-rock", "garage"] },
  { id: "jazz", label: "Jazz, blues & soul", color: "#ffb547", words: ["jazz", "blues", "soul", "funk", "rnb", "r&b", "motown", "swing", "bebop", "smooth jazz", "gospel", "disco"] },
  { id: "hiphop", label: "Hip hop & reggae", color: "#c6f53e", words: ["hip hop", "hiphop", "hip-hop", "rap", "reggae", "dancehall", "dub", "ska", "trap", "grime", "afrobeat", "afrobeats"] },
  { id: "classical", label: "Classical", color: "#b9a1ff", words: ["classical", "opera", "baroque", "orchestra", "symphony", "chamber", "piano", "early music", "choral", "contemporary classical"] },
  { id: "world", label: "World & folk", color: "#4fdc84", words: ["folk", "world", "world music", "latin", "salsa", "cumbia", "african", "celtic", "traditional", "bossa nova", "samba", "flamenco", "country", "bluegrass", "tango", "bachata", "reggaeton", "mpb", "bollywood", "arabic", "balkan", "andean", "maori", "pacific", "polynesian", "kpop", "j-pop", "city pop", "enka"] },
  { id: "pop", label: "Pop & hits", color: "#ff70b8", words: ["pop", "top 40", "hits", "oldies", "80s", "90s", "70s", "60s", "00s", "charts", "adult contemporary", "variety hits", "top40", "classic hits"] },
  { id: "talk", label: "Talk & community", color: "#f3ead8", words: ["news", "talk", "information", "community", "college", "university", "student", "public radio", "culture", "spoken", "spoken word", "sport", "sports", "podcast", "politics", "conspiracy", "comedy", "storytelling", "freeform", "public"] },
  { id: "eclectic", label: "Eclectic & other", color: "#9aa0c4", words: ["eclectic", "variety", "experimental", "avant-garde", "noise", "underground", "independent", "mixed", "various"] },
];

export const FAMILY_BY_ID = Object.fromEntries(FAMILIES.map((f) => [f.id, f])) as Record<FamilyId, Family>;

function familyFor(tags: string[]): FamilyId {
  if (tags.length === 0) return "eclectic";
  let best: FamilyId = "eclectic";
  let bestScore = 0;
  for (const f of FAMILIES) {
    let score = 0;
    for (const t of tags) {
      if (f.words.includes(t)) score += 2;
      else if (f.words.some((w) => w.length > 3 && t.includes(w))) score += 1;
    }
    if (score > bestScore) {
      best = f.id;
      bestScore = score;
    }
  }
  return best;
}

// Plain http:// streams are blocked on a secure page, so they're only kept
// when the helper Worker is set up to relay them. Stations with no exact
// location are kept too and placed in their country. HLS is fine: the
// player handles it. Entries known to be broken are dropped.
const ALLOW_HTTP = !!PROXY_URL || (typeof location !== "undefined" && location.protocol === "http:");

function hasGeo(s: ApiStation) {
  return s.geo_lat != null && s.geo_long != null && Math.abs(s.geo_lat) <= 90 && Math.abs(s.geo_long) <= 180 && !(s.geo_lat === 0 && s.geo_long === 0);
}

function playable(s: ApiStation) {
  const url = s.url_resolved || "";
  return (
    (url.startsWith("https://") || (ALLOW_HTTP && url.startsWith("http://"))) &&
    s.lastcheckok !== 0 &&
    !!s.name?.trim() &&
    (hasGeo(s) || !!COUNTRY_CENTRES[(s.countrycode || "").toUpperCase()])
  );
}

// Same station, same spot, every time: a scatter point from its id
function scatter(id: string) {
  let h1 = 2166136261, h2 = 16777619;
  for (let i = 0; i < id.length; i++) {
    h1 = Math.imul(h1 ^ id.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + id.charCodeAt(i), 2654435761);
  }
  return [((h1 >>> 0) % 10000) / 10000, ((h2 >>> 0) % 10000) / 10000];
}

function placeOf(s: ApiStation): { lat: number; lon: number; approx: boolean } {
  if (hasGeo(s)) return { lat: s.geo_lat!, lon: s.geo_long!, approx: false };
  const cc = (s.countrycode || "").toUpperCase();
  const [clat, clon] = COUNTRY_CENTRES[cc];
  const spread = SPREAD_DEG[cc] ?? 1.2;
  const [a, b] = scatter(s.stationuuid);
  // Even spread across a disc around the country's centre
  const r = Math.sqrt(a) * spread;
  const t = b * Math.PI * 2;
  const lat = Math.max(-85, Math.min(85, clat + r * Math.sin(t)));
  const lon = clon + (r * Math.cos(t)) / Math.max(0.3, Math.cos((clat * Math.PI) / 180));
  return { lat, lon: ((lon + 540) % 360) - 180, approx: true };
}

function splitList(v: string) {
  return (v || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function toStation(s: ApiStation): Station {
  const tags = splitList(s.tags).slice(0, 12);
  return {
    id: s.stationuuid,
    name: s.name.trim().replace(/\s+/g, " "),
    url: s.url_resolved,
    favicon: s.favicon || undefined,
    homepage: s.homepage || undefined,
    country: s.country || undefined,
    countryCode: s.countrycode || undefined,
    state: s.state || undefined,
    ...placeOf(s),
    tags,
    languages: splitList(s.language),
    codec: s.codec || undefined,
    bitrate: s.bitrate || undefined,
    clicks: s.clickcount || 0,
    votes: s.votes || 0,
    family: familyFor(tags),
    hls: !!s.hls || /\.m3u8(\?|$)/i.test(s.url_resolved) || undefined,
  };
}

function withExtras(list: Station[]) {
  const have = new Set(list.map((s) => s.id));
  return [...EXTRA_STATIONS.filter((s) => !have.has(s.id)), ...list];
}

async function apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  let lastErr: unknown;
  for (const base of MIRRORS) {
    try {
      const res = await fetch(`${base}${path}?${qs}`);
      if (res.ok) return (await res.json()) as T;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Radio directory unavailable");
}

const BASE_PARAMS: Record<string, string> = {
  hidebroken: "true",
  ...(ALLOW_HTTP ? {} : { is_https: "true" }),
};

// ---------------------------------------------------------------------------
// Loading plan. The directory's search can't return just the fields we
// need, so a full station is ~1 KB of JSON. Pages arrive one after another
// so dots fade onto the globe as they land (and a slow rural connection
// still gets something to play within a second or two):
//   1. the most-listened stations, page by page
//   2. a random scoop of everything else, so small and odd stations show
//      up too, not just the big commercial ones
// The trimmed result is kept on this device for a day.
// ---------------------------------------------------------------------------

const PAGE = 1000;
const POPULAR_PAGES = 4;
const RANDOM_PAGES = 3;
const CACHE_KEY = "stw.stations.v3"; // v3: also stations without exact locations, and http ones
const CACHE_MS = 24 * 60 * 60 * 1000;

function readCache(): Station[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, stations } = JSON.parse(raw) as { at: number; stations: Station[] };
    if (Date.now() - at > CACHE_MS || !Array.isArray(stations) || stations.length === 0) return null;
    return stations;
  } catch {
    return null;
  }
}

function writeCache(stations: Station[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), stations }));
  } catch {
    /* storage full or unavailable: it just loads fresh next time */
  }
}

/**
 * Loads the station map, calling onBatch with the growing list as each page
 * lands. Resolves with the final list.
 */
export type StationSource = "snapshot" | "directory";

/**
 * The whole directory in one file (public/data/stations.json), built daily
 * by the deploy workflow (scripts/build-snapshot.mjs). Your browser caches
 * it, so return visits cost next to nothing.
 */
async function loadSnapshot(): Promise<Station[] | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/stations.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as { fields: string[]; rows: unknown[][] };
    if (!Array.isArray(data?.rows) || !Array.isArray(data.fields)) return null;
    const idx = data.fields.map((f, i) => [f, i] as const);
    const out: Station[] = [];
    for (const row of data.rows) {
      const api = { lastcheckok: 1 } as Record<string, unknown>;
      for (const [f, i] of idx) api[f] = row[i];
      const s = api as unknown as ApiStation;
      if (playable(s)) out.push(toStation(s));
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export async function loadStations(
  onBatch: (stations: Station[], done: boolean, source: StationSource) => void
): Promise<Station[]> {
  // 1. The daily snapshot: every station at once
  const snap = await loadSnapshot();
  if (snap) {
    const all = withExtras(snap);
    onBatch(all, true, "snapshot");
    return all;
  }

  // 2. No snapshot (e.g. running locally before building one): ask the
  // directory directly, a few pages at a time
  const cached = readCache();
  if (cached) {
    const all = withExtras(cached);
    onBatch(all, true, "directory");
    return all;
  }

  const byId = new Map<string, Station>();
  // The directory has plenty of duplicate entries for the same stream
  const urls = new Set<string>();
  const add = (list: ApiStation[]) => {
    for (const s of list) {
      if (!playable(s) || byId.has(s.stationuuid) || urls.has(s.url_resolved)) continue;
      urls.add(s.url_resolved);
      byId.set(s.stationuuid, toStation(s));
    }
  };

  let anyOk = false;
  const pages: Record<string, string>[] = [
    ...Array.from({ length: POPULAR_PAGES }, (_, i) => ({ order: "clickcount", reverse: "true", offset: String(i * PAGE) })),
    ...Array.from({ length: RANDOM_PAGES }, () => ({ order: "random", offset: "0" })),
  ];
  for (const p of pages) {
    try {
      add(await apiGet<ApiStation[]>("/json/stations/search", { ...BASE_PARAMS, limit: String(PAGE), ...p }));
      anyOk = true;
      onBatch(withExtras(Array.from(byId.values())), false, "directory");
    } catch {
      /* skip a failed page; the others still count */
    }
  }
  if (!anyOk) {
    // Still offer the hand-added stations
    onBatch(EXTRA_STATIONS, true, "directory");
    throw new Error("Couldn't reach the radio directory");
  }
  const fetched = Array.from(byId.values());
  writeCache(fetched);
  const all = withExtras(fetched);
  onBatch(all, true, "directory");
  return all;
}

/** Deep search: asks the directory directly (for things outside the loaded map). */
export async function searchDirectory(opts: { name?: string; tag?: string; language?: string }): Promise<Station[]> {
  const params: Record<string, string> = { ...BASE_PARAMS, order: "clickcount", reverse: "true", limit: "300" };
  if (opts.name) params.name = opts.name;
  if (opts.tag) params.tag = opts.tag;
  if (opts.language) params.language = opts.language;
  const list = await apiGet<ApiStation[]>("/json/stations/search", params);
  return list.filter(playable).map(toStation);
}

// Polite "someone played this" ping, which the directory uses for its
// popularity rankings (it asks apps to do this)
export function countClick(id: string) {
  fetch(`${MIRRORS[0]}/json/url/${id}`).catch(() => {});
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface Filters {
  query: string;
  families: FamilyId[];
  language: string;
  gemsOnly: boolean;
  favsOnly: boolean;
}

export const EMPTY_FILTERS: Filters = { query: "", families: [], language: "", gemsOnly: false, favsOnly: false };

export function filtersActive(f: Filters) {
  return !!f.query.trim() || f.families.length > 0 || !!f.language || f.gemsOnly || f.favsOnly;
}

/** A "hidden gem": hardly anyone else is listening right now. */
export const GEM_MAX_CLICKS = 8;

// Each station's searchable text, built once (search runs on every keystroke
// across tens of thousands of stations)
const hayCache = new WeakMap<Station, string>();
function hayOf(s: Station) {
  let h = hayCache.get(s);
  if (h === undefined) {
    h = `${s.name} ${s.country ?? ""} ${s.state ?? ""} ${s.tags.join(" ")} ${s.languages.join(" ")}`.toLowerCase();
    hayCache.set(s, h);
  }
  return h;
}

export function matches(s: Station, f: Filters, favIds?: Set<string>): boolean {
  if (f.favsOnly && !favIds?.has(s.id)) return false;
  if (f.families.length && !f.families.includes(s.family)) return false;
  if (f.language && !s.languages.includes(f.language)) return false;
  if (f.gemsOnly && s.clicks > GEM_MAX_CLICKS) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = hayOf(s);
    // Every word must appear somewhere ("jazz paris" finds Parisian jazz)
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** The most common languages in the loaded map, for the picker. */
export function topLanguages(stations: Station[], n = 40): { language: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of stations) for (const l of s.languages) counts.set(l, (counts.get(l) ?? 0) + 1);
  return Array.from(counts, ([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Geography helpers
// ---------------------------------------------------------------------------

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Nearest stations to a point (excluding some ids), nearest first. */
export function nearest(stations: Station[], lat: number, lon: number, n: number, exclude?: Set<string>) {
  return stations
    .filter((s) => !exclude?.has(s.id))
    .map((s) => ({ s, d: haversineKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

/** Friendly place line: "Wellington, New Zealand" */
export function placeLine(s: Station) {
  if (s.approx) return s.state ? `${s.state}, ${s.country ?? ""}`.replace(/, $/, "") + " (rough location)" : `Somewhere in ${s.country ?? "the world"}`;
  return [s.state, s.country].filter(Boolean).join(", ") || "Somewhere on Earth";
}
