import { useEffect, useMemo, useState } from "react";
import { ChevronUp, Gem, Globe2, Loader2, Plus, Search, SlidersHorizontal, Star, X } from "lucide-react";
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
  /** Changes when the globe is touched: on phones, fold the panel away */
  collapseKey?: number;
}

const isPhone = () => typeof window !== "undefined" && window.innerWidth < 640;

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export default function TunePanel(p: Props) {
  // Folded on phones so the globe gets the screen; open on bigger screens
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  const f = p.filters;
  const active = filtersActive(f);
  const set = (patch: Partial<Filters>) => p.setFilters({ ...f, ...patch });
  const toggleFamily = (id: FamilyId) =>
    set({ families: f.families.includes(id) ? f.families.filter((x) => x !== id) : [...f.families, id] });

  // On phones the globe matters most: picking a station (or touching the
  // globe) folds the panel away and drops the keyboard; the chosen filters
  // stay pinned under the search box
  const fold = () => {
    if (!isPhone()) return;
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const pick = (s: Station) => {
    p.onPick(s);
    fold();
  };
  useEffect(() => {
    if (p.collapseKey) fold();
  }, [p.collapseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterCount = f.families.length + (f.language ? 1 : 0) + (f.gemsOnly ? 1 : 0) + (f.favsOnly ? 1 : 0);
  // Once a style is picked, the full set of style buttons tucks away (the
  // picked ones sit under the search box); "+ Style" brings them back
  const [addingStyle, setAddingStyle] = useState(false);
  const showStyles = f.families.length === 0 || addingStyle;
  useEffect(() => {
    if (f.families.length === 0) setAddingStyle(false);
  }, [f.families.length]);
  const pickStyle = (id: FamilyId) => {
    toggleFamily(id);
    setAddingStyle(false);
  };

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
          placeholder="Search stations, places…"
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
          onClick={() => set({ favsOnly: !f.favsOnly })}
          className={`flex items-center gap-1 shrink-0 px-1.5 py-1 rounded-full transition active:scale-95 ${
            f.favsOnly ? "bg-amber-300/15 text-amber-200 ring-1 ring-amber-300/50" : "text-muted-foreground hover:text-amber-200"
          }`}
          aria-label={f.favsOnly ? "Show all stations" : "Show your favourites"}
          aria-pressed={f.favsOnly}
          title="Your favourites"
        >
          <Star className={`w-4 h-4 ${f.favsOnly || p.favIds.size > 0 ? "fill-current" : ""} ${!f.favsOnly && p.favIds.size > 0 ? "text-amber-300/80" : ""}`} />
          {p.favIds.size > 0 && <span className="text-[11px] tabular-nums">{p.favIds.size}</span>}
        </button>
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
          className={`flex items-center gap-1.5 shrink-0 pl-2 pr-2.5 py-1 rounded-full text-[12px] font-medium ring-1 transition active:scale-95 ${
            open ? "ring-white/15 text-muted-foreground hover:text-foreground" : "bg-primary/15 ring-primary/40 text-primary hover:bg-primary/25"
          }`}
          aria-label={open ? "Hide filters" : "Show filters"}
          aria-expanded={open}
        >
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <SlidersHorizontal className="w-3.5 h-3.5" />}
          {open ? "Hide" : "Filters"}
          {!open && filterCount > 0 && (
            <span className="min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 text-center">{filterCount}</span>
          )}
        </button>
      </div>

      {/* The chosen filters stay pinned under the search box, open or
          folded. Tap × to drop one (the full set of styles comes back) */}
      {(filterCount - (f.favsOnly ? 1 : 0) > 0 || (open && f.families.length > 0)) && (
        <div className="flex items-center gap-1.5 px-3 pb-2.5 -mt-0.5 overflow-x-auto scroll-thin shrink-0 [&>*]:shrink-0">
          {f.families.map((id) => {
            const fam = FAMILY_BY_ID[id];
            return (
              <Pinned key={id} onRemove={() => toggleFamily(id)} label={`Remove ${fam.label}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: fam.color, boxShadow: `0 0 6px ${fam.color}` }} />
                {fam.label}
              </Pinned>
            );
          })}
          {f.language && (
            <Pinned onRemove={() => set({ language: "" })} label="Remove language">
              <Globe2 className="w-3 h-3" />
              {titleCase(f.language)}
            </Pinned>
          )}
          {f.gemsOnly && (
            <Pinned onRemove={() => set({ gemsOnly: false })} label="Remove hidden gems">
              <Gem className="w-3 h-3" />
              Gems
            </Pinned>
          )}
          {open && f.families.length > 0 && !addingStyle && (
            <button
              onClick={() => setAddingStyle(true)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-white/25 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-3 h-3" /> Style
            </button>
          )}
          {!open && (
            <button onClick={() => setOpen(true)} className="text-[11px] text-muted-foreground hover:text-foreground pl-1">
              {p.searching ? "…" : `${p.matched.length.toLocaleString()} stations`}
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="flex flex-col flex-1 min-h-0 border-t border-white/10 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Sound families (tucked away once one is picked: see above) */}
          {/* While results are listed, the chips fold into one sideways-
              scrolling row so the list gets the room */}
          {showStyles && (
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
                  onClick={() => pickStyle(fam.id)}
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
          )}

          {/* Language + gems */}
          <div className={`px-3 pb-3 flex items-center gap-2 shrink-0 ${showStyles ? "pt-2.5" : "pt-1"}`}>
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
                      onClick={() => pick(s)}
                      onKeyDown={(e) => e.key === "Enter" && pick(s)}
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

/** A small filter chip pinned under the search box, with an × to remove it */
function Pinned({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full bg-white/10 ring-1 ring-white/15 text-[11px] text-foreground">
      {children}
      <button onClick={onRemove} className="p-0.5 rounded-full hover:bg-white/15 text-muted-foreground hover:text-foreground" aria-label={label}>
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
