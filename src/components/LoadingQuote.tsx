import { useEffect, useRef, useState } from "react";

/**
 * Radio trivia (and a few lines of our own) in the middle of the screen
 * while the globe and stations load. Shown only if loading takes more than
 * a moment, kept up long enough to read, then fades away.
 */
const LINES = [
  "Christmas Eve, 1906: Reginald Fessenden broadcast voice and violin to ships at sea, one of the first radio programmes ever.",
  "In 1901 Marconi's team sent the letter S across the Atlantic by radio, from Cornwall to Newfoundland.",
  "New Zealand's first radio broadcast went out from Dunedin on 17 November 1921.",
  "KDKA in Pittsburgh began regular commercial radio in November 1920, with the US election results.",
  "The first music video MTV ever played, in 1981, was “Video Killed the Radio Star” by The Buggles.",
  "Queen's “Radio Ga Ga” (1984) was written by drummer Roger Taylor as a tribute to radio's golden age.",
  "“Broadcast” first meant scattering seed by hand across a field.",
  "Radio travels at the speed of light: a broadcast would reach the Moon in about 1.3 seconds.",
  "The first radio broadcasts are now around 100 light years out into space, still travelling.",
  "FM radio was invented by Edwin Armstrong, who patented it in 1933.",
  "In 1938 Orson Welles' radio play “The War of the Worlds” famously alarmed some listeners.",
  "Shortwave bounces off the ionosphere, so it can be heard on the other side of the world.",
  "Hollywood star Hedy Lamarr co-invented frequency hopping in 1942, an idea behind later wireless tech.",
  "The BBC made its first broadcasts in 1922.",
  "Somewhere, right now, someone is playing your next favourite song.",
  "Every place on Earth has a soundtrack. Let's go and find yours.",
  "Warming up the valves…",
  "Tuning across fifty thousand stations…",
];

const SHOW_AFTER_MS = 400;
const MIN_SHOWN_MS = 2800;
const NEXT_MS = 5500;

export default function LoadingQuote({ loading }: { loading: boolean }) {
  const [shown, setShown] = useState(false);
  const [visible, setVisible] = useState(false);
  const [i, setI] = useState(() => Math.floor(Math.random() * LINES.length));
  const shownAt = useRef(0);

  // Only bother if loading takes more than a moment
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => {
      shownAt.current = performance.now();
      setShown(true);
      requestAnimationFrame(() => setVisible(true));
    }, SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [loading]);

  // Once loaded, leave it up long enough to finish reading, then fade
  useEffect(() => {
    if (loading || !shown) return;
    const wait = Math.max(0, MIN_SHOWN_MS - (performance.now() - shownAt.current));
    const a = window.setTimeout(() => setVisible(false), wait);
    const b = window.setTimeout(() => setShown(false), wait + 700);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [loading, shown]);

  // A new line every few seconds on a slow connection
  useEffect(() => {
    if (!shown || !loading) return;
    const t = window.setInterval(() => setI((n) => (n + 1 + Math.floor(Math.random() * (LINES.length - 1))) % LINES.length), NEXT_MS);
    return () => window.clearInterval(t);
  }, [shown, loading]);

  if (!shown) return null;
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-8 transition-opacity duration-700 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      aria-live="polite"
    >
      <p key={i} className="max-w-md text-center font-display italic text-[15px] sm:text-lg leading-relaxed text-foreground/75 animate-in fade-in duration-700">
        {LINES[i]}
      </p>
    </div>
  );
}
