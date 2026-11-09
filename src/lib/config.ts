/**
 * The helper Worker (worker/ folder) that reads song titles and relays
 * streams for recording. Set it in a .env.local file:
 *   VITE_PROXY_URL=https://stw-proxy.<your-name>.workers.dev
 * Without it, song titles are off and only stations that allow it can be
 * recorded.
 */
export const PROXY_URL = ((import.meta.env.VITE_PROXY_URL as string | undefined) ?? "").replace(/\/+$/, "");

/**
 * Accounts (sign-in and syncing across devices) use Supabase. Set these in
 * .env.local, and as repo variables for the live site:
 *   VITE_SUPABASE_URL=https://<project>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<the project's "anon" / "publishable" key>
 *   VITE_GOOGLE_AUTH=1   (only once Google sign-in is switched on in Supabase)
 * Without them, the account button doesn't appear and everything stays on
 * the device as before.
 */
export const SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "").replace(/\/+$/, "");
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
export const ACCOUNTS_ON = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
export const GOOGLE_AUTH_ON = ACCOUNTS_ON && (import.meta.env.VITE_GOOGLE_AUTH as string | undefined) === "1";
