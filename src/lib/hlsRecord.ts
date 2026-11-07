import { PROXY_URL } from "./config";

/**
 * Records an HLS (.m3u8) station. HLS sends audio as a playlist of short
 * chunks that keeps updating, so this re-reads the playlist every few
 * seconds and downloads each new chunk in order, then unpacks the audio so
 * the saved file is a normal one:
 *   - MPEG-TS chunks (.ts)  → the AAC or MP3 inside, saved as .aac / .mp3
 *   - fMP4 chunks (.m4s)    → joined after their header, saved as .m4a
 *   - plain AAC chunks      → joined, saved as .aac
 * Stations that block web pages are read through the helper Worker.
 */

export interface HlsRecordHandlers {
  signal: AbortSignal;
  /** Called once the output format is known */
  onFormat: (mime: string, ext: string) => void;
  onData: (bytes: Uint8Array) => void;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      res();
    });
  });

// ---------------------------------------------------------------------------
// Fetching: straight from the station if it allows it, else via the Worker
// (whose rewritten playlists already point every chunk back through it)
// ---------------------------------------------------------------------------

class Fetcher {
  viaProxy = false;
  constructor(private signal: AbortSignal) {}

  private proxied(url: string) {
    return `${PROXY_URL}/hls?url=${encodeURIComponent(url)}`;
  }

