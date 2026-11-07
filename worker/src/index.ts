/**
 * Soundtrack to the World: a small helper Worker for two things a web page
 * isn't allowed to do by itself with most radio streams:
 *
 *   GET /meta?url=<stream>    → { title, artist, song } from the stream's own
 *                               ICY metadata (what's playing right now)
 *   GET /stream?url=<stream>  → the stream's audio relayed with CORS headers,
 *                               so the app can save it (recording)
 *   GET /hls?url=<playlist>   → an HLS (.m3u8) station relayed for stations
 *                               that block web pages: playlists are
 *                               rewritten so every chunk also comes via here
 *
 * It speaks HTTP over raw TCP sockets rather than fetch(), because a deployed
 * Worker's fetch() ignores custom ports (lots of radio runs on :8000 and
 * friends) and rejects old Shoutcast servers that answer "ICY 200 OK".
 *
 * Only pages from ALLOWED_ORIGINS may use it, so it can't be borrowed as a
 * general-purpose proxy.
 */
import { connect } from "cloudflare:sockets";

interface Env {
  /** Comma-separated origins allowed to use this Worker */
  ALLOWED_ORIGINS: string;
}

const META_TIMEOUT_MS = 8000;
/** Never read more than this much audio while looking for a title */
const META_MAX_BYTES = 512 * 1024;
const META_CACHE_SECONDS = 15;
const MAX_REDIRECTS = 3;
const UA = "SoundtrackToTheWorld/0.1 (+https://github.com/awakekiwi)";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get("Origin");
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes("*") || list.includes(origin) ? origin : null;
}

function cors(origin: string, extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Type, X-Stream-Name",
    Vary: "Origin",
    ...extra,
  };
}

function json(origin: string, body: unknown, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: cors(origin, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store",
    }),
  });
}

// ---------------------------------------------------------------------------
// Minimal HTTP/1.0 over a socket. HTTP/1.0 keeps servers from using chunked
// encoding, so after the headers the body is just the raw audio.
// ---------------------------------------------------------------------------

interface Opened {
  status: number;
  headers: Map<string, string>;
  /** Body bytes that arrived in the same packets as the headers */
  leftover: Uint8Array;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  socket: Socket;
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function headerEnd(buf: Uint8Array) {
  for (let i = 3; i < buf.length; i++) {
    if (buf[i] === 10 && buf[i - 1] === 13 && buf[i - 2] === 10 && buf[i - 3] === 13) return i + 1;
  }
  // Some ancient servers end headers with bare \n\n
  for (let i = 1; i < buf.length; i++) if (buf[i] === 10 && buf[i - 1] === 10) return i + 1;
  return -1;
}

function validateUrl(raw: string | null): URL {
  if (!raw) throw new HttpError(400, "Missing url");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "Bad url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError(400, "Only http(s) streams");
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  if (port === 25) throw new HttpError(400, "Port not allowed");
  return u;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function open(url: URL, wantMeta: boolean, redirects = 0): Promise<Opened> {
  const secure = url.protocol === "https:";
  const port = Number(url.port || (secure ? 443 : 80));
  const socket = connect({ hostname: url.hostname, port }, { secureTransport: secure ? "on" : "off", allowHalfOpen: false });

  const writer = socket.writable.getWriter();
  const path = (url.pathname || "/") + url.search;
  const req =
    `GET ${path} HTTP/1.0\r\n` +
    `Host: ${url.host}\r\n` +
    `User-Agent: ${UA}\r\n` +
    `Accept: */*\r\n` +
    (wantMeta ? "Icy-MetaData: 1\r\n" : "") +
    `Connection: close\r\n\r\n`;
  await writer.write(new TextEncoder().encode(req));
  writer.releaseLock();

  const reader = socket.readable.getReader();
  let buf = new Uint8Array(0);
  let end = -1;
  while (end < 0) {
    const { value, done } = await reader.read();
    if (done) throw new HttpError(502, "Stream closed before answering");
    buf = concat(buf, value);
    end = headerEnd(buf);
    if (buf.length > 32 * 1024 && end < 0) throw new HttpError(502, "Headers too large");
  }

  const head = latin1(buf.subarray(0, end));
  const lines = head.split(/\r?\n/);
  // "HTTP/1.1 200 OK" or Shoutcast's "ICY 200 OK"
  const status = Number(lines[0].split(" ")[1]) || 0;
  const headers = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }

  if (status >= 300 && status < 400 && headers.get("location")) {
    reader.releaseLock();
    socket.close();
    if (redirects >= MAX_REDIRECTS) throw new HttpError(502, "Too many redirects");
    return open(validateUrl(new URL(headers.get("location")!, url).toString()), wantMeta, redirects + 1);
  }
  if (status < 200 || status >= 300) {
    reader.releaseLock();
    socket.close();
    throw new HttpError(502, `Station answered ${status || "oddly"}`);
  }
  return { status, headers, leftover: buf.subarray(end), reader, socket };
}

// ---------------------------------------------------------------------------
// /meta: read just enough of the stream to find the first title
// ---------------------------------------------------------------------------

// Byte-for-byte Latin-1 (older stations send titles this way)
function latin1(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return latin1(bytes);
  }
}

