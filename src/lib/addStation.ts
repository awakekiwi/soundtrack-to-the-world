import { PROXY_URL } from "./config";

// Helpers for "Add a station": checking a link and finding a place.

export interface PlaceHit {
  lat: number;
  lon: number;
  label: string;
  state?: string;
  country?: string;
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
export async function resolveLink(raw: string): Promise<string> {
  const url = raw.trim();
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
