import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { PROXY_URL } from "./config";
import { countClick, type Station } from "./stations";

export type RadioStatus = "idle" | "tuning" | "playing" | "paused" | "error";

const FADE_MS = 1400;
/** Give up on a stream that hasn't started after this long */
const START_TIMEOUT_MS = 12000;
/** Stop auto-skipping after this many dead streams in a row */
const MAX_FAILS = 6;

// ---------------------------------------------------------------------------
// Dial static: a soft band of filtered noise that plays while a station is
// tuning in, like turning an old radio dial. Made with Web Audio, separate
// from the streams themselves (most stations don't allow their audio to be
// routed through Web Audio, so the streams stay plain <audio> elements and
// their fades are done on the element volume).
// ---------------------------------------------------------------------------
class DialStatic {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;

  private ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Noise with the odd crackle, so it sounds like air rather than hiss
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.002 ? 3 : 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1700;
    band.Q.value = 0.6;
    // A slow wobble on the filter, like drifting between frequencies
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.7;
    lfoDepth.gain.value = 600;
    lfo.connect(lfoDepth).connect(band.frequency);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start();
    lfo.start();
    this.ctx = ctx;
    this.gain = gain;
    return ctx;
  }

  context() {
    return this.ensure();
  }

  /** Call from a tap/click the first time, so the browser lets it make sound */
  unlock() {
    const ctx = this.ensure();
    if (ctx?.state === "suspended") ctx.resume().catch(() => {});
  }

  on(level: number) {
    const ctx = this.ensure();
    if (!ctx || !this.gain) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const g = this.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(level, ctx.currentTime, 0.08);
  }

  off(slow = false) {
    if (!this.ctx || !this.gain) return;
    const g = this.gain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(0, this.ctx.currentTime, slow ? 0.45 : 0.1);
  }
}

// ---------------------------------------------------------------------------
// Level meter: how loud the station is right now (0–1), for the pulsing dot
// on the globe. It listens to a copy of the stream (captureStream), so what
// you hear is untouched. Browsers only allow this when the station permits
// web pages to read its audio; otherwise read() reports -1 and the dot just
// pulses gently. Reading ~128 samples a frame costs next to nothing.
// ---------------------------------------------------------------------------
class LevelMeter {
  private analyser: AnalyserNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private buf = new Uint8Array(256);
  private level = 0;
  private lastSound = 0;

  attach(ctx: AudioContext | null, el: HTMLAudioElement) {
    this.detach();
    const capture = (el as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream;
    if (!ctx || !capture) return;
    try {
      const stream = capture.call(el);
      const connect = () => {
        try {
          this.src = ctx.createMediaStreamSource(stream);
          this.analyser = ctx.createAnalyser();
          this.analyser.fftSize = 256;
          this.analyser.smoothingTimeConstant = 0;
          // A silent output keeps the analyser running in every browser
          this.sink = ctx.createGain();
          this.sink.gain.value = 0;
          this.src.connect(this.analyser).connect(this.sink).connect(ctx.destination);
        } catch {
          this.detach();
        }
      };
      if (stream.getAudioTracks().length) connect();
      else stream.addEventListener("addtrack", connect, { once: true });
    } catch {
      /* this stream can't be read by the page */
    }
  }

  detach() {
    try {
      this.src?.disconnect();
      this.analyser?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* already gone */
    }
    this.src = this.analyser = this.sink = null;
    this.level = 0;
  }

  /** 0–1 when the audio can be measured, -1 when it can't */
  read(): number {
    if (!this.analyser) return -1;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.buf.length);
    const now = performance.now();
    if (rms > 0.004) this.lastSound = now;
    // Quick to rise, slow to fall, like a VU needle
    const target = Math.min(1, rms * 3.2);
    this.level += (target - this.level) * (target > this.level ? 0.5 : 0.08);
    // A blocked stream reads as pure silence: after a few seconds, say so
    return now - this.lastSound < 3000 ? this.level : -1;
  }
}

