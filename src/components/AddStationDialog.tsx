import { useState } from "react";
import { Check, Copy, Globe2, Loader2, MapPin, Plus, Search, Trash2, X } from "lucide-react";
import { FAMILIES, placeLine, type FamilyId, type Station } from "@/lib/stations";
import { asBuiltinSnippet, checkStream, findPlaces, isHlsLink, resolveLink, shareStation, type PlaceHit } from "@/lib/addStation";

interface Props {
  mine: Station[];
  onSave: (s: Station) => void;
  /** Update one of your stations (e.g. after sharing it) */
  onUpdate: (s: Station) => void;
  onRemove: (id: string) => void;
  onPlay: (s: Station) => void;
  onClose: () => void;
}

const field = "w-full bg-white/5 ring-1 ring-white/10 focus:ring-white/30 rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

export default function AddStationDialog({ mine, onSave, onUpdate, onRemove, onPlay, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [check, setCheck] = useState<{ busy: boolean; ok?: boolean; note?: string }>({ busy: false });
  const [placeQ, setPlaceQ] = useState("");
  const [places, setPlaces] = useState<PlaceHit[] | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeErr, setPlaceErr] = useState<string | null>(null);
  const [place, setPlace] = useState<PlaceHit | null>(null);
  const [family, setFamily] = useState<FamilyId>("eclectic");
  const [tags, setTags] = useState("");
  const [shareToo, setShareToo] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const note = (id: string, msg: string) => setNotes((n) => ({ ...n, [id]: msg }));

  const share = async (s: Station) => {
    setBusyId(s.id);
    const r = await shareStation(s);
    setBusyId(null);
    note(s.id, r.message);
    if (r.ok) onUpdate({ ...s, sharedAt: Date.now() });
    return r;
  };

  const copy = async (s: Station) => {
    try {
      await navigator.clipboard.writeText(asBuiltinSnippet(s));
      note(s.id, "Copied. Paste it to Claude, or into src/lib/builtinStations.ts.");
    } catch {
      note(s.id, "Couldn't copy here. Try again from the live site.");
    }
  };

  const runCheck = async () => {
    if (!url.trim()) return;
    setCheck({ busy: true });
    const real = await resolveLink(url);
    if (real !== url.trim()) setUrl(real);
    const r = await checkStream(real);
    setCheck({ busy: false, ok: r.ok, note: r.note });
    if (r.name && !name.trim()) setName(r.name);
  };

  const searchPlace = async () => {
    if (!placeQ.trim()) return;
    setPlaceBusy(true);
    setPlaceErr(null);
    try {
      const hits = await findPlaces(placeQ);
      setPlaces(hits);
      if (hits.length === 0) setPlaceErr("No places found. Try a town and country.");
    } catch (e) {
      setPlaceErr(e instanceof Error ? e.message : "Place search failed");
    } finally {
      setPlaceBusy(false);
    }
  };

  const linkOk = /^https?:\/\/\S+$/i.test(url.trim());
  const canSave = linkOk && !!name.trim() && !!place;

  const save = async () => {
    if (!canSave || !place) return;
    const real = await resolveLink(url);
    const extraTags = tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const fam = FAMILIES.find((f) => f.id === family)!;
    const s: Station = {
      id: `mine-${Date.now().toString(36)}`,
      name: name.trim(),
      url: real,
      country: place.country,
      countryCode: place.countryCode,
      state: place.state,
      lat: place.lat,
      lon: place.lon,
      tags: extraTags.length ? extraTags : [fam.label.toLowerCase()],
      languages: [],
      clicks: 0,
      votes: 0,
      family,
      hls: isHlsLink(real) || undefined,
    };
    onSave(s);
    if (shareToo) {
      const r = await shareStation(s);
      if (r.ok) onUpdate({ ...s, sharedAt: Date.now() });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-[2px] animate-in fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[92vh] overflow-y-auto scroll-thin rounded-2xl bg-popover/95 ring-1 ring-white/10 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="font-display italic text-xl">Add a station</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pb-4 space-y-4">
          {/* Link */}
          <div className="space-y-1.5">
            <label className="text-[12px] text-muted-foreground">Stream link</label>
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setCheck({ busy: false });
                }}
                onBlur={() => linkOk && check.ok === undefined && !check.busy && runCheck()}
                placeholder="https://…/stream.mp3 or …/playlist.m3u8"
                className={field}
                autoFocus
              />
              <button
                onClick={runCheck}
                disabled={!linkOk || check.busy}
                className="shrink-0 px-3 rounded-lg ring-1 ring-white/10 hover:ring-white/30 text-sm disabled:opacity-40"
              >
                {check.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
              </button>
            </div>
            {check.note && (
              <p className={`text-[12px] flex items-center gap-1.5 ${check.ok ? "text-emerald-300" : "text-amber-300"}`}>
                {check.ok && <Check className="w-3.5 h-3.5" />}
                {check.note}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground/80">
              Tip: on a station's own site, its "listen" link often ends in .mp3, .aac, .pls, .m3u or .m3u8.
            </p>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[12px] text-muted-foreground">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Radio Active 88.6" className={field} />
          </div>

          {/* Place */}
          <div className="space-y-1.5">
            <label className="text-[12px] text-muted-foreground">Where it broadcasts from</label>
            {place ? (
              <div className="flex items-center gap-2 rounded-lg bg-white/5 ring-1 ring-emerald-300/30 px-3 py-2 text-sm">
                <MapPin className="w-4 h-4 text-emerald-300 shrink-0" />
                <span className="truncate">{[place.state, place.country].filter(Boolean).join(", ") || place.label}</span>
                <button onClick={() => setPlace(null)} className="ml-auto text-[12px] text-muted-foreground hover:text-foreground">
                  change
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={placeQ}
                    onChange={(e) => setPlaceQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchPlace()}
                    placeholder="Town or city, country"
                    className={field}
                  />
                  <button
                    onClick={searchPlace}
                    disabled={!placeQ.trim() || placeBusy}
                    className="shrink-0 px-3 rounded-lg ring-1 ring-white/10 hover:ring-white/30 disabled:opacity-40"
                    aria-label="Find place"
                  >
                    {placeBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </button>
                </div>
                {placeErr && <p className="text-[12px] text-amber-300">{placeErr}</p>}
                {places && places.length > 0 && (
                  <div className="rounded-lg ring-1 ring-white/10 overflow-hidden">
                    {places.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setPlace(h);
                          setPlaces(null);
                        }}
                        className="w-full text-left px-3 py-2 text-[12px] hover:bg-white/5 border-b border-white/5 last:border-0"
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Style */}
          <div className="space-y-1.5">
            <label className="text-[12px] text-muted-foreground">Style (sets its colour on the globe)</label>
            <div className="flex flex-wrap gap-1.5">
              {FAMILIES.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFamily(f.id)}
                  className={`flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-[12px] ring-1 transition ${
                    family === f.id ? "bg-white/15 ring-white/30" : "ring-white/10 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: f.color }} />
                  {f.label}
                </button>
              ))}
            </div>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated (optional): grime, talk, student" className={field} />
          </div>

          <label className="flex items-start gap-2 text-[12px] text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={shareToo} onChange={(e) => setShareToo(e.target.checked)} className="mt-0.5 accent-[hsl(var(--primary))]" />
            <span>
              Also share it with everyone. It goes into Radio Browser, the open directory this app (and many other radio apps) use. Only
              share real stations that are public.
            </span>
          </label>

          <button
            onClick={save}
            disabled={!canSave}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-medium disabled:opacity-40 active:scale-[0.99] transition"
          >
            <Plus className="w-4 h-4" /> Add to the globe
          </button>
          {!canSave && <p className="text-[11px] text-muted-foreground text-center -mt-2">Needs a link, a name and a place.</p>}

          {/* Your stations */}
          {mine.length > 0 && (
            <div className="pt-2 border-t border-white/10">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Stations you've added</div>
              {mine.map((s) => (
                <div key={s.id} className="py-1.5">
                <div className="flex items-center gap-1">
                  <button onClick={() => onPlay(s)} className="min-w-0 text-left flex-1 hover:underline underline-offset-2">
                    <span className="block text-sm truncate">{s.name}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {placeLine(s)}
                      {s.sharedAt ? " · shared" : ""}
                    </span>
                  </button>
                  <button
                    onClick={() => share(s)}
                    disabled={busyId === s.id || !!s.sharedAt}
                    className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground disabled:opacity-40"
                    title={s.sharedAt ? "Already shared" : "Share with everyone (Radio Browser)"}
                    aria-label={`Share ${s.name}`}
                  >
                    {busyId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe2 className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => copy(s)}
                    className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground"
                    title="Copy its details (to make it a built-in station)"
                    aria-label={`Copy ${s.name}`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onRemove(s.id)}
                    className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground hover:text-red-300"
                    aria-label={`Remove ${s.name}`}
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {notes[s.id] && <p className="text-[11px] text-muted-foreground mt-0.5">{notes[s.id]}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
