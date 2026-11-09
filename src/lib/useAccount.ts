import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ACCOUNTS_ON, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { Station } from "./stations";
import type { HeardTrack } from "./useNowPlaying";

/**
 * Accounts, through Supabase: sign in with an emailed link (or Google), and
 * your favourites, added stations and tracks heard follow you to any device.
 * The Supabase library only loads once someone signs in (or was signed in
 * before), so nobody else downloads it.
 */

const AUTH_KEY = "stw.auth";
const SYNC_AT_KEY = "stw.sync.at";

let clientPromise: Promise<SupabaseClient> | null = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // "implicit" so a sign-in link works on whichever device you open
          // the email on, not only the one that asked for it
          flowType: "implicit",
          storageKey: AUTH_KEY,
        },
      })
    );
  }
  return clientPromise;
}

const redirectTo = () => `${location.origin}${import.meta.env.BASE_URL}`;

/** Was someone signed in here before, or are we arriving back from a sign-in link? */
function shouldBoot() {
  try {
    if (localStorage.getItem(AUTH_KEY)) return true;
  } catch {
    /* storage unavailable */
  }
  return /access_token=|error_description=/.test(location.hash + location.search);
}

export function useAccount() {
  const [user, setUser] = useState<User | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const listening = useRef(false);

  const boot = useCallback(async () => {
    const c = await getClient();
    if (!listening.current) {
      listening.current = true;
      c.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    }
    const { data } = await c.auth.getSession();
    setUser(data.session?.user ?? null);
    setClient(c);
    // Tidy the sign-in tokens out of the address bar
    if (/access_token=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
    return c;
  }, []);

  useEffect(() => {
    if (ACCOUNTS_ON && shouldBoot()) boot().catch(() => {});
  }, [boot]);

  // Pro is only ever switched on by the payment system (see supabase/schema.sql)
  useEffect(() => {
    if (!client || !user) {
      setIsPro(false);
      return;
    }
    client
      .from("pro_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setIsPro(!!data));
  }, [client, user]);

  const signInEmail = useCallback(
    async (email: string) => {
      const c = await boot();
      const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo() } });
      return error?.message ?? null;
    },
    [boot]
  );

  const signInGoogle = useCallback(async () => {
    const c = await boot();
    const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    return error?.message ?? null;
  }, [boot]);

  const signOut = useCallback(async () => {
    const c = await getClient();
    await c.auth.signOut();
    setUser(null);
    try {
      localStorage.removeItem(SYNC_AT_KEY);
    } catch {
      /* fine */
    }
  }, []);

  return { enabled: ACCOUNTS_ON, user, isPro, client, signInEmail, signInGoogle, signOut };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

interface CloudRow {
  favourites: Station[];
  my_stations: Station[];
  heard: HeardTrack[];
  updated_at: string;
}

function unionById(a: Station[], b: Station[]) {
  const seen = new Set(a.map((s) => s.id));
  return [...a, ...b.filter((s) => !seen.has(s.id))];
}

