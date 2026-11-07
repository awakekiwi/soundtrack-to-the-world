import { Circle, ExternalLink, ListMusic, Loader2, Moon, Music2, Square, Pause, Play, Shuffle, SkipBack, Star, SkipForward, Sun, Volume2, VolumeX, Waves, Radio } from "lucide-react";
import { FAMILY_BY_ID, placeLine, type Station } from "@/lib/stations";
import type { RadioStatus } from "@/lib/useRadio";
import { isNightAt, localTime } from "@/lib/geo";
import { searchLinks, type Track } from "@/lib/useNowPlaying";
import type { Recording } from "@/lib/useRecorder";

// Three little bars that dance while a station is playing (from Sun Chaser)
const Equalizer = ({ active, color }: { active: boolean; color: string }) => (
  <span className="flex items-end gap-[2px] h-3.5 w-3.5 shrink-0" aria-hidden>
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className={`w-[3px] rounded-sm ${active ? "animate-pulse" : ""}`}
        style={{
          background: color,
          height: active ? `${[60, 100, 40][i]}%` : "30%",
          animationDelay: `${i * 0.18}s`,
          animationDuration: "0.9s",
        }}
      />
    ))}
  </span>
);

export const DRIFT_CHOICES = [2, 5, 10, 20];

interface Props {
  station: Station | null;
  status: RadioStatus;
  volume: number;
  setVolume: (v: number) => void;
  staticOn: boolean;
  setStaticOn: (v: boolean) => void;
  onToggle: () => void;
  onBack: () => void;
  canGoBack: boolean;
  onNext: () => void;
  onSurprise: () => void;
  drift: boolean;
  setDrift: (v: boolean) => void;
  driftMinutes: number;
  setDriftMinutes: (m: number) => void;
  driftProgress: number;
  track: Track | null;
  recording: Recording | null;
  onRecord: () => void;
  tracksOpen: boolean;
  onToggleTracks: () => void;
  trackCount: number;
  isFav: boolean;
  onToggleFav: () => void;
}

function statusLine(status: RadioStatus, station: Station | null) {
  if (!station) return "Tap a dot, search, or let it drift";
  if (status === "tuning") return "Tuning in…";
  if (status === "error") return "Couldn't catch a signal. Try another";
  if (status === "paused") return "Paused";
  return null;
}

