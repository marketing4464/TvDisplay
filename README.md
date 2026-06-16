# TvDisplay

SignalDeck Signage MVP for displaying media on all OPE TVs.

A Vercel-hosted signage dashboard and fullscreen player with shared Supabase media storage.

## What it does

- Upload images and videos into Supabase Storage.
- Create generated slides for quick signage tests.
- Build playlists from media assets.
- Create screen/player endpoints.
- Change a screen's assigned playlist without changing its player URL.
- Copy a fullscreen player URL for each screen.
- Run a player route that loops assigned media and can feed HDMI into a Just Add Power encoder.

For step-by-step operating instructions, see [USER_GUIDE.md](./USER_GUIDE.md).

## How to run

Open `index.html` in a browser, or serve this folder with any simple static server. The app connects to Supabase for shared storage. If Supabase is unreachable, it falls back to browser-only storage.

Example with Python:

```bash
python3 -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

Or use the npm script:

```bash
npm run dev
```

## Deploy to Vercel

This project deploys to Vercel as a static site. No Vercel Blob store or API routes are required.

Recommended flow:

```bash
git init
git add .
git commit -m "Initial SignalDeck Vercel app"
```

Then import this repository into Vercel as a static project. No build command is required, and the output directory can be left blank/default.

## Shared cloud storage

This app now uses the Supabase project `TvDisplay`:

- Project URL: `https://hvwnnvpafepmoczlvaea.supabase.co`
- Storage bucket: `signaldeck-media`
- State table: `public.signaldeck_state`

Uploaded files are saved in Supabase Storage. Media, playlists, screens, and schedules are saved in the Supabase state table. If Supabase is unavailable, the dashboard shows `Local only` and falls back to browser-only storage.

## Kiosk player idea

On a player mini PC, open the screen-specific URL from the Screens view in fullscreen kiosk mode.

For Chromium on Linux, the command will look like:

```bash
chromium-browser --kiosk http://localhost:5173/#/player/screen-lobby
```

## Current limitations

- There is no login/user management yet, so anyone with the dashboard URL can make changes.
- The current Supabase policies allow public read/write access so unattended player devices can sync without signing in.
- Player pages refresh shared state about once per minute, so updates are not instant.
- Video wall synchronization is not frame-accurate yet.