function parseTitle(block: string): string | null {
  const m = block.match(/StreamTitle='([\s\S]*?)';/);
  const t = m?.[1]?.replace(/\0/g, "").trim();
  return t ? t : null;
}

function splitTitle(title: string) {
  // Most stations send "Artist - Song"
  const i = title.indexOf(" - ");
  if (i > 0) return { artist: title.slice(0, i).trim(), song: title.slice(i + 3).trim() };
  return { artist: null, song: title };
}

async function readMeta(url: URL): Promise<{ title: string | null; artist: string | null; song: string | null; name: string | null }> {
  const s = await open(url, true);
  const name = s.headers.get("icy-name") || null;
  const metaint = Number(s.headers.get("icy-metaint"));
  try {
    if (!metaint || metaint <= 0) return { title: null, artist: null, song: null, name };

    // Pull bytes as needed; audio we skip, metadata we keep
    let buf = s.leftover;
    let total = buf.length;
    const need = async (n: number) => {
      while (buf.length < n) {
        const { value, done } = await s.reader.read();
        if (done) throw new HttpError(502, "Stream ended");
        buf = concat(buf, value);
        total += value.length;
        if (total > META_MAX_BYTES) throw new HttpError(504, "No title found");
      }
    };

    // Look through a few blocks: some servers send an empty first block
    for (let block = 0; block < 4; block++) {
      await need(metaint + 1);
      const len = buf[metaint] * 16;
      await need(metaint + 1 + len);
      const text = decodeText(buf.subarray(metaint + 1, metaint + 1 + len));
      buf = buf.subarray(metaint + 1 + len);
      const title = len ? parseTitle(text) : null;
      if (title) return { title, ...splitTitle(title), name };
    }
    return { title: null, artist: null, song: null, name };
  } finally {
    s.reader.releaseLock();
    s.socket.close();
  }
}

