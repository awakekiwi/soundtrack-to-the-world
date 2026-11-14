import { useCallback, useState } from "react";
import type { Track } from "./useNowPlaying";

/** A song you hearted, in the order you've arranged them */
export interface LovedTrack extends Track {
  /** Stable key: artist + song, lower-cased */
  key: string;
  stationName?: string;
  at: number;
}

const KEY = "stw.loved.v1";

export const trackKey = (t: Track) =>
  ([t.artist, t.song].filter(Boolean).join(" - ") || t.title).toLowerCase().replace(/\s+/g, " ").trim();

function read(): LovedTrack[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LovedTrack[]) : [];
  } catch {
    return [];
  }
}

function write(list: LovedTrack[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/** Songs you've hearted: your own playlist, kept on this device (and your account) */
export function useLoved() {
  const [loved, setLoved] = useState<LovedTrack[]>(read);

  const update = useCallback((fn: (l: LovedTrack[]) => LovedTrack[]) => {
    setLoved((prev) => {
      const next = fn(prev);
      write(next);
      return next;
    });
  }, []);

  const isLoved = useCallback((t: Track) => loved.some((l) => l.key === trackKey(t)), [loved]);

  /** Heart or un-heart. New hearts go to the top of the list. */
  const toggle = useCallback(
    (t: Track & { stationName?: string }) => {
      const key = trackKey(t);
      update((l) =>
        l.some((x) => x.key === key)
          ? l.filter((x) => x.key !== key)
          : [{ title: t.title, artist: t.artist, song: t.song, art: t.art, stationName: t.stationName, key, at: Date.now() }, ...l]
      );
    },
    [update]
  );

  const remove = useCallback((key: string) => update((l) => l.filter((x) => x.key !== key)), [update]);

  /** Move a song up (-1) or down (+1) the list */
  const move = useCallback(
    (key: string, by: -1 | 1) =>
      update((l) => {
        const i = l.findIndex((x) => x.key === key);
        const j = i + by;
        if (i < 0 || j < 0 || j >= l.length) return l;
        const next = l.slice();
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }),
    [update]
  );

  const replaceAll = useCallback((list: LovedTrack[]) => {
    write(list);
    setLoved(list);
  }, []);

  return { loved, isLoved, toggle, remove, move, replaceAll };
}

// ---------------------------------------------------------------------------
// Taking the playlist elsewhere
// ---------------------------------------------------------------------------

const line = (t: Track) => [t.artist, t.song].filter(Boolean).join(" - ") || t.title;

/** "Artist - Song", one per line: the format playlist-transfer sites accept */
export const asText = (list: LovedTrack[]) => list.map(line).join("\n");

export function asCsv(list: LovedTrack[]) {
  const q = (s: string | null | undefined) => `"${(s ?? "").replace(/"/g, '""')}"`;
  return ["Artist,Title,Heard on", ...list.map((t) => [q(t.artist), q(t.song ?? t.title), q(t.stationName)].join(","))].join("\n");
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Search links for one song on the big music services */
export function musicLinks(t: Track) {
  const q = encodeURIComponent(line(t));
  return {
    spotify: `https://open.spotify.com/search/${q}`,
    ytmusic: `https://music.youtube.com/search?q=${q}`,
    bandcamp: `https://bandcamp.com/search?q=${q}`,
  };
}
