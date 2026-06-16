# TvDisplay User Guide

Use TvDisplay to upload media, build playlists, create screen/player links, and run those links full-screen on mini PCs feeding Just Add Power transmitters.

## Important Notes

- Uploaded media is saved to the shared Supabase media library when cloud storage is connected.
- Media stays saved until you click `Delete`.
- Uploaded videos play for their full video length.
- Images and generated slides play for 120 seconds.
- Media, playlists, screens, and schedules are available from other computers using the same deployed site.
- If the dashboard shows `Local only`, cloud storage is not connected and changes are only saved in that browser.

## Basic Workflow

1. Open the TvDisplay dashboard.
2. Upload media.
3. Create a playlist.
4. Create or select a screen.
5. Assign the playlist to that screen.
6. Copy/open the screen player URL on the mini PC.
7. Connect the mini PC video output to a Just Add Power transmitter.

## Open the App Locally

From the project folder:

```bash
npm run dev
```

Then open:

```text
http://localhost:5173
```

If the app is deployed to Vercel, use the Vercel website URL instead.

## Upload Media

1. Click `Media` in the left menu.
2. Click the file upload button under `Upload local files`.
3. Select images or videos from the computer.
4. Confirm the uploaded items appear in the `Media Library`.

Playback timing:

- Videos play to the end of the video.
- Images play for 2 minutes.
- Generated slides play for 2 minutes.

To remove media, click `Delete` on that media item.

## Create a Generated Slide

1. Click `Media`.
2. Enter a headline.
3. Enter a subhead.
4. Choose a style color.
5. Click `Create generated slide`.

Generated slides are useful for quick messages, promotions, announcements, or testing a channel before uploading real media.

## Create a Playlist

1. Click `Playlists`.
2. Enter a playlist name.
3. Add an optional description.
4. Check the media items you want in the playlist.
5. Click `Create playlist`.

The playlist will loop the selected media in order.

## Create or Assign a Screen

1. Click `Screens`.
2. Enter a screen name, such as `Bar TV Channel 1`.
3. Enter a location, such as `Main Bar`.
4. Choose the playlist that should play on that screen.
5. Add notes if helpful, such as `HDMI to J+P transmitter 3`.
6. Click `Create screen`.

Each screen creates its own player URL.

To change what an existing screen plays, use the playlist selector in that screen row. The player URL stays the same.

## Open a Player URL

1. Click `Screens`.
2. Find the screen you want.
3. Click `Open player` to test it.
4. Or click `Copy URL` and paste it into the browser on the mini PC.

The player page is the page you run full-screen on the signage computer.

## Use With Just Add Power

For each channel:

```text
Mini PC browser player -> HDMI/DisplayPort output -> Just Add Power transmitter -> Network switch -> Just Add Power receivers -> TVs
```

Each different channel needs one independent video output into one Just Add Power transmitter.

Examples:

- 1 channel = 1 mini PC output + 1 J+P transmitter
- 2 channels from one Dell OptiPlex Micro = HDMI + DisplayPort-to-HDMI adapter
- 6 channels = usually 3 dual-output mini PCs or 6 single-output mini PCs

## Recommended Mini PC Setup

For each mini PC:

- Windows 11 Pro
- Chrome or Edge
- 16 GB RAM
- 256 GB or 512 GB SSD
- Gigabit Ethernet
- HDMI output
- DisplayPort output if running a second channel
- Sleep disabled
- Auto power-on after outage enabled in BIOS

## Kiosk / Full-Screen Setup

On the mini PC:

1. Open the player URL in Chrome or Edge.
2. Press `F11` for full-screen mode.
3. Confirm the correct playlist is playing.
4. Leave the browser open.

For a more permanent kiosk setup, configure the browser or Windows startup so the player URL opens automatically after reboot.

## Daily Use

To update content:

1. Open the deployed dashboard from any computer.
2. Go to `Media`.
3. Upload new images/videos.
4. Go to `Playlists`.
5. Create a new playlist with the desired media.
6. Go to `Screens`.
7. Use the screen row's playlist selector to assign the updated playlist.

Player screens check for shared updates about once per minute. Refresh the player browser if you need a change to appear immediately.

If a TV is showing the wrong content, check:

- Is the TV's Just Add Power receiver tuned to the right transmitter/source?
- Is the mini PC powered on?
- Is the browser still open on the player URL?
- Is the correct playlist assigned to that screen?
- Does the dashboard show `Supabase saved` instead of `Local only`?

## Current Limitations

- There is no login/user management yet.
- The current Supabase setup allows public read/write access so player computers can sync without signing in.
- Player screens pick up changes on a short polling interval, not instantly.
- Each mini PC/channel must be configured separately.
