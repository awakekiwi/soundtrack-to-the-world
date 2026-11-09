import { useCallback, useState } from "react";
import type { Station } from "./stations";

const KEY = "stw.mystations.v1";

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
    /* storage unavailable */
  }
}

/** Stations added by hand with "Add a station", kept on this device */
export function useMyStations() {
  const [mine, setMine] = useState<Station[]>(read);
  const add = useCallback((s: Station) => {
    setMine((prev) => {
      const next = [s, ...prev.filter((x) => x.id !== s.id)];
      write(next);
      return next;
    });
  }, []);
  const remove = useCallback((id: string) => {
    setMine((prev) => {
      const next = prev.filter((x) => x.id !== id);
      write(next);
      return next;
    });
  }, []);
  /** Swap in a whole list (from your account on another device) */
  const replaceAll = useCallback((list: Station[]) => {
    write(list);
    setMine(list);
  }, []);
  return { mine, add, remove, replaceAll };
}
