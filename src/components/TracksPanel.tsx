import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Download, Heart, Trash2, X } from "lucide-react";
import type { HeardTrack, Track } from "@/lib/useNowPlaying";
import { asCsv, asText, download, musicLinks, type LovedTrack } from "@/lib/useLoved";

function when(at: number) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return today ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

const linkCls = "shrink-0 hover:text-foreground underline-offset-2 hover:underline";

function Links({ t }: { t: Track }) {
  const l = musicLinks(t);
  return (
    <>
      <a href={l.spotify} target="_blank" rel="noreferrer" className={`ml-auto ${linkCls}`}>
        Spotify
      </a>
      <a href={l.ytmusic} target="_blank" rel="noreferrer" className={linkCls}>
        YT Music
      </a>
      <a href={l.bandcamp} target="_blank" rel="noreferrer" className={linkCls}>
        Bandcamp
      </a>
    </>
  );
}

function Art({ src }: { src?: string }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="w-10 h-10 rounded-md object-cover shrink-0 mt-0.5"
      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
    />
  );
}

function HeartBtn({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 self-center p-1.5 -mr-1 rounded-full transition active:scale-90 ${on ? "text-rose-400" : "text-muted-foreground/70 hover:text-rose-300"}`}
      aria-label={on ? "Remove from loved songs" : "Love this song"}
      title={on ? "Remove from loved songs" : "Love this song"}
    >
      <Heart className={`w-4 h-4 ${on ? "fill-current" : ""}`} />
    </button>
  );
}

export default function TracksPanel({
  log,
  enabled,
  onClear,
  onClose,
  loved,
  isLoved,
  onToggleLove,
  onMove,
}: {
  log: HeardTrack[];
  enabled: boolean;
  onClear: () => void;
  onClose: () => void;
  loved: LovedTrack[];
  isLoved: (t: Track) => boolean;
  onToggleLove: (t: Track & { stationName?: string }) => void;
  onMove: (key: string, by: -1 | 1) => void;
}) {
  const [tab, setTab] = useState<"heard" | "loved">("heard");
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(loved));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the download still works */
    }
  };

  const tabCls = (on: boolean) =>
    `px-2.5 py-1 rounded-full text-[13px] transition ${on ? "bg-white/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="pointer-events-auto w-full sm:w-[380px] ml-auto rounded-2xl bg-popover/80 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-white/10">
        <div className="flex items-center gap-1">
          <button className={tabCls(tab === "heard")} onClick={() => setTab("heard")}>
            Heard
          </button>
          <button className={`${tabCls(tab === "loved")} flex items-center gap-1`} onClick={() => setTab("loved")}>
            <Heart className={`w-3.5 h-3.5 ${tab === "loved" ? "text-rose-400 fill-current" : ""}`} />
            Loved{loved.length > 0 && <span className="text-muted-foreground">{loved.length}</span>}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {tab === "heard" && log.length > 0 && (
            <button onClick={onClear} className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground" title="Clear the list" aria-label="Clear">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {tab === "loved" && loved.length > 0 && (
            <button
              onClick={() => setExportOpen((o) => !o)}
              className={`px-2.5 py-1 rounded-full text-[12px] ring-1 ring-white/15 transition ${exportOpen ? "bg-white/15" : "hover:bg-white/10"}`}
            >
              Export
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {tab === "loved" && exportOpen && loved.length > 0 && (
        <div className="px-3.5 py-3 border-b border-white/10 bg-white/[0.03] text-[13px] space-y-2.5">
          <p className="text-muted-foreground leading-snug">
            To make a Spotify or YouTube Music playlist, copy the list, then paste it into a free transfer site. They match each song for you.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15">
              <Copy className="w-3.5 h-3.5" />
              {copied ? "Copied!" : "Copy list"}
            </button>
            <button
              onClick={() => download("loved-songs.csv", asCsv(loved), "text/csv")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
            <span className="text-muted-foreground">Then paste into:</span>
            <a href="https://www.tunemymusic.com/transfer" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              TuneMyMusic
            </a>
            <a href="https://soundiiz.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              Soundiiz
            </a>
          </div>
        </div>
      )}

      <div className="max-h-[40vh] overflow-y-auto scroll-thin">
        {tab === "heard" && (
          <>
            {!enabled && (
              <p className="px-3.5 py-3 text-sm text-muted-foreground">
                Song titles need the helper Worker. See the README to set it up (about five minutes, free).
              </p>
            )}
            {enabled && log.length === 0 && (
              <p className="px-3.5 py-3 text-sm text-muted-foreground">Songs show up here as you listen. Not every station sends titles.</p>
            )}
            {log.map((t, i) => (
              <div key={`${t.at}-${i}`} className="px-3.5 py-2 border-b border-white/5 last:border-0 flex gap-2.5">
                <Art src={t.art} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-snug">{t.song ?? t.title}</div>
                  {t.artist && <div className="text-[12px] text-foreground/75">{t.artist}</div>}
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">
                      {t.stationName} · {when(t.at)}
                    </span>
                    <Links t={t} />
                  </div>
                </div>
                <HeartBtn on={isLoved(t)} onClick={() => onToggleLove(t)} />
              </div>
            ))}
          </>
        )}

        {tab === "loved" && (
          <>
            {loved.length === 0 && (
              <p className="px-3.5 py-3 text-sm text-muted-foreground">
                Tap the heart on a song you like, here or in the player, and it lands in this list. Put them in any order, then take them to Spotify or YouTube Music.
              </p>
            )}
            {loved.map((t, i) => (
              <div key={t.key} className="pl-1.5 pr-3.5 py-2 border-b border-white/5 last:border-0 flex gap-2">
                <div className="flex flex-col justify-center shrink-0 -my-1">
                  <button
                    onClick={() => onMove(t.key, -1)}
                    disabled={i === 0}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-20"
                    aria-label="Move up"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onMove(t.key, 1)}
                    disabled={i === loved.length - 1}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-20"
                    aria-label="Move down"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
                <Art src={t.art} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-snug">{t.song ?? t.title}</div>
                  {t.artist && <div className="text-[12px] text-foreground/75">{t.artist}</div>}
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {t.stationName && <span className="truncate">{t.stationName}</span>}
                    <Links t={t} />
                  </div>
                </div>
                <HeartBtn on onClick={() => onToggleLove(t)} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
