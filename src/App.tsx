import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import {
  EMPTY_FILTERS,
  FAMILIES,
  GEM_MAX_CLICKS,
  filtersActive,
  haversineKm,
  loadStations,
  matches,
  searchDirectory,
  topLanguages,
  type FamilyId,
  type Filters,
  type Station,
} from "@/lib/stations";
import { useRadio } from "@/lib/useRadio";
import { useNowPlaying } from "@/lib/useNowPlaying";
import { useRecorder } from "@/lib/useRecorder";
import { useFavorites } from "@/lib/useFavorites";
import { useMyStations } from "@/lib/useMyStations";
import AddStationDialog from "@/components/AddStationDialog";
import TracksPanel from "@/components/TracksPanel";
import { Notice, RecordingPill } from "@/components/RecordingPill";
import PlayerBar from "@/components/PlayerBar";
import TunePanel from "@/components/TunePanel";
import type { FlyTarget } from "@/components/Globe";

// three.js is big; let the panels and player paint first
const Globe = lazy(() => import("@/components/Globe"));

const random = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export default function App() {
  const [loaded, setLoaded] = useState<Station[]>([]);
  const favorites = useFavorites();
  const myStations = useMyStations();
  const [adding, setAdding] = useState(false);
  // Your own stations and favourites always sit on the globe, even ones
  // that aren't in the usual list
  const stations = useMemo(() => {
    const have = new Set(loaded.map((s) => s.id));
    const extra = [...myStations.mine, ...favorites.favs].filter((s) => !have.has(s.id) && (have.add(s.id), true));
    return extra.length ? [...loaded, ...extra] : loaded;
  }, [loaded, favorites.favs, myStations.mine]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const f = useDeferredValue(filters);
  const filtering = filtersActive(f);

  const [fly, setFly] = useState<FlyTarget | null>(null);
  const flyId = useRef(0);
  const history = useRef<Station[]>([]);
  const played = useRef(new Set<string>());
  const [canGoBack, setCanGoBack] = useState(false);

  const [drift, setDrift] = useState(false);
  const [driftMinutes, setDriftMinutes] = useState(5);
  const [driftStart, setDriftStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const [deepSearching, setDeepSearching] = useState(false);
  const [deepNote, setDeepNote] = useState<string | null>(null);

  // ---- loading -----------------------------------------------------------
  const load = useCallback(() => {
    setLoadState("loading");
    loadStations((list, done) => {
      setLoaded(list);
      if (done) setLoadState("ready");
    }).catch(() => setLoadState("error"));
  }, []);
  useEffect(load, [load]);

  // ---- filtering ---------------------------------------------------------
  const { matchMask, matched } = useMemo(() => {
    const mask = new Uint8Array(stations.length);
    const list: Station[] = [];
    stations.forEach((s, i) => {
      if (matches(s, f, favorites.ids)) {
        mask[i] = 1;
        list.push(s);
      }
    });
    return { matchMask: mask, matched: list };
  }, [stations, f, favorites.ids]);

  // Family chip counts reflect the other filters (so "Jazz 312" means 312
  // jazz stations in the chosen language, say)
  const familyCounts = useMemo(() => {
    const counts = Object.fromEntries(FAMILIES.map((x) => [x.id, 0])) as Record<FamilyId, number>;
    const others = { ...f, families: [] };
    for (const s of stations) if (matches(s, others, favorites.ids)) counts[s.family]++;
    return counts;
  }, [stations, f, favorites.ids]);

  const languages = useMemo(() => topLanguages(stations), [stations]);

  // ---- picking the next station -----------------------------------------
  const pool = () => (filtersActive(filtersRef.current) ? matchedRef.current : stationsRef.current);
  const stationsRef = useRef(stations);
  stationsRef.current = stations;
  const matchedRef = useRef(matched);
  matchedRef.current = matched;
  const filtersRef = useRef(f);
  filtersRef.current = f;

  const unplayed = (list: Station[], extra?: string) => {
    const fresh = list.filter((s) => !played.current.has(s.id) && s.id !== extra);
    if (fresh.length) return fresh;
    // Heard everything in the pool: start the round again
    played.current.clear();
    return list.filter((s) => s.id !== extra);
  };

  /** Along the dial: the nearest station you haven't heard yet */
  const pickNear = (from: Station | null): Station | undefined => {
    const list = unplayed(pool(), from?.id);
    if (!list.length) return undefined;
    if (!from) return random(list);
    let best = list[0];
    let bestD = Infinity;
    for (const s of list) {
      const d = haversineKm(from.lat, from.lon, s.lat, s.lon);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  };

  /** Drift: a journey. Hop a few hundred to a few thousand km. */
  const pickDrift = (from: Station | null): Station | undefined => {
    const list = unplayed(pool(), from?.id);
    if (!list.length) return undefined;
    if (!from) return random(list);
    const hops = list.filter((s) => {
      const d = haversineKm(from.lat, from.lon, s.lat, s.lon);
      return d > 250 && d < 4500;
    });
    return random(hops.length ? hops : list);
  };

  /** Surprise: somewhere small and unexpected */
  const pickSurprise = (from: Station | null): Station | undefined => {
    const list = unplayed(pool(), from?.id);
    if (!list.length) return undefined;
    const gems = list.filter((s) => s.clicks <= GEM_MAX_CLICKS);
    return random(gems.length ? gems : list);
  };

  // ---- playing -----------------------------------------------------------
  const playRef = useRef<(s: Station, opts?: { user?: boolean; record?: boolean }) => void>(() => {});

  const radio = useRadio({
    // A dead stream: quietly slide along to the nearest neighbour
    onFail: (s) => {
      const next = pickNear(s);
      if (next) playRef.current(next, { record: false });
    },
  });

  const nowPlaying = useNowPlaying(radio.station, radio.status === "playing");
  const recorder = useRecorder();
  const [tracksOpen, setTracksOpen] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!recorder.rec) return;
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [recorder.rec]);
  const onRecord = () => {
    if (recorder.rec) recorder.stop();
    else if (radio.station) recorder.start(radio.station);
  };

  const play = (s: Station, { user = false, record = true } = {}) => {
    const cur = radio.station;
    if (record && cur && cur.id !== s.id) {
      history.current.push(cur);
      if (history.current.length > 50) history.current.shift();
      setCanGoBack(true);
    }
    played.current.add(s.id);
    if (user) radio.resetFails();
    radio.tune(s);
    setFly({ lat: s.lat, lon: s.lon, id: ++flyId.current, durationMs: drift ? 3200 : 1400 });
    setDriftStart(Date.now());
  };
  playRef.current = play;

  const onSelect = (s: Station) => play(s, { user: true });
  const onNext = () => {
    const s = pickNear(radio.station);
    if (s) play(s, { user: true });
  };
  const onSurprise = () => {
    const s = pickSurprise(radio.station);
    if (s) play(s, { user: true });
  };
  const onBack = () => {
    const prev = history.current.pop();
    setCanGoBack(history.current.length > 0);
    if (prev) play(prev, { user: true, record: false });
  };
  const onToggle = () => {
    if (!radio.station) onSurprise();
    else radio.toggle();
  };

  // ---- drift -------------------------------------------------------------
  useEffect(() => {
    if (!drift) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [drift]);

  // Turning drift on with nothing playing starts the journey straight away
  useEffect(() => {
    if (drift && !radio.station && stations.length) {
      const s = pickDrift(null);
      if (s) play(s, { user: true });
    }
    if (drift) setDriftStart(Date.now());
  }, [drift]); // eslint-disable-line react-hooks/exhaustive-deps

  const driftMs = driftMinutes * 60000;
  const driftProgress = drift ? Math.min((now - driftStart) / driftMs, 1) : 0;
  useEffect(() => {
    if (!drift || radio.status === "paused" || radio.status === "tuning") return;
    if (now - driftStart >= driftMs) {
      const s = pickDrift(radio.station);
      if (s) play(s);
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- deep search -------------------------------------------------------
  const onDeepSearch = async () => {
    const q = filters.query.trim();
    if (!q) return;
    setDeepSearching(true);
    setDeepNote(null);
    try {
      const [byName, byTag] = await Promise.all([
        searchDirectory({ name: q }).catch(() => [] as Station[]),
        searchDirectory({ tag: q.toLowerCase() }).catch(() => [] as Station[]),
      ]);
      const have = new Set(stationsRef.current.map((s) => s.id));
      const fresh = [...byName, ...byTag].filter((s) => !have.has(s.id) && (have.add(s.id), true));
      if (fresh.length) setLoaded((prev) => [...prev, ...fresh]);
      setDeepNote(fresh.length ? `Found ${fresh.length} more, now on the globe.` : "Nothing new turned up beyond what's already on the globe.");
    } finally {
      setDeepSearching(false);
    }
  };

  // ---- keyboard + phone lock-screen controls -----------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (adding) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        onToggle();
      } else if (e.key === "n" || e.key === "ArrowRight") onNext();
      else if (e.key === "b" || e.key === "ArrowLeft") onBack();
      else if (e.key === "s") onSurprise();
      else if (e.key === "d") setDrift((d) => !d);
      else if (e.key === "r") onRecord();
      else if (e.key === "f" && radio.station) favorites.toggle(radio.station);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const s = radio.station;
    if (!("mediaSession" in navigator) || !s) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: nowPlaying.track?.title ?? s.name,
        artist: nowPlaying.track ? s.name : [s.state, s.country].filter(Boolean).join(", "),
        album: "Soundtrack to the World",
        artwork: s.favicon ? [{ src: s.favicon, sizes: "192x192" }] : [],
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => onNext());
      navigator.mediaSession.setActionHandler("previoustrack", () => onBack());
      navigator.mediaSession.setActionHandler("pause", () => radio.pause());
      navigator.mediaSession.setActionHandler("play", () => radio.toggle());
    } catch {
      /* not supported here */
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- render ------------------------------------------------------------
  const subtitle =
    loadState === "error"
      ? null
      : loadState === "loading"
        ? `Gathering stations… ${stations.length ? stations.length.toLocaleString() : ""}`
        : `${stations.length.toLocaleString()} stations on air`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <div className="absolute inset-0">
        <Suspense
          fallback={
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          }
        >
          <Globe
            stations={stations}
            favIds={favorites.ids}
            matchMask={matchMask}
            filtering={filtering}
            current={radio.station}
            playing={radio.status === "playing"}
            flyTarget={fly}
            drifting={drift}
            onSelect={onSelect}
          />
        </Suspense>
      </div>

      {/* Top: title + tune panel (pointer-events only on the panels, so the
          globe underneath still drags) */}
      <div className="absolute z-30 inset-x-3 top-3 bottom-[124px] md:bottom-[96px] flex flex-col gap-3 pointer-events-none">
        <header className="px-1">
          <h1 className="font-display italic text-2xl sm:text-3xl leading-none tracking-tight text-foreground drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
            Soundtrack <span className="not-italic text-primary">to the</span> World
          </h1>
          <div className="mt-1 text-[12px] text-muted-foreground flex items-center gap-2 pointer-events-auto">
            {loadState === "loading" && <Loader2 className="w-3 h-3 animate-spin" />}
            {subtitle}
            {loadState === "error" && (
              <>
                <span>Couldn't reach the radio directory.</span>
                <button onClick={load} className="flex items-center gap-1 text-foreground underline underline-offset-2">
                  <RotateCw className="w-3 h-3" /> Try again
                </button>
              </>
            )}
          </div>
        </header>
        <div className="min-h-0 flex-1 flex items-start">
          <TunePanel
            filters={filters}
            setFilters={(nf) => {
              setFilters(nf);
              setDeepNote(null);
            }}
            matched={matched}
            familyCounts={familyCounts}
            languages={languages}
            currentId={radio.station?.id}
            onPick={onSelect}
            favIds={favorites.ids}
            onToggleFav={favorites.toggle}
            onAddStation={() => setAdding(true)}
            onDeepSearch={onDeepSearch}
            deepSearching={deepSearching}
            deepNote={deepNote}
          />
        </div>
      </div>

      {/* Bottom: player */}
      <div
        className="absolute z-30 inset-x-3 bottom-3 pointer-events-none flex flex-col gap-2"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="w-full max-w-3xl mx-auto flex flex-col items-end gap-2">
          {tracksOpen && (
            <TracksPanel
              log={nowPlaying.log}
              enabled={nowPlaying.enabled}
              onClear={nowPlaying.clearLog}
              onClose={() => setTracksOpen(false)}
            />
          )}
          {recorder.error && <Notice text={recorder.error} onClose={recorder.clearError} />}
          {recorder.rec && <RecordingPill rec={recorder.rec} now={tick} onStop={recorder.stop} onDiscard={recorder.discard} />}
        </div>
        <PlayerBar
          track={nowPlaying.track}
          recording={recorder.rec}
          onRecord={onRecord}
          tracksOpen={tracksOpen}
          onToggleTracks={() => setTracksOpen((o) => !o)}
          trackCount={nowPlaying.log.length}
          isFav={!!radio.station && favorites.ids.has(radio.station.id)}
          onToggleFav={() => radio.station && favorites.toggle(radio.station)}
          station={radio.station}
          status={radio.status}
          volume={radio.volume}
          setVolume={radio.setVolume}
          staticOn={radio.staticOn}
          setStaticOn={radio.setStaticOn}
          onToggle={onToggle}
          onBack={onBack}
          canGoBack={canGoBack}
          onNext={onNext}
          onSurprise={onSurprise}
          drift={drift}
          setDrift={setDrift}
          driftMinutes={driftMinutes}
          setDriftMinutes={setDriftMinutes}
          driftProgress={driftProgress}
        />
      </div>
      {/* Map credit (the 8K maps' licence asks for one) */}
      <a
        href="https://www.solarsystemscope.com/textures/"
        target="_blank"
        rel="noreferrer"
        className="absolute z-20 top-3 right-3 text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
      >
        Earth maps: NASA · Solar System Scope (CC BY 4.0)
      </a>

      {adding && (
        <AddStationDialog
          mine={myStations.mine}
          onUpdate={myStations.add}
          onSave={(st) => {
            myStations.add(st);
            if (!favorites.ids.has(st.id)) favorites.toggle(st);
            setAdding(false);
            play(st, { user: true });
          }}
          onRemove={(id) => {
            const st = myStations.mine.find((x) => x.id === id);
            if (st && favorites.ids.has(id)) favorites.toggle(st);
            myStations.remove(id);
          }}
          onPlay={(st) => {
            setAdding(false);
            play(st, { user: true });
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
