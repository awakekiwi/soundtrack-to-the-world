import { useMemo, useState } from "react";
import { ChevronDown, Gem, Globe2, Loader2, Plus, Search, SlidersHorizontal, Star, X } from "lucide-react";
import {
  EMPTY_FILTERS,
  FAMILIES,
  FAMILY_BY_ID,
  filtersActive,
  placeLine,
  type FamilyId,
  type Filters,
  type Station,
} from "@/lib/stations";

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  matched: Station[];
  familyCounts: Record<FamilyId, number>;
  languages: { language: string; count: number }[];
  currentId?: string;
  onPick: (s: Station) => void;
  onDeepSearch: () => void;
  deepSearching: boolean;
  deepNote: string | null;
  favIds: Set<string>;
  onToggleFav: (s: Station) => void;
  onAddStation: () => void;
  /** False when every station is already loaded (nothing deeper to dig) */
  canDig: boolean;
  /** The results below are still catching up with what was just typed */
  searching?: boolean;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export default function TunePanel(p: Props) {
  // Folded on phones so the globe gets the screen; open on bigger screens
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  const f = p.filters;
  const active = filtersActive(f);
  const set = (patch: Partial<Filters>) => p.setFilters({ ...f, ...patch });
  const toggleFamily = (id: FamilyId) =>
    set({ families: f.families.includes(id) ? f.families.filter((x) => x !== id) : [...f.families, id] });

  // Show the busiest matches first; in gems mode the quietest are the point
  const list = useMemo(() => {
    const arr = [...p.matched];
    arr.sort((a, b) => (f.gemsOnly ? a.clicks - b.clicks || a.name.localeCompare(b.name) : b.clicks - a.clicks));
    return arr.slice(0, 80);
  }, [p.matched, f.gemsOnly]);

  return (
    <div className="pointer-events-auto w-full sm:w-[340px] rounded-2xl bg-popover/70 backdrop-blur-xl ring-1 ring-white/10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] flex flex-col max-h-full min-h-0 overflow-hidden">
      {/* Search row (always visible) */}
      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          value={f.query}
          onChange={(e) => set({ query: e.target.value })}
          onFocus={() => setOpen(true)}
          placeholder="Search a place, style, station…"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-muted-foreground/70"
        />
        {active && (
          <button
            onClick={() => p.setFilters(EMPTY_FILTERS)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Clear filters"
            title="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={p.onAddStation}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Add a station"
          title="Add a station by its stream link"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={() => setOpen(!open)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? "Hide filters" : "Show filters"}
        >
          {open ? <ChevronDown className="w-4 h-4 rotate-180 transition" /> : <SlidersHorizontal className="w-4 h-4" />}
        </button>
      </div>

      {open && (
        <div className="flex flex-col flex-1 min-h-0 border-t border-white/10 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Sound families */}
          {/* While results are listed, the chips fold into one sideways-
              scrolling row so the list gets the room */}
          <div
            className={`px-3 pt-3 flex gap-1.5 shrink-0 ${
              active ? "flex-nowrap overflow-x-auto scroll-thin pb-1 [&>button]:shrink-0" : "flex-wrap"
            }`}
          >
            {FAMILIES.map((fam) => {
              const on = f.families.includes(fam.id);
              const n = p.familyCounts[fam.id] ?? 0;
              return (
                <button
                  key={fam.id}
                  onClick={() => toggleFamily(fam.id)}
                  className={`flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-[12px] ring-1 transition ${
                    on ? "bg-white/15 ring-white/25 text-foreground" : "ring-white/10 text-muted-foreground hover:text-foreground hover:ring-white/20"
                  }`}
                  style={on ? { boxShadow: `inset 0 0 0 1px ${fam.color}66` } : undefined}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: fam.color, boxShadow: on ? `0 0 8px ${fam.color}` : undefined }} />
                  {fam.label}
                  {n > 0 && <span className="text-[10px] opacity-60">{n.toLocaleString()}</span>}
                </button>
              );
            })}
          </div>

          {/* Language + gems */}
          <div className="px-3 pt-2.5 pb-3 flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1.5 flex-1 min-w-0 rounded-full ring-1 ring-white/10 px-2.5 py-1 text-[12px]">
              <Globe2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <select
                value={f.language}
                onChange={(e) => set({ language: e.target.value })}
                className="flex-1 min-w-0 bg-transparent outline-none cursor-pointer"
                aria-label="Language"
              >
                <option value="" className="bg-popover">Any language</option>
                {p.languages.map((l) => (
                  <option key={l.language} value={l.language} className="bg-popover">
                    {titleCase(l.language)} ({l.count})
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => set({ gemsOnly: !f.gemsOnly })}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 transition ${
                f.gemsOnly ? "ring-accent/60 text-accent bg-accent/10" : "ring-white/10 text-muted-foreground hover:text-foreground"
              }`}
              title="Hidden gems: stations hardly anyone is listening to right now"
            >
              <Gem className="w-3.5 h-3.5" /> Gems
            </button>
            <button
              onClick={() => set({ favsOnly: !f.favsOnly })}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 transition ${
                f.favsOnly ? "ring-amber-300/60 text-amber-200 bg-amber-300/10" : "ring-white/10 text-muted-foreground hover:text-foreground"
              }`}
              title="Only your favourite stations (Drift and Next stay within them too)"
            >
              <Star className={`w-3.5 h-3.5 ${f.favsOnly ? "fill-current" : ""}`} />
              {p.favIds.size > 0 ? p.favIds.size : "Faves"}
            </button>
          </div>

          {/* Results */}
          {active && (
            <div className="border-t border-white/10 flex flex-col flex-1 min-h-0">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground flex justify-between shrink-0">
                <span>{p.searching ? "Searching…" : `${p.matched.length.toLocaleString()} on the globe`}</span>
                {p.matched.length > list.length && <span>showing {list.length}</span>}
              </div>
              <div className={`overflow-y-auto scroll-thin flex-1 min-h-[96px] pb-2 transition-opacity ${p.searching ? "opacity-50" : ""}`}>
                {list.map((s) => {
                  const fam = FAMILY_BY_ID[s.family];
                  const on = s.id === p.currentId;
                  const fav = p.favIds.has(s.id);
                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => p.onPick(s)}
                      onKeyDown={(e) => e.key === "Enter" && p.onPick(s)}
                      className={`group w-full text-left flex items-start gap-2.5 px-3 py-1.5 hover:bg-white/5 transition cursor-pointer ${on ? "bg-white/10" : ""}`}
                    >
                      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: fam.color }} />
                      <span className="min-w-0">
                        <span className="block text-sm truncate">{s.name}</span>
                        <span className="block text-[11px] text-muted-foreground truncate">
                          {placeLine(s)}
                          {s.tags.length > 0 && <span className="italic"> · {s.tags.slice(0, 3).join(", ")}</span>}
                        </span>
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onToggleFav(s);
                        }}
                        className={`ml-auto mt-0.5 p-1 rounded-full shrink-0 transition ${
                          fav ? "text-amber-300" : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-amber-200"
                        }`}
                        aria-label={fav ? "Remove from favourites" : "Add to favourites"}
                      >
                        <Star className={`w-3.5 h-3.5 ${fav ? "fill-current" : ""}`} />
                      </button>
                    </div>
                  );
                })}
                {p.matched.length === 0 && (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    {f.favsOnly && p.favIds.size === 0
                      ? "No favourites yet. Tap the ☆ next to a station's name to save it here."
                      : "Nothing on the globe matches that yet."}
                  </div>
                )}
              </div>
              {f.query.trim() && p.canDig && (
                <button
                  onClick={p.onDeepSearch}
                  disabled={p.deepSearching}
                  className="shrink-0 mx-3 my-2 flex items-center justify-center gap-2 rounded-xl ring-1 ring-white/10 hover:ring-white/25 px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground transition disabled:opacity-60"
                >
                  {p.deepSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span className="truncate">Dig deeper: search everywhere for “{f.query.trim()}”</span>
                </button>
              )}
              {p.deepNote && <div className="shrink-0 px-3 pb-2.5 -mt-1 text-[11px] text-muted-foreground">{p.deepNote}</div>}
            </div>
          )}

          {/* While results are listed, the + in the search row does this, so
              the list keeps the whole panel */}
          {!active && (
            <button
              onClick={p.onAddStation}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-t border-white/10 text-[12px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add a station by its stream link
            </button>
          )}
        </div>
      )}
    </div>
  );
}
