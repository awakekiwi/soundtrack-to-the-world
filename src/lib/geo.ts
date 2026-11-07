import tzlookup from "tz-lookup";

// Plain-maths sun and time helpers (no three.js, so the player and panels
// can use them without waiting for the globe to load)

// The equation of time: a sundial and a clock drift apart by up to ~16
// minutes over the year. Without it the terminator can be several degrees off.
function equationOfTimeMinutes(dayOfYear: number) {
  const B = ((2 * Math.PI) / 365) * (dayOfYear - 81);
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

/** Where the sun is directly overhead right now */
export function subsolarPoint(now = new Date()) {
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start) / 86400000);
  return {
    lat: 23.45 * Math.sin(((2 * Math.PI) / 365) * (284 + dayOfYear)),
    lon: (12 - hours - equationOfTimeMinutes(dayOfYear) / 60) * 15,
  };
}

/** Is it night at this place? (sun a little below the horizon) */
export function isNightAt(lat: number, lon: number) {
  const sun = subsolarPoint();
  const r = Math.PI / 180;
  const cosAngle =
    Math.sin(lat * r) * Math.sin(sun.lat * r) + Math.cos(lat * r) * Math.cos(sun.lat * r) * Math.cos((lon - sun.lon) * r);
  return cosAngle < -0.05;
}

export function localTime(lat: number, lon: number) {
  const now = new Date();
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tzlookup(lat, lon), hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  } catch {
    const total = (now.getUTCHours() + now.getUTCMinutes() / 60 + lon / 15 + 24) % 24;
    const h = Math.floor(total);
    return `${String(h).padStart(2, "0")}:${String(Math.floor((total - h) * 60)).padStart(2, "0")}`;
  }
}
