# TvDisplay

SignalDeck Signage MVP for displaying media on all OPE TVs.

A local-first proof of concept for a custom BrightSign-style signage dashboard and fullscreen player.

## What it does

- Upload images and videos into local browser storage.
- Create generated slides for quick signage tests.
- Build playlists from media assets.
- Create screen/player endpoints.
- Copy a fullscreen player URL for each screen.
- Run a player route that loops assigned media and can feed HDMI into a Just Add Power encoder.

## How to run

Open `index.html` in a browser, or serve this folder with any simple static server.

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

This project is a static site and can be deployed directly to Vercel.

Recommended flow:

```bash
git init
git add .
git commit -m "Initial SignalDeck Vercel app"
```

Then import this repository into Vercel as a static project. No build command is required, and the output directory can be left blank/default.

## Kiosk player idea

On a player mini PC, open the screen-specific URL from the Screens view in fullscreen kiosk mode.

For Chromium on Linux, the command will look like:

```bash
chromium-browser --kiosk http://localhost:5173/#/player/screen-lobby
```

## MVP limitations

- Data is local to the browser/device.
- There is no cloud sync, login, or multi-user access yet.
- Uploaded media is cached in IndexedDB on the current browser.
- Video wall synchronization is not frame-accurate yet.

The next production step is a hosted dashboard, real file storage, player heartbeat APIs, remote provisioning, and an installable player app.
