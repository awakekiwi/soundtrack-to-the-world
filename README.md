# Soundtrack to the World

Spin the globe and tune into radio from anywhere. A spin-off of Sun Chaser Live:
same globe, live day/night line and fly-to camera, with radio stations instead of webcams.

## Run it

```
npm install
npm run dev        # http://localhost:8080
npm run build      # production build in dist/
```

## What's in it

- **Globe**: day side, night side lit by city lights, dusk/dawn glow on the terminator
  (ported from Sun Chaser). Station dots are one GPU point cloud, so thousands stay smooth.
- **Dots coloured by sound family**: electronic, chill, rock, jazz/soul, hip hop/reggae,
  classical, world/folk, pop, talk/community, eclectic. Families are worked out from each
  station's tags in `src/lib/stations.ts` (`FAMILIES`), so tweak the word lists there.
- **Search + filters**: free text (place, style, name), family chips, language, and
  "Hidden gems" (stations hardly anyone is listening to). Non-matching dots sink back.
  "Dig deeper" asks the full directory and adds what it finds to the globe.
- **Player**: two decks crossfade between stations, with soft dial static while tuning
  (toggle "static"). Dead streams auto-skip to the nearest neighbour.
  - Next = nearest station you haven't heard ("along the dial")
  - Shuffle = surprise me (favours small stations)
  - Drift = wanders on its own every 2/5/10/20 minutes, hopping a few hundred to a few
    thousand km each time, with a slow camera glide
- **Song titles**: the current artist and song under the station name (tap to look it up),
  plus a "tracks heard" list with YouTube/Bandcamp links, kept on this device.
- **Recording**: saves the stream exactly as it arrives (no re-encoding) as
  `Station – date time.mp3/.aac/.ogg`. Recording is its own connection, so you can keep
  recording one station while you listen to or drift through others. Auto-saves if the
  stream ends or the connection drops. Keep it for personal listening.
- **Keys**: Space play/pause, N or → next, B or ← back, S surprise, D drift, R record.
- **Phone lock screen**: Media Session controls (next/back/pause) on Android.

## Data

Radio Browser (radio-browser.info): free and open, no key. First load pulls ~4,000 popular
stations plus ~3,000 random ones (only those with coordinates and https streams), in pages,
so dots fade in as they arrive. The trimmed list is cached in the browser for 24 hours.

## Helper Worker (song titles + recording any station)

Browsers can't read most stations' song titles or record them directly, so a tiny free
Cloudflare Worker in `worker/` does it. It talks to stations over raw sockets, so it handles
custom ports (:8000 etc.) and old Shoutcast servers. Only the sites listed in
`ALLOWED_ORIGINS` (in `worker/wrangler.toml`) can use it.

One-time setup (free Cloudflare account):

```
cd worker
npm install
npx wrangler login      # opens the browser to sign in
npx wrangler deploy     # prints your URL, e.g. https://stw-proxy.<name>.workers.dev
```

Then in the main folder create `.env.local` with
`VITE_PROXY_URL=https://stw-proxy.<name>.workers.dev` and restart `npm run dev`.
For the live site, add the same URL as a repo variable named `PROXY_URL`.

Free-plan note: song-title lookups are tiny. Long recordings through the Worker stream for
the whole recording, which the free plan generally handles, but if very long ones get cut
off, that's the limit to look at.

## Accounts (sign in + sync across devices)

Uses a free Supabase project. Without it the app works as before, with
everything saved on each device.

1. Create a project at supabase.com (a new one, separate from Sun Chaser).
2. **SQL Editor → New query**: paste `supabase/schema.sql`, then **Run**.
3. **Authentication → URL Configuration**:
   - Site URL: `https://awakekiwi.github.io/soundtrack-to-the-world/`
   - Redirect URLs: add that, plus `http://localhost:8080/` for testing
4. **Project Settings → API**: copy the Project URL and the `anon` (publishable) key.
5. Put them in `.env.local` for local testing:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   ```
   and as GitHub repo variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the live site.
   (The anon key is meant to be public: the database rules in schema.sql decide what it can do.)

Sign-in is by emailed link (no passwords). Optional Google sign-in: switch on
the Google provider in Supabase (Authentication → Sign In / Providers, which
needs a Google Cloud OAuth client), then set the repo variable `GOOGLE_AUTH=1`.

Important before launch: Supabase's built-in email sender only delivers to
your own project team's addresses (so you can test with your own email) and
only 2 emails an hour. Real listeners won't get sign-in links until you add
your own email sender: e.g. Resend (free tier), in Authentication → Emails →
SMTP Settings.

Pro: the `pro_users` table marks who has upgraded. Only the payment system
(coming later) can add people; the app can only read it.

## Put it online (GitHub Pages)

1. Create a GitHub repo `soundtrack-to-the-world` and push this folder to `main`.
2. Repo Settings → Pages → Source: **GitHub Actions**.
3. Each push builds and publishes to `https://awakekiwi.github.io/soundtrack-to-the-world/`.

Pages needs a public repo on a free GitHub account.

## Files

- `src/lib/stations.ts`: directory loading, caching, families, filters, geo helpers
- `src/lib/useRadio.ts`: two-deck crossfading player + dial static
- `src/lib/geo.ts`: sun position, night check, local time
- `src/components/Globe.tsx`: three.js globe, dots, picking, camera
- `src/components/PlayerBar.tsx`, `src/components/TunePanel.tsx`: UI
- `src/lib/useNowPlaying.ts`, `src/lib/useRecorder.ts`: song titles, recording
- `src/components/TracksPanel.tsx`, `src/components/RecordingPill.tsx`: their UI
- `src/App.tsx`: wiring, drift, next/surprise logic
- `worker/src/index.ts`: the helper Worker

## Not done yet

- Stations without coordinates (country only) aren't on the globe yet
- Capacitor/Android wrapper (same route as Sun Chaser when ready)
- Favourites
- Playing http-only stations through the Worker (it could relay them over https)
