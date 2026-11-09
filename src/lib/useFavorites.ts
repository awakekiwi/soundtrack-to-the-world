import { useCallback, useMemo, useState } from "react";
import type { Station } from "./stations";

const KEY = "stw.favourites.v1";

function read(): Station[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Station[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: Station[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: favourites last until the page closes */
  }
}

/**
 * Favourite stations, kept on this device. The whole station is saved (not
 * just its id), so a favourite found with "Dig deeper" is still on the globe
 * next time, even though it isn't in the usual station list.
 */
export function useFavorites() {
  const [favs, setFavs] = useState<Station[]>(read);
  const ids = useMemo(() => new Set(favs.map((s) => s.id)), [favs]);

  const toggle = useCallback((s: Station) => {
    setFavs((prev) => {
      const next = prev.some((x) => x.id === s.id) ? prev.filter((x) => x.id !== s.id) : [s, ...prev];
      write(next);
      return next;
    });
  }, []);

  /** Swap in a whole list (from your account on another device) */
  const replaceAll = useCallback((list: Station[]) => {
    write(list);
    setFavs(list);
  }, []);

  return { favs, ids, toggle, replaceAll };
}