  async get(url: string): Promise<Response> {
    const isProxyUrl = PROXY_URL && url.startsWith(PROXY_URL);
    if (!this.viaProxy || isProxyUrl) {
      try {
        const res = await fetch(url, { signal: this.signal });
        if (res.ok) return res;
        if (isProxyUrl || !PROXY_URL) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        if (this.signal.aborted || isProxyUrl || !PROXY_URL) throw e;
      }
      this.viaProxy = true;
    }
    const res = await fetch(this.proxied(url), { signal: this.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  async text(url: string) {
    const res = await this.get(url);
    return { text: await res.text(), base: res.url || url };
  }

  async bytes(url: string) {
    return new Uint8Array(await (await this.get(url)).arrayBuffer());
  }
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

interface MediaPlaylist {
  targetDuration: number;
  segments: { seq: number; url: string }[];
  mapUrl?: string;
  ended: boolean;
  encrypted: boolean;
}

function lines(text: string) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function pickVariant(text: string, base: string): string | null {
  const ls = lines(text);
  let best: { bw: number; url: string } | null = null;
  for (let i = 0; i < ls.length; i++) {
    if (!ls[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const bw = Number(ls[i].match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
    const next = ls[i + 1];
    if (next && !next.startsWith("#") && (!best || bw > best.bw)) best = { bw, url: new URL(next, base).toString() };
  }
  return best?.url ?? null;
}

function parseMedia(text: string, base: string): MediaPlaylist {
  const ls = lines(text);
  let seq = 0;
  let target = 6;
  let mapUrl: string | undefined;
  let encrypted = false;
  const segments: { seq: number; url: string }[] = [];
  for (const l of ls) {
    if (l.startsWith("#EXT-X-MEDIA-SEQUENCE:")) seq = Number(l.split(":")[1]) || 0;
    else if (l.startsWith("#EXT-X-TARGETDURATION:")) target = Number(l.split(":")[1]) || 6;
    else if (l.startsWith("#EXT-X-MAP:")) {
      const u = l.match(/URI="([^"]+)"/)?.[1];
      if (u) mapUrl = new URL(u, base).toString();
    } else if (l.startsWith("#EXT-X-KEY:") && !/METHOD=NONE/.test(l)) encrypted = true;
    else if (!l.startsWith("#")) segments.push({ seq: seq++, url: new URL(l, base).toString() });
  }
  return { targetDuration: target, segments, mapUrl, ended: ls.includes("#EXT-X-ENDLIST"), encrypted };
}

// ---------------------------------------------------------------------------
// Unpacking chunks
// ---------------------------------------------------------------------------

/** Skip an ID3 tag at the start (plain-AAC HLS chunks carry one each) */
function stripId3(b: Uint8Array) {
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    return b.subarray(10 + size);
  }
  return b;
}

/**
 * MPEG-TS → the audio stream inside. Reads the programme tables to find the
 * audio track, then joins its payloads (which for AAC are ADTS frames and
 * for MP3 are MP3 frames: both play fine on their own).
 */
class TsAudio {
  private pmtPid = -1;
  private audioPid = -1;
  streamType = -1;

  extract(buf: Uint8Array): Uint8Array | null {
    const out: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i + 188 <= buf.length; i += 188) {
      if (buf[i] !== 0x47) {
        // Lost sync: find the next packet start
        const next = buf.indexOf(0x47, i + 1);
        if (next < 0) break;
        i = next - 188;
        continue;
      }
      const pusi = (buf[i + 1] & 0x40) !== 0;
      const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
      const afc = (buf[i + 3] >> 4) & 3;
      if (!(afc & 1)) continue; // no payload
      let p = i + 4 + (afc & 2 ? 1 + buf[i + 4] : 0);
      const end = i + 188;
      if (p >= end) continue;

      if (pid === 0 && pusi) {
        p += 1 + buf[p]; // pointer field
        const sectionLen = ((buf[p + 1] & 0x0f) << 8) | buf[p + 2];
        for (let e = p + 8; e < p + 3 + sectionLen - 4; e += 4) {
          const prog = (buf[e] << 8) | buf[e + 1];
          if (prog !== 0) {
            this.pmtPid = ((buf[e + 2] & 0x1f) << 8) | buf[e + 3];
            break;
          }
        }
      } else if (pid === this.pmtPid && pusi && this.audioPid < 0) {
        p += 1 + buf[p];
        const sectionLen = ((buf[p + 1] & 0x0f) << 8) | buf[p + 2];
        const infoLen = ((buf[p + 10] & 0x0f) << 8) | buf[p + 11];
        const stop = p + 3 + sectionLen - 4;
        for (let e = p + 12 + infoLen; e + 5 <= stop; ) {
          const type = buf[e];
          const esPid = ((buf[e + 1] & 0x1f) << 8) | buf[e + 2];
          const esLen = ((buf[e + 3] & 0x0f) << 8) | buf[e + 4];
          // 0x0f AAC (ADTS), 0x03/0x04 MP3
          if (type === 0x0f || type === 0x03 || type === 0x04) {
            this.audioPid = esPid;
            this.streamType = type;
            break;
          }
          e += 5 + esLen;
        }
      } else if (pid === this.audioPid) {
        let data = buf.subarray(p, end);
        if (pusi && data[0] === 0 && data[1] === 0 && data[2] === 1) data = data.subarray(9 + data[8]); // PES header
        out.push(data);
        total += data.length;
      }
    }
    if (this.audioPid < 0) return null;
    const joined = new Uint8Array(total);
    let o = 0;
    for (const d of out) {
      joined.set(d, o);
      o += d.length;
    }
    return joined;
  }
}

function looksLikeTs(b: Uint8Array) {
  return b.length >= 376 && b[0] === 0x47 && b[188] === 0x47;
}

// ---------------------------------------------------------------------------

export async function recordHls(url: string, h: HlsRecordHandlers): Promise<void> {
  const f = new Fetcher(h.signal);

  // A master playlist lists versions of the stream: take the best one
  let { text, base } = await f.text(url);
  if (text.includes("#EXT-X-STREAM-INF")) {
    const variant = pickVariant(text, base);
    if (!variant) throw new Error("No playable version in this playlist");
    ({ text, base } = await f.text(variant));
    url = variant;
  }

  let lastSeq = -1;
  let first = true;
  let format: "ts" | "fmp4" | "raw" | null = null;
  const ts = new TsAudio();
  let mapDone = false;

  for (;;) {
    if (h.signal.aborted) return;
    const pl = parseMedia(text, base);
    if (pl.encrypted) throw new Error("This station's stream is encrypted, so it can't be recorded");

    // Start at the live edge, not at the start of the station's rewind window
    let todo = pl.segments.filter((s) => s.seq > lastSeq);
    if (first) {
      todo = todo.slice(-2);
      first = false;
    }

    for (const seg of todo) {
      if (h.signal.aborted) return;
      let bytes: Uint8Array = await f.bytes(seg.url);

      if (!format) {
        if (pl.mapUrl) {
          format = "fmp4";
          h.onFormat("audio/mp4", "m4a");
        } else if (looksLikeTs(bytes)) {
          format = "ts";
        } else {
          format = "raw";
          h.onFormat("audio/aac", "aac");
        }
      }

      if (format === "fmp4") {
        if (!mapDone && pl.mapUrl) {
          h.onData(await f.bytes(pl.mapUrl));
          mapDone = true;
        }
        h.onData(bytes);
      } else if (format === "ts") {
        const audio = ts.extract(bytes);
        if (ts.streamType >= 0 && audio) {
          if (lastSeq < 0 || seg === todo[0]) h.onFormat(ts.streamType === 0x0f ? "audio/aac" : "audio/mpeg", ts.streamType === 0x0f ? "aac" : "mp3");
          h.onData(audio);
        } else {
          // Couldn't find the audio track: keep the chunk as-is (.ts plays in VLC)
          h.onFormat("video/mp2t", "ts");
          h.onData(bytes);
        }
      } else {
        bytes = stripId3(bytes);
        h.onData(bytes);
      }
      lastSeq = seg.seq;
    }

    if (pl.ended) return;
    await sleep(Math.max(1000, (pl.targetDuration * 1000) / 2), h.signal);
    if (h.signal.aborted) return;
    ({ text, base } = await f.text(url));
  }
}