async function handleMeta(req: Request, origin: string, ctx: ExecutionContext) {
  const url = validateUrl(new URL(req.url).searchParams.get("url"));
  // Many listeners on one station share one lookup for a few seconds
  const cacheKey = new Request(`https://meta.cache/?u=${encodeURIComponent(url.toString())}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return json(origin, await hit.json(), 200, META_CACHE_SECONDS);

  const result = await Promise.race([
    readMeta(url),
    new Promise<never>((_, reject) => setTimeout(() => reject(new HttpError(504, "Station too slow")), META_TIMEOUT_MS)),
  ]);
  ctx.waitUntil(
    cache.put(cacheKey, new Response(JSON.stringify(result), { headers: { "Cache-Control": `public, max-age=${META_CACHE_SECONDS}` } }))
  );
  return json(origin, result, 200, META_CACHE_SECONDS);
}

// ---------------------------------------------------------------------------
// /stream: relay audio for recording. After the headers, the socket's bytes
// are piped straight through without touching them in JavaScript.
// ---------------------------------------------------------------------------

function looksLikeAudio(type: string) {
  const t = type.toLowerCase();
  return t.startsWith("audio/") || t.includes("ogg") || t === "application/octet-stream" || t === "";
}

async function handleStream(req: Request, origin: string) {
  const url = validateUrl(new URL(req.url).searchParams.get("url"));
  const s = await open(url, false);
  const type = s.headers.get("content-type") || "";
  if (!looksLikeAudio(type) || type.toLowerCase().includes("mpegurl")) {
    s.reader.releaseLock();
    s.socket.close();
    throw new HttpError(415, "That doesn't look like an audio stream");
  }

  const { readable, writable } = new IdentityTransformStream();
  s.reader.releaseLock();
  // Runs in the background: these writes only complete as the app reads, so
  // waiting on them before returning the response would never finish. Stops
  // (and closes the station connection) when the app stops reading.
  (async () => {
    if (s.leftover.length) {
      const w = writable.getWriter();
      await w.write(s.leftover);
      w.releaseLock();
    }
    await s.socket.readable.pipeTo(writable);
  })().catch(() => s.socket.close());

  return new Response(readable, {
    headers: cors(origin, {
      "Content-Type": type || "audio/mpeg",
      "Cache-Control": "no-store",
      "X-Stream-Name": encodeURIComponent(s.headers.get("icy-name") || ""),
    }),
  });
}

// ---------------------------------------------------------------------------
// /hls: relay an HLS station. HLS lives on ordinary web servers (usually
// big CDNs on port 443), so plain fetch() is fine here.
// ---------------------------------------------------------------------------

function isPlaylist(url: URL, type: string) {
  const t = type.toLowerCase();
  return /\.m3u8?$/i.test(url.pathname) || t.includes("mpegurl");
}

function rewritePlaylist(text: string, base: string, self: string) {
  const wrap = (u: string) => `${self}/hls?url=${encodeURIComponent(new URL(u, base).toString())}`;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const l = line.trim();
      if (!l) return line;
      // Tags can carry addresses too, e.g. #EXT-X-KEY:...,URI="key.bin"
      if (l.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${wrap(u)}"`);
      return wrap(l);
    })
    .join("\n");
}

async function handleHls(req: Request, origin: string) {
  const url = validateUrl(new URL(req.url).searchParams.get("url"));
  const res = await fetch(url.toString(), { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new HttpError(502, `Station answered ${res.status}`);
  const type = res.headers.get("content-type") || "";

  if (isPlaylist(new URL(res.url || url.toString()), type)) {
    const self = new URL(req.url).origin;
    const body = rewritePlaylist(await res.text(), res.url || url.toString(), self);
    return new Response(body, {
      headers: cors(origin, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" }),
    });
  }

  // A chunk of audio (or an init/key file): pass it straight through
  return new Response(res.body, {
    headers: cors(origin, {
      "Content-Type": type || "application/octet-stream",
      "Cache-Control": "public, max-age=60",
    }),
  });
}

// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = allowedOrigin(req, env);
    if (!origin) return new Response("Not allowed", { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, { "Access-Control-Max-Age": "86400" }) });
    if (req.method !== "GET") return json(origin, { error: "GET only" }, 405);

    const path = new URL(req.url).pathname;
    try {
      if (path === "/meta") return await handleMeta(req, origin, ctx);
      if (path === "/stream") return await handleStream(req, origin);
      if (path === "/hls") return await handleHls(req, origin);
      return json(origin, { ok: true, endpoints: ["/meta?url=", "/stream?url=", "/hls?url="] });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 502;
      return json(origin, { error: e instanceof Error ? e.message : "Failed" }, status);
    }
  },
} satisfies ExportedHandler<Env>;
