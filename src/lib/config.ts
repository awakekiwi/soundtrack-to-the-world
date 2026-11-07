/**
 * The helper Worker (worker/ folder) that reads song titles and relays
 * streams for recording. Set it in a .env.local file:
 *   VITE_PROXY_URL=https://stw-proxy.<your-name>.workers.dev
 * Without it, song titles are off and only stations that allow it can be
 * recorded.
 */
export const PROXY_URL = ((import.meta.env.VITE_PROXY_URL as string | undefined) ?? "").replace(/\/+$/, "");
