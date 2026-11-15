import type { Station, StreamAlt } from "./stations";

/**
 * The directory often lists one station several times: a 192k stream, a
 * 56k mobile one, an https copy someone added from another country...
 * (Bassdrive has four.) About one entry in ten is a repeat like this.
 *
 * mergeDuplicates folds each group into one dot. The best-known entry
 * (most votes) stays as the station; the others become its backup
 * streams, used if the main one fails, or picked first in Data saver
 * mode when they're lighter.
 */

// Words that only describe the stream, not the station
const STREAM_WORDS =
  /\b(\d{2,3}\s?k(bps|b)?|\d{2,3}\s?kbit|aac\+?|he-?aac|mp3|ogg|opus|flac|hls|https?|hd|hq|lq|low|high|mobile|stream|backup|mono|stereo)\b/g;

const normName = (name: string) =>
  name
    .toLowerCase()
    // "(128k)" and "[AAC]" go; "(Arabic)" or "(Victoria)" stay, as those
    // name a different channel
    .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (m, a, b) =>
      String(a ?? b).replace(STREAM_WORDS, "").replace(/[^\p{L}\p{N}]+/gu, "") ? ` ${a ?? b} ` : " "
    )
    .replace(STREAM_WORDS, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// Hosting and social sites shared by thousands of unrelated stations
const SHARED_HOSTS = [
  "facebook", "fb", "instagram", "twitter", "youtube", "tiktok", "google", "linktr", "bit",
  "radio-browser", "tunein", "streema", "onlineradiobox", "mytuner-radio", "radio", "radiogarden",
  "zeno", "shoutcast", "icecast", "live365", "radioking", "streamtheworld", "streamguys1", "streamguys",
  "wixsite", "wordpress", "blogspot", "weebly", "github", "laut", "radionomy", "securenetsystems",
  "listen2myradio", "caster", "fastcast4u", "myradiostream", "radiojar", "airtime", "mixlr",
];

/** The memorable part of a web address: ice.bassdrive.net → "bassdrive" */
function siteName(url?: string): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).hostname.toLowerCase().replace(/^www\./, "").split(".");
    if (parts.length < 2) return null;
    // example.co.nz → "example"; example.com → "example"
    const i = parts.length >= 3 && parts[parts.length - 2].length <= 3 ? parts.length - 3 : parts.length - 2;
    const name = parts[i];
    return SHARED_HOSTS.includes(name) ? null : name;
  } catch {
    return null;
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

/** Merged-away station id → the id of the station it was folded into */
export const mergedInto = new Map<string, string>();

export function mergeDuplicates(list: Station[]): Station[] {
  const groups = new Map<string, Station[]>();
  const out: Station[] = [];
  for (const s of list) {
    const name = normName(s.name);
    const site = siteName(s.homepage) ?? siteName(s.url);
    if (name.length < 3 || !site || s.sharedAt) {
      out.push(s);
      continue;
    }
    const key = `${name}|${site}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }

  for (const g of groups.values()) {
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    g.sort((a, b) => b.votes - a.votes || b.clicks - a.clicks);
    const lead = g[0];
    const alts: StreamAlt[] = [];
    const ids: string[] = [];
    let { votes, clicks } = lead;
    let favicon = lead.favicon;
    const hosts = new Set([hostOf(lead.url)]);
    for (const s of g.slice(1)) {
      // Same name, same site, same country: the same station. In another
      // country it's usually a different one sharing a name (Rock FM in
      // Russia and in Spain), unless it streams from the very same server
      // (someone just listed it under the wrong country).
      const sameStation = s.countryCode === lead.countryCode || hosts.has(hostOf(s.url));
      if (!sameStation) {
        out.push(s);
        continue;
      }
      if (s.url !== lead.url && !alts.some((a) => a.url === s.url)) {
        alts.push({ url: s.url, bitrate: s.bitrate, codec: s.codec, hls: s.hls });
      }
      ids.push(s.id);
      hosts.add(hostOf(s.url));
      mergedInto.set(s.id, lead.id);
      votes += s.votes;
      clicks += s.clicks;
      favicon ||= s.favicon;
    }
    out.push(ids.length ? { ...lead, votes, clicks, favicon, alts: alts.length ? alts : undefined } : lead);
  }
  return out;
}

/** Usable (kbps) quality: an unknown bitrate is treated as an ordinary 128k */
const kbps = (b?: number) => (b && b > 0 ? b : 128);

/**
 * The streams to try for a station, in order. Normally the main one first,
 * then the backups from best to lightest. In Data saver mode, the lightest
 * one that still sounds alright (32k and up) comes first.
 */
export function streamsFor(s: Station, dataSaver: boolean): StreamAlt[] {
  const main: StreamAlt = { url: s.url, bitrate: s.bitrate, codec: s.codec, hls: s.hls };
  const alts = s.alts ?? [];
  if (!dataSaver) return [main, ...[...alts].sort((a, b) => kbps(b.bitrate) - kbps(a.bitrate))];
  const all = [main, ...alts];
  const ok = all.filter((a) => kbps(a.bitrate) >= 32).sort((a, b) => kbps(a.bitrate) - kbps(b.bitrate));
  const tooThin = all.filter((a) => kbps(a.bitrate) < 32);
  return [...ok, ...tooThin];
}
