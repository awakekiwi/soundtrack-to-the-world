import { Trash2, X } from "lucide-react";
import { searchLinks, type HeardTrack } from "@/lib/useNowPlaying";

function when(at: number) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return today ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

export default function TracksPanel({
  log,
  enabled,
  onClear,
  onClose,
}: {
  log: HeardTrack[];
  enabled: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto w-full sm:w-[360px] ml-auto rounded-2xl bg-popover/80 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/10">
        <span className="font-display italic">Tracks heard</span>
        <div className="flex items-center gap-1">
          {log.length > 0 && (
            <button onClick={onClear} className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground" title="Clear the list" aria-label="Clear">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="max-h-[40vh] overflow-y-auto scroll-thin">
        {!enabled && (
          <p className="px-3.5 py-3 text-sm text-muted-foreground">
            Song titles need the helper Worker. See the README to set it up (about five minutes, free).
          </p>
        )}
        {enabled && log.length === 0 && (
          <p className="px-3.5 py-3 text-sm text-muted-foreground">Songs show up here as you listen. Not every station sends titles.</p>
        )}
        {log.map((t, i) => {
          const links = searchLinks(t);
          return (
            <div key={`${t.at}-${i}`} className="px-3.5 py-2 border-b border-white/5 last:border-0">
              <div className="text-sm leading-snug">{t.song ?? t.title}</div>
              {t.artist && <div className="text-[12px] text-foreground/75">{t.artist}</div>}
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">
                  {t.stationName} · {when(t.at)}
                </span>
                <a href={links.youtube} target="_blank" rel="noreferrer" className="ml-auto shrink-0 hover:text-foreground underline-offset-2 hover:underline">
                  YouTube
                </a>
                <a href={links.bandcamp} target="_blank" rel="noreferrer" className="shrink-0 hover:text-foreground underline-offset-2 hover:underline">
                  Bandcamp
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
