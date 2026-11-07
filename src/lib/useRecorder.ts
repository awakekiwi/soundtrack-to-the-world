import { useCallback, useEffect, useRef, useState } from "react";
import { PROXY_URL } from "./config";
import type { Station } from "./stations";

/** Stop and save automatically past this, so a forgotten recording can't eat all the memory */
const MAX_BYTES = 400 * 1024 * 1024;

export interface Recording {
  station: Station;
  startedAt: number;
  bytes: number;
  via: "direct" | "proxy";
}

function extFor(type: string, codec?: string) {
  const t = type.toLowerCase();
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("aac")) return "aac";
  if (t.includes("ogg") || t.includes("opus")) return "ogg";
  if (t.includes("flac")) return "flac";
  if (t.includes("wav")) return "wav";
  const c = (codec || "").toLowerCase();
  if (c.includes("aac")) return "aac";
  if (c.includes("ogg") || c.includes("opus") || c.includes("vorbis")) return "ogg";
  if (c.includes("flac")) return "flac";
  return "mp3";
}

function fileName(s: Station, startedAt: number, ext: string) {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const name = s.name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Radio";
  return `${name} – ${when}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Records a station by saving its stream exactly as it arrives: a perfect
 * copy, no re-encoding. It's a separate connection from the player, so you
 * can keep recording while you listen to (or drift to) other stations.
 *
 * Browsers only let a page read a stream directly if the station allows it;
 * otherwise this goes through the helper Worker.
 */
export function useRecorder() {
  const [rec, setRec] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chunks = useRef<Uint8Array[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  const info = useRef<{ station: Station; startedAt: number; type: string; bytes: number } | null>(null);

  const save = useCallback(() => {
    const i = info.current;
    if (!i || chunks.current.length === 0) return;
    download(new Blob(chunks.current as BlobPart[], { type: i.type || "audio/mpeg" }), fileName(i.station, i.startedAt, extFor(i.type, i.station.codec)));
  }, []);

  const finish = useCallback(
    (keep: boolean) => {
      ctrl.current?.abort();
      ctrl.current = null;
      if (keep) save();
      chunks.current = [];
      info.current = null;
      setRec(null);
    },
    [save]
  );

  const start = useCallback(
    async (station: Station) => {
      if (info.current) finish(true);
      setError(null);
      const c = new AbortController();
      ctrl.current = c;

      let res: Response | null = null;
      let via: Recording["via"] = "direct";
      try {
        res = await fetch(station.url, { signal: c.signal });
        if (!res.ok || !res.body) res = null;
      } catch {
        res = null; // usually: the station doesn't allow web pages to read it
      }
      if (!res && PROXY_URL && !c.signal.aborted) {
        via = "proxy";
        try {
          res = await fetch(`${PROXY_URL}/stream?url=${encodeURIComponent(station.url)}`, { signal: c.signal });
          if (!res.ok || !res.body) {
            const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => null);
            throw new Error(msg || `HTTP ${res.status}`);
          }
        } catch (e) {
          if (c.signal.aborted) return;
          setError(`Couldn't record ${station.name}: ${e instanceof Error ? e.message : "no connection"}`);
          ctrl.current = null;
          return;
        }
      }
      if (!res) {
        if (!c.signal.aborted)
          setError(`${station.name} doesn't let web pages record it. Set up the helper Worker to record any station.`);
        ctrl.current = null;
        return;
      }

      const startedAt = Date.now();
      info.current = { station, startedAt, type: res.headers.get("content-type") || "", bytes: 0 };
      chunks.current = [];
      setRec({ station, startedAt, bytes: 0, via });

      const reader = res.body!.getReader();
      let lastUi = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.current.push(value);
          info.current.bytes += value.length;
          const now = Date.now();
          if (now - lastUi > 1000) {
            lastUi = now;
            setRec({ station, startedAt, bytes: info.current.bytes, via });
          }
          if (info.current.bytes >= MAX_BYTES) {
            finish(true);
            setError("Recording reached its size limit, so it was saved.");
            return;
          }
        }
        // The station ended the stream: keep what we got
        if (info.current) {
          finish(true);
          setError(`${station.name} stopped sending, so the recording was saved.`);
        }
      } catch {
        // Aborted by stop(), or the connection dropped
        if (info.current && ctrl.current === c) {
          finish(true);
          setError("The connection dropped, so the recording was saved.");
        }
      }
    },
    [finish]
  );

  const stop = useCallback(() => finish(true), [finish]);
  const discard = useCallback(() => finish(false), [finish]);

  // Don't lose a recording to an accidental tab close
  useEffect(() => {
    if (!rec) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [rec]);

  return { rec, error, clearError: () => setError(null), start, stop, discard };
}
