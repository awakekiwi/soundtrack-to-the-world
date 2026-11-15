import type { Station } from "./stations";

/** A link that opens the app, flies to this station and tunes in */
export function stationLink(s: Station) {
  const url = new URL(import.meta.env.BASE_URL, location.origin);
  url.searchParams.set("s", s.id);
  return url.toString();
}

/** The station id in a shared link, if the page was opened from one */
export function sharedStationId(): string | null {
  try {
    return new URLSearchParams(location.search).get("s");
  } catch {
    return null;
  }
}

/** Tidy the address bar once the shared station has been opened */
export function clearSharedParam() {
  try {
    const url = new URL(location.href);
    url.searchParams.delete("s");
    history.replaceState(null, "", url.toString());
  } catch {
    /* fine */
  }
}

/**
 * Share a station: the phone's own share sheet where there is one
 * (WhatsApp, Messages...), otherwise the link is copied.
 * Resolves "shared", "copied" or "failed".
 */
export async function shareStation(s: Station): Promise<"shared" | "copied" | "failed"> {
  const url = stationLink(s);
  const where = [s.state, s.country].filter(Boolean).join(", ");
  const text = `${s.name}${where ? `, live from ${where}` : ""}. Tune in on Soundtrack to the World`;
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: s.name, text, url });
      return "shared";
    } catch (e) {
      // Closing the share sheet isn't a failure
      if ((e as DOMException)?.name === "AbortError") return "shared";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
