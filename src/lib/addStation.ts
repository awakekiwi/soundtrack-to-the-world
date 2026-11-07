import { PROXY_URL } from "./config";
import { MIRRORS, type Station } from "./stations";

// Helpers for "Add a station": checking a link and finding a place.

export interface PlaceHit {
  lat: number;
  lon: number;
  label: string;
  state?: string;
  country?: string;
  countryCode?: string;
}

/**
 * Place search with OpenStreetMap's free Nominatim service (as Sun Chaser
 * uses). Their policy asks for at most ~1 request a second, which a search
 * button easily stays under.
 */
export async function findPlaces(q: string): Promise<PlaceHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const hits = (await res.json()) as {
    lat: string;
    lon: string;
    display_name: string;
    address?: Record<string, string>;
  }[];
  return hits.map((h) => {
    const a = h.address ?? {};
    return {
      lat: Number(h.lat),
      lon: Number(h.lon),
      label: h.display_name,
      state: a.city || a.town || a.village || a.state || a.county,
      country: a.country,
      countryCode: a.country_code?.toUpperCase(),
    };
  });
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (r.ok) return await r.text();
  } catch {
    /* blocked: try the helper */
  }
  if (!PROXY_URL) return null;
  try {
    const r = await fetch(`${PROXY_URL}/hls?url=${encodeURIComponent(url)}`);
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/** The helper rewrites playlist entries as its own links: get the original back */
function unwrap(u: string) {
  if (PROXY_URL && u.startsWith(PROXY_URL)) {
    try {
      return new URL(u).searchParams.get("url") || u;
    } catch {
      return u;
    }
  }
  return u;
}

/**
 * Many "listen" links are little playlist files (.pls / .m3u) pointing at
 * the real stream. Follow them so the station saves the stream itself.
 */
// Per-listener session codes some stream hosts add to links. They expire,
// and some carry the listener's internet address, so they're removed before
// a link is checked, saved or shared.
const SESSION_PARAMS = ["listeningsessionid", "downloadsessionid"];

export function stripSessionCodes(raw: string): string {
  try {
    const u = new URL(raw.trim());
    for (const k of [...u.searchParams.keys()]) if (SESSION_PARAMS.includes(k.toLowerCase())) u.searchParams.delete(k);
    return u.toString().replace(/\?$/, "");
  } catch {
    return raw.trim();
  }
}

export async function resolveLink(raw: string): Promise<string> {
  const url = stripSessionCodes(raw);
  const path = url.split("?")[0].toLowerCase();
  if (!path.endsWith(".pls") && !path.endsWith(".m3u")) return url;
  const text = await fetchText(url);
  if (!text) return url;
  const pls = text.match(/^File\d+=(.+)$/im)?.[1];
  if (pls) return unwrap(pls.trim());
  const m3u = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  return m3u ? unwrap(m3u) : url;
}

export const isHlsLink = (u: string) => /\.m3u8(\?|$)/i.test(u);

/**
 * Checks a stream through the helper Worker: does it answer, and what does
 * it call itself? (HLS links are checked by reading their playlist.)
 */
export async function checkStream(url: string): Promise<{ ok: boolean; name?: string; note?: string }> {
  if (isHlsLink(url)) {
    const text = await fetchText(url);
    return text?.includes("#EXTM3U") ? { ok: true, note: "Chunked (HLS) stream found" } : { ok: false, note: "Couldn't read that playlist" };
  }
  if (!PROXY_URL) return { ok: true, note: "Can't check without the helper Worker, but you can still save it" };
  try {
    const r = await fetch(`${PROXY_URL}/meta?url=${encodeURIComponent(url)}`);
    const j = (await r.json()) as { name?: string | null; title?: string | null; error?: string };
    if (!r.ok) return { ok: false, note: j.error || `The station answered ${r.status}` };
    return { ok: true, name: j.name ?? undefined, note: j.title ? `Playing now: ${j.title}` : "Stream found" };
  } catch {
    return { ok: false, note: "Couldn't reach that stream" };
  }
}

// ---------------------------------------------------------------------------
// Sharing to Radio Browser: the open directory this app (and many others)
// reads. A shared station appears for everyone once the directory accepts
// it; they run their own checks, so it may not show straight away.
// ---------------------------------------------------------------------------

async function alreadyListed(url: string): Promise<boolean> {
  for (const base of MIRRORS) {
    try {
      const r = await fetch(`${base}/json/stations/byurl?url=${encodeURIComponent(url)}`);
      if (!r.ok) continue;
      const list = (await r.json()) as unknown[];
      return Array.isArray(list) && list.length > 0;
    } catch {
      /* next mirror */
    }
  }
  return false;
}

export async function shareStation(s: Station): Promise<{ ok: boolean; message: string }> {
  if (await alreadyListed(s.url)) return { ok: true, message: "It's already in the directory, so everyone can find it." };

  // Sent as a plain form, which the directory accepts without extra checks
  const form = new URLSearchParams();
  form.set("name", s.name);
  form.set("url", s.url);
  if (s.homepage) form.set("homepage", s.homepage);
  if (s.favicon) form.set("favicon", s.favicon);
  if (s.countryCode) form.set("countrycode", s.countryCode);
  if (s.state) form.set("state", s.state);
  if (s.languages.length) form.set("language", s.languages.join(","));
  if (s.tags.length) form.set("tags", s.tags.join(","));
  form.set("geo_lat", String(s.lat));
  form.set("geo_long", String(s.lon));

  let lastErr = "Couldn't reach the directory";
  for (const base of MIRRORS) {
    try {
      const r = await fetch(`${base}/json/add`, { method: "POST", body: form });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (r.ok && j?.ok) return { ok: true, message: "Shared! It should appear for everyone once the directory has checked it." };
      lastErr = j?.message || `The directory answered ${r.status}`;
      if (r.status < 500) break; // a real "no", not a busy server
    } catch {
      /* next mirror */
    }
  }
  return { ok: false, message: lastErr };
}

/** A station written out ready to paste into src/lib/builtinStations.ts */
export function asBuiltinSnippet(s: Station) {
  const id = "builtin-" + s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const { sharedAt: _shared, ...rest } = s;
  return JSON.stringify({ ...rest, id }, null, 2).replace(/"(\w+)":/g, "$1:") + ",";
}