export default function PlayerBar(p: Props) {
  const s = p.station;
  const fam = s ? FAMILY_BY_ID[s.family] : null;
  const color = fam?.color ?? "hsl(var(--primary))";
  const playing = p.status === "playing";
  const tuning = p.status === "tuning";
  const line = statusLine(p.status, s);
  const night = s ? isNightAt(s.lat, s.lon) : false;
  const iconBtn =
    "p-2 rounded-full hover:bg-white/10 active:scale-95 transition disabled:opacity-35 disabled:pointer-events-none";

  return (
    <div className="pointer-events-auto w-full max-w-3xl mx-auto rounded-2xl bg-popover/70 backdrop-blur-xl ring-1 ring-white/10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] overflow-hidden">
      {/* Drift countdown: a hairline that fills until the next hop */}
      <div className="h-[2px] bg-white/5">
        {p.drift && (
          <div className="h-full transition-[width] duration-1000 ease-linear" style={{ width: `${p.driftProgress * 100}%`, background: color }} />
        )}
      </div>

      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
        {/* Station */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className="w-11 h-11 shrink-0 rounded-xl overflow-hidden flex items-center justify-center bg-white/5 ring-1"
            style={{ boxShadow: playing ? `0 0 18px -4px ${color}` : undefined, borderColor: color, ["--tw-ring-color" as string]: `${color}55` }}
          >
            {p.track?.art || s?.favicon ? (
              <img
                key={p.track?.art || s?.favicon}
                src={p.track?.art || s?.favicon}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              />
            ) : (
              <Radio className="w-5 h-5" style={{ color }} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {s && <Equalizer active={playing} color={color} />}
              <span className="font-display text-[15px] sm:text-base truncate">{s?.name ?? "Soundtrack to the World"}</span>
              {s && (
                <button
                  onClick={p.onToggleFav}
                  className={`shrink-0 transition active:scale-90 ${p.isFav ? "text-amber-300" : "text-muted-foreground hover:text-amber-200"}`}
                  title={p.isFav ? "Remove from favourites (F)" : "Add to favourites (F)"}
                  aria-label={p.isFav ? "Remove from favourites" : "Add to favourites"}
                >
                  <Star className={`w-4 h-4 ${p.isFav ? "fill-current" : ""}`} />
                </button>
              )}
              {s?.homepage && (
                <a
                  href={s.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title="Station website"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            <div className="text-[12px] text-muted-foreground truncate flex items-center gap-1.5">
              {line ??
                (p.track ? (
                  <>
                    <Music2 className="w-3 h-3 shrink-0" style={{ color }} />
                    <a
                      href={searchLinks(p.track).youtube}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-foreground/90 hover:underline underline-offset-2"
                      title={`${p.track.title}: look it up`}
                    >
                      {p.track.artist ? (
                        <>
                          {p.track.song} <span className="text-muted-foreground">· {p.track.artist}</span>
                        </>
                      ) : (
                        p.track.title
                      )}
                    </a>
                  </>
                ) : (
                <>
                  {night ? <Moon className="w-3 h-3 shrink-0" /> : <Sun className="w-3 h-3 shrink-0" />}
                  <span className="truncate">
                    {placeLine(s!)} · {localTime(s!.lat, s!.lon)}
                    {s!.tags.length > 0 && <span className="italic opacity-80"> · {s!.tags.slice(0, 3).join(", ")}</span>}
                  </span>
                </>
                ))}
            </div>
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center shrink-0">
          <button onClick={p.onBack} className={`${iconBtn} hidden sm:block`} disabled={!p.canGoBack} aria-label="Previous station" title="Back to the last station">
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={p.onToggle}
            className="mx-0.5 w-11 h-11 rounded-full flex items-center justify-center text-primary-foreground active:scale-95 transition"
            style={{ background: color }}
            aria-label={playing || tuning ? "Pause" : "Play"}
          >
            {tuning ? <Loader2 className="w-5 h-5 animate-spin" /> : playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>
          <button onClick={p.onNext} className={iconBtn} aria-label="Next station along the dial" title="Next: the nearest station you haven't heard">
            <SkipForward className="w-4 h-4" />
          </button>
          <button onClick={p.onSurprise} className={iconBtn} aria-label="Surprise me" title="Surprise me: somewhere small and unexpected">
            <Shuffle className="w-4 h-4" />
          </button>
        </div>

        {/* Drift + sound */}
        <div className="hidden md:flex items-center gap-1 shrink-0 pl-1 border-l border-white/10">
          <RecordButton {...p} />
          <TracksButton {...p} />
          <button
            onClick={() => p.setDrift(!p.drift)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition ${
              p.drift ? "bg-white/15 text-foreground" : "hover:bg-white/10 text-muted-foreground"
            }`}
            title="Drift: wander on its own to a new station every few minutes"
          >
            <Waves className="w-4 h-4" />
            Drift
          </button>
          {p.drift && (
            <select
              value={p.driftMinutes}
              onChange={(e) => p.setDriftMinutes(Number(e.target.value))}
              className="bg-transparent text-xs text-muted-foreground outline-none cursor-pointer"
              aria-label="Minutes per station"
            >
              {DRIFT_CHOICES.map((m) => (
                <option key={m} value={m} className="bg-popover">
                  {m} min
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => p.setStaticOn(!p.staticOn)}
            className={`px-2 py-1.5 rounded-full text-[11px] tracking-wide transition ${
              p.staticOn ? "text-foreground/80 hover:bg-white/10" : "text-muted-foreground/50 line-through hover:bg-white/10"
            }`}
            title="Dial static between stations"
          >
            static
          </button>
          <label className="flex items-center gap-1 pl-1" title="Volume">
            <button onClick={() => p.setVolume(p.volume > 0 ? 0 : 0.75)} aria-label="Mute" className="text-muted-foreground hover:text-foreground">
              {p.volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={p.volume}
              onChange={(e) => p.setVolume(Number(e.target.value))}
              className="w-20"
              style={{ accentColor: color }}
              aria-label="Volume"
            />
          </label>
        </div>
      </div>

      {/* Phones: drift gets its own slim row */}
      <div className="md:hidden flex items-center justify-between px-3 pb-2 -mt-1 text-xs">
        <button
          onClick={() => p.setDrift(!p.drift)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition ${p.drift ? "bg-white/15" : "text-muted-foreground"}`}
        >
          <Waves className="w-3.5 h-3.5" /> Drift {p.drift ? `· ${p.driftMinutes} min` : ""}
        </button>
        {p.drift && (
          <div className="flex gap-1">
            {DRIFT_CHOICES.map((m) => (
              <button
                key={m}
                onClick={() => p.setDriftMinutes(m)}
                className={`px-2 py-0.5 rounded-full ${p.driftMinutes === m ? "bg-white/15" : "text-muted-foreground"}`}
              >
                {m}m
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <RecordButton {...p} />
          <TracksButton {...p} />
          <button
            onClick={() => p.setStaticOn(!p.staticOn)}
            className={`pl-1 ${p.staticOn ? "text-foreground/70" : "text-muted-foreground/50 line-through"}`}
          >
            static
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordButton(p: Props) {
  const on = !!p.recording;
  return (
    <button
      onClick={p.onRecord}
      disabled={!p.station && !on}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full text-xs transition disabled:opacity-35 ${
        on ? "bg-red-500/20 text-red-300" : "hover:bg-white/10 text-muted-foreground hover:text-foreground"
      }`}
      title={on ? "Stop and save the recording" : "Record this station"}
      aria-label={on ? "Stop recording" : "Record"}
    >
      {on ? <Square className="w-3 h-3 fill-current" /> : <Circle className="w-3.5 h-3.5 fill-red-500 text-red-500" />}
      <span className="hidden lg:inline">{on ? "Stop" : "Rec"}</span>
    </button>
  );
}

function TracksButton(p: Props) {
  return (
    <button
      onClick={p.onToggleTracks}
      className={`relative p-1.5 rounded-full transition ${p.tracksOpen ? "bg-white/15 text-foreground" : "hover:bg-white/10 text-muted-foreground hover:text-foreground"}`}
      title="Tracks heard"
      aria-label="Tracks heard"
    >
      <ListMusic className="w-4 h-4" />
      {p.trackCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] leading-[14px] text-center">
          {p.trackCount > 99 ? "99" : p.trackCount}
        </span>
      )}
    </button>
  );
}