function fadeVolume(el: HTMLAudioElement, to: () => number, ms: number, done?: () => void) {
  const from = el.volume;
  const start = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const t = Math.min((now - start) / ms, 1);
    const eased = t * t * (3 - 2 * t);
    el.volume = Math.max(0, Math.min(1, from + (to() - from) * eased));
    if (t < 1) raf = requestAnimationFrame(step);
    else done?.();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

function silence(el: HTMLAudioElement) {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

/**
 * Radio player with two "decks": a new station tunes in on the spare deck
 * under a little dial static, then crossfades over the old one, so moving
 * between stations flows instead of clicking. A stream that won't start is
 * reported through onFail, so the caller can tune somewhere else.
 */
export function useRadio({ onFail }: { onFail: (station: Station, failsInARow: number) => void }) {
  const decks = useRef<[HTMLAudioElement, HTMLAudioElement] | null>(null);
  const active = useRef(0);
  const token = useRef(0);
  const deckToken = useRef([0, 0]);
  const fades = useRef<(() => void)[]>([]);
  /** When the current crossfade finishes (the slider takes over after that) */
  const fadeEnds = useRef(0);
  const startTimer = useRef<number | undefined>();
  const fails = useRef(0);
  const dial = useRef<DialStatic | null>(null);
  const meter = useRef(new LevelMeter());
  // Servers that refused the "let web pages read me" request: don't ask again
  const noCors = useRef(new Set<string>());
  const corsRetried = useRef(0);
  // HLS stations play through hls.js, one instance per deck
  const hlsOn = useRef<(Hls | null)[]>([null, null]);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  const [station, setStation] = useState<Station | null>(null);
  const [status, setStatus] = useState<RadioStatus>("idle");
  const [volume, setVolumeState] = useState(0.75);
  const [staticOn, setStaticOn] = useState(true);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const staticRef = useRef(staticOn);
  staticRef.current = staticOn;
  const stationRef = useRef<Station | null>(null);
  stationRef.current = station;

  if (!decks.current && typeof Audio !== "undefined") {
    const make = () => {
      const a = new Audio();
      a.preload = "none";
      return a;
    };
    decks.current = [make(), make()];
    dial.current = new DialStatic();
  }

  const dropHls = (i: number) => {
    hlsOn.current[i]?.destroy();
    hlsOn.current[i] = null;
  };
  const silenceDeck = (i: number) => {
    dropHls(i);
    const d = decks.current;
    if (d) silence(d[i]);
  };

  const stopFades = () => {
    fades.current.forEach((c) => c());
    fades.current = [];
  };

  // Deck events: only the deck holding the current tune counts
  useEffect(() => {
    const d = decks.current;
    if (!d) return;
    const cleanups = d.map((el, i) => {
      const onPlaying = () => {
        if (deckToken.current[i] !== token.current) return;
        window.clearTimeout(startTimer.current);
        fails.current = 0;
        dial.current?.off(true);
        setStatus("playing");
        meter.current.attach(dial.current?.context() ?? null, el);
        if (i !== active.current) {
          // Crossfade: new deck up, old deck down and silenced
          const oldIndex = active.current;
          const old = d[oldIndex];
          stopFades();
          fadeEnds.current = performance.now() + FADE_MS + 50;
          fades.current.push(fadeVolume(el, () => volumeRef.current, FADE_MS));
          fades.current.push(fadeVolume(old, () => 0, FADE_MS, () => silenceDeck(oldIndex)));
          active.current = i;
          const s = stationRef.current;
          if (s) countClick(s.id);
        }
      };
      const onWaiting = () => {
        if (deckToken.current[i] === token.current && i === active.current) setStatus("tuning");
      };
      const onError = () => {
        if (deckToken.current[i] !== token.current) return;
        // Asked the station to let the page read its audio (for the level
        // meter) and it refused: play it the normal way instead
        if (el.crossOrigin === "anonymous" && !el.src.startsWith(PROXY_URL || "\u0000") && corsRetried.current !== token.current) {
          corsRetried.current = token.current;
          const src = el.src;
          try {
            noCors.current.add(new URL(src).host);
          } catch {
            /* odd url */
          }
          el.removeAttribute("crossorigin");
          el.src = src;
          el.play().catch(() => {});
          return;
        }
        fail();
      };
      el.addEventListener("playing", onPlaying);
      el.addEventListener("waiting", onWaiting);
      el.addEventListener("error", onError);
      return () => {
        el.removeEventListener("playing", onPlaying);
        el.removeEventListener("waiting", onWaiting);
        el.removeEventListener("error", onError);
      };
    });
    return () => cleanups.forEach((c) => c());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = () => {
    window.clearTimeout(startTimer.current);
    const s = stationRef.current;
    fails.current += 1;
    if (fails.current >= MAX_FAILS || !s) {
      dial.current?.off();
      setStatus("error");
      return;
    }
    onFailRef.current(s, fails.current);
  };

  /**
   * HLS: the stream arrives as a playlist of short chunks. hls.js plays it
   * on most browsers; where it can't run, the browser's own HLS support
   * (Android, Safari) is tried. If a station blocks web pages from reading
   * it directly, it's retried once through the helper Worker.
   */
  const startHls = async (deck: number, el: HTMLAudioElement, st: Station, t: number, playEl: () => void) => {
    let HlsLib: typeof Hls;
    try {
      HlsLib = (await import("hls.js")).default;
    } catch {
      if (token.current === t) fail();
      return;
    }
    if (token.current !== t) return;

    el.removeAttribute("crossorigin");
    if (!HlsLib.isSupported()) {
      if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = st.url;
        playEl();
      } else fail();
      return;
    }

    const attempt = (src: string, viaProxy: boolean) => {
      const h = new HlsLib({ maxBufferLength: 20, backBufferLength: 10 });
      hlsOn.current[deck] = h;
      h.on(HlsLib.Events.ERROR, (_e, data) => {
        if (!data.fatal || token.current !== t) return;
        dropHls(deck);
        if (!viaProxy && PROXY_URL && data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
          attempt(`${PROXY_URL}/hls?url=${encodeURIComponent(st.url)}`, true);
        } else fail();
      });
      h.on(HlsLib.Events.MANIFEST_PARSED, () => {
        if (token.current === t) playEl();
      });
      h.loadSource(src);
      h.attachMedia(el);
    };
    attempt(st.url, false);
  };

  const tune = useCallback((next: Station) => {
    const d = decks.current;
    if (!d) return;
    dial.current?.unlock();
    const t = ++token.current;
    const spare = 1 - active.current;
    const el = d[spare];
    deckToken.current[spare] = t;
    setStation(next);
    setStatus("tuning");
    if (staticRef.current) dial.current?.on(0.05 * volumeRef.current + 0.01);

    // If nothing is playing on the old deck there's nothing to fade from,
    // so the new one can come straight up
    el.volume = d[active.current].paused ? volumeRef.current : 0;
    dropHls(spare);

    const playEl = () =>
      el.play().catch((err: DOMException) => {
        if (token.current !== t) return;
        if (err?.name === "NotAllowedError") {
          // The browser wants a tap before sound starts
          dial.current?.off();
          setStatus("paused");
        }
        // Anything else surfaces as the element's error event
      });

    if (next.hls) startHls(spare, el, next, t, playEl);
    else {
      // A plain http:// stream is blocked on a secure (https) page, so it
      // plays through the helper Worker, which serves it over https
      const relay = next.url.startsWith("http://") && location.protocol === "https:" && !!PROXY_URL;
      let host = "";
      try {
        host = new URL(next.url).host;
      } catch {
        /* odd url */
      }
      // Ask to read the audio (for the level meter) unless this server
      // already said no; the relay always allows it
      if (relay || !noCors.current.has(host)) el.crossOrigin = "anonymous";
      else el.removeAttribute("crossorigin");
      el.src = relay ? `${PROXY_URL}/stream?url=${encodeURIComponent(next.url)}` : next.url;
      playEl();
    }
    window.clearTimeout(startTimer.current);
    startTimer.current = window.setTimeout(() => {
      if (token.current === t) fail();
    }, START_TIMEOUT_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pause = useCallback(() => {
    const d = decks.current;
    if (!d) return;
    window.clearTimeout(startTimer.current);
    dial.current?.off();
    stopFades();
    d.forEach((el, i) => (i === active.current ? el.pause() : silenceDeck(i)));
    token.current++;
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    const s = stationRef.current;
    if (!s) return;
    // Live streams drift if resumed, so tune in fresh
    silenceDeck(active.current);
    fails.current = 0;
    tune(s);
  }, [tune]);

  const toggle = useCallback(() => {
    if (status === "playing" || status === "tuning") pause();
    else resume();
  }, [status, pause, resume]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    volumeRef.current = v;
    // Mid-crossfade, the fade itself heads for the new level; otherwise set it now
    const d = decks.current;
    if (d && performance.now() >= fadeEnds.current) d[active.current].volume = v;
  }, []);

  /** A fresh run of retries (e.g. the user picked a station themselves) */
  const resetFails = useCallback(() => {
    fails.current = 0;
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(startTimer.current);
      [0, 1].forEach(silenceDeck);
      dial.current?.off();
    },
    []
  );

  /** How loud it is right now (0–1), or -1 if this station can't be measured */
  const level = useCallback(() => meter.current.read(), []);

  return { station, status, volume, setVolume, staticOn, setStaticOn, tune, toggle, pause, resetFails, level };
}