function unionHeard(a: HeardTrack[], b: HeardTrack[]) {
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((t) => {
      const k = `${t.at}|${t.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => y.at - x.at)
    .slice(0, 150);
}

const readSyncAt = () => {
  try {
    return Number(localStorage.getItem(SYNC_AT_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeSyncAt = (t: number) => {
  try {
    localStorage.setItem(SYNC_AT_KEY, String(t));
  } catch {
    /* fine */
  }
};

export type SyncStatus = "off" | "syncing" | "synced" | "error";

/**
 * Keeps this device and the account in step.
 *  - First sign-in on a device: what's here and what's in the account are
 *    merged, so nothing is lost.
 *  - After that, the newer side wins: a change here is saved a couple of
 *    seconds later; a change made on another device is picked up when you
 *    come back to this tab (and every minute or so while it's open). So a
 *    favourite removed elsewhere stays removed.
 */
export function useCloudSync(opts: {
  client: SupabaseClient | null;
  user: User | null;
  favs: Station[];
  mine: Station[];
  heard: HeardTrack[];
  setFavs: (l: Station[]) => void;
  setMine: (l: Station[]) => void;
  setHeard: (l: HeardTrack[]) => void;
}) {
  const { client, user } = opts;
  const [status, setStatus] = useState<SyncStatus>("off");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const live = useRef(opts);
  live.current = opts;
  const applying = useRef(false);
  const dirty = useRef(false);
  const ready = useRef(false);
  const pushTimer = useRef<number | undefined>();

  const apply = (row: Pick<CloudRow, "favourites" | "my_stations" | "heard">) => {
    applying.current = true;
    live.current.setFavs(row.favourites ?? []);
    live.current.setMine(row.my_stations ?? []);
    live.current.setHeard(row.heard ?? []);
    // The change this causes is the account's, not a local edit: the
    // change watcher below skips it once
    applying.current = true;
  };

  const push = useCallback(async () => {
    const c = live.current.client;
    const u = live.current.user;
    if (!c || !u) return;
    setStatus("syncing");
    const { data, error } = await c
      .from("user_data")
      .upsert({
        user_id: u.id,
        favourites: live.current.favs,
        my_stations: live.current.mine,
        heard: live.current.heard,
        updated_at: new Date().toISOString(),
      })
      .select("updated_at")
      .single();
    if (error) {
      setStatus("error");
      return;
    }
    dirty.current = false;
    const at = Date.parse(data.updated_at);
    writeSyncAt(at);
    setLastSync(at);
    setStatus("synced");
  }, []);

  const pull = useCallback(
    async (firstTime: boolean) => {
      const c = live.current.client;
      const u = live.current.user;
      if (!c || !u) return;
      setStatus("syncing");
      const { data, error } = await c
        .from("user_data")
        .select("favourites, my_stations, heard, updated_at")
        .eq("user_id", u.id)
        .maybeSingle<CloudRow>();
      if (error) {
        setStatus("error");
        return;
      }
      const L = live.current;
      if (!data) {
        // New account: start it from what's on this device
        ready.current = true;
        return push();
      }
      const cloudAt = Date.parse(data.updated_at);
      if (firstTime && readSyncAt() === 0) {
        // This device hasn't synced with this account before: merge
        apply({
          favourites: unionById(L.favs, data.favourites ?? []),
          my_stations: unionById(L.mine, data.my_stations ?? []),
          heard: unionHeard(L.heard, data.heard ?? []),
        });
        ready.current = true;
        setTimeout(push, 50);
        return;
      }
      ready.current = true;
      if (cloudAt > readSyncAt()) {
        if (dirty.current) {
          // Changed in both places since the last sync: keep both
          apply({
            favourites: unionById(L.favs, data.favourites ?? []),
            my_stations: unionById(L.mine, data.my_stations ?? []),
            heard: unionHeard(L.heard, data.heard ?? []),
          });
          setTimeout(push, 50);
        } else {
          apply(data);
          writeSyncAt(cloudAt);
          setLastSync(cloudAt);
          setStatus("synced");
        }
      } else if (dirty.current) {
        push();
      } else {
        setLastSync(readSyncAt());
        setStatus("synced");
      }
    },
    [push]
  );

  // Sign in → first pull; sign out → off
  useEffect(() => {
    ready.current = false;
    if (!client || !user) {
      setStatus("off");
      return;
    }
    pull(true);
  }, [client, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A change on this device: save it shortly after
  useEffect(() => {
    if (applying.current) {
      applying.current = false;
      return;
    }
    if (!client || !user || !ready.current) return;
    dirty.current = true;
    window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(push, 2000);
  }, [opts.favs, opts.mine, opts.heard]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up changes made elsewhere: on returning to the tab, and every 90s
  useEffect(() => {
    if (!client || !user) return;
    const check = () => {
      if (document.visibilityState === "visible" && ready.current) pull(false);
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    const t = window.setInterval(check, 90000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.clearInterval(t);
    };
  }, [client, user, pull]);

  return { status, lastSync, syncNow: () => (dirty.current ? push() : pull(false)) };
}
