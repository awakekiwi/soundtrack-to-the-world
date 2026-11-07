import { Square, X } from "lucide-react";
import type { Recording } from "@/lib/useRecorder";

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function size(bytes: number) {
  // Always one decimal in MB once past 1 MB, so the width stays steady
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "● REC 12:04 · 11.2 MB · Radio Active" with stop & save */
export function RecordingPill({ rec, now, onStop, onDiscard }: { rec: Recording; now: number; onStop: () => void; onDiscard: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full bg-popover/80 backdrop-blur-xl ring-1 ring-red-500/40 shadow-xl text-xs animate-in fade-in slide-in-from-bottom-1">
      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      <span className="font-semibold tracking-wider text-red-300">REC</span>
      {/* Fixed-width slots, so the ticking numbers don't shuffle the pill */}
      <span className="tabular-nums inline-block min-w-[4.6em] text-right">{clock(now - rec.startedAt)}</span>
      <span className="text-muted-foreground tabular-nums inline-block min-w-[5.6em] text-right">· {size(rec.bytes)}</span>
      <span className="text-muted-foreground truncate max-w-[140px] sm:max-w-[220px]">· {rec.station.name}</span>
      <button onClick={onStop} className="flex items-center gap-1 ml-1 px-2 py-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-200" title="Stop and save">
        <Square className="w-3 h-3 fill-current" /> Save
      </button>
      <button onClick={onDiscard} className="p-1 rounded-full hover:bg-white/10 text-muted-foreground" title="Throw it away" aria-label="Discard recording">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-popover/80 backdrop-blur-xl ring-1 ring-white/15 shadow-xl text-xs max-w-full animate-in fade-in">
      <span className="truncate">{text}</span>
      <button onClick={onClose} className="p-0.5 rounded-full hover:bg-white/10 text-muted-foreground shrink-0" aria-label="Dismiss">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
