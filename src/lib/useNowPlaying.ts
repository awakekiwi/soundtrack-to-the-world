import { useCallback, useEffect, useRef, useState } from "react";
import { PROXY_URL } from "./config";
import type { Station } from "./stations";

export interface Track {
  title: string;
  artist: string | null;
  song: string | null;
}

export interface HeardTrack extends Track {
  stationId: string;
  stationName: string;
  at: number;
}

const POLL_MS = 25000;
const LOG_KEY = "stw.heard.v1";
const LOG_MAX = 150;

function readLog(): HeardTrack[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as HeardTrack[]) : [];
  } catch {
    return [];
  }
}

function writeLog(log: HeardTrack[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable: the list just won't survive a reload */
  }
}

// Some stations put their slogan or an ad in the title slot rather than a song
function looksLikeSong(title: string, station: Station) {
  const t = title.toLowerCase();
  if (t.length < 3) return false;
  if (t === station.name.toLowerCase()) return false;
  return !/^(advert|commercial|station id|jingle|unknown|-+)$/.test(t);
}

/**
 * What's playing on the current station, read from the stream's own title
 * data through the helper Worker every ~25 seconds while it plays. Each new
 * song goes into a "tracks heard" list kept on this device.
 */
export function useNowPlaying(station: Station | null, playing: boolean) {
  const [track, setTrack] = useState<Track | null>(null);
  const [log, setLog] = useState<HeardTrack[]>(readLog);
  const lastTitle = useRef<string | null>(null);
  // Stations that turned out not to send titles: don't keep asking
  const silent = useRef(new Set<string>());

  useEffect(() => {
    setTrack(null);
    lastTitle.current = null;
  }, [station?.id]);

  useEffect(() => {
    if (!PROXY_URL || !station || !playing || silent.current.has(station.id)) return;
    let cancelled = false;
    let misses = 0;
    const check = async () => {
      try {
        const res = await fetch(`${PROXY_URL}/meta?url=${encodeURIComponent(station.url)}`);
        const data = (await res.json()) as Partial<Track> & { error?: string };
        if (cancelled) return;
        if (!res.ok || !data.title) {
          if (++misses >= 2) {
            silent.current.add(station.id);
            window.clearInterval(timer);
          }
          return;
        }
        misses = 0;
        const t: Track = { title: data.title, artist: data.artist ?? null, song: data.song ?? null };
        setTrack(t);
        if (t.title !== lastTitle.current) {
          lastTitle.current = t.title;
          if (looksLikeSong(t.title, station)) {
            setLog((prev) => {
              const next = [{ ...t, stationId: station.id, stationName: station.name, at: Date.now() }, ...prev].slice(0, LOG_MAX);
              writeLog(next);
              return next;
            });
          }
        }
      } catch {
        /* network blip: try again next round */
      }
    };
    check();
    const timer = window.setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [station, playing]);

  const clearLog = useCallback(() => {
    setLog([]);
    writeLog([]);
  }, []);

  return { track, log, clearLog, enabled: !!PROXY_URL };
}

export function searchLinks(t: Track) {
  const q = encodeURIComponent(t.title);
  return {
    youtube: `https://www.youtube.com/results?search_query=${q}`,
    bandcamp: `https://bandcamp.com/search?q=${q}`,
  };
}
