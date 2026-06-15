import { list, put } from "@vercel/blob";

const STATE_PATH = "state/signaldeck-state.json";

const defaultState = {
  activeView: "overview",
  assets: [
    {
      id: "asset-welcome",
      name: "Welcome Loop",
      type: "demo",
      duration: 120,
      size: 0,
      createdAt: Date.now() - 86400000,
      color: "blue",
      headline: "Welcome",
      subhead: "SignalDeck signage player is online",
    },
    {
      id: "asset-events",
      name: "Today at a Glance",
      type: "demo",
      duration: 120,
      size: 0,
      createdAt: Date.now() - 7200000,
      color: "green",
      headline: "Today",
      subhead: "Photos, video, schedules, and shared cloud playback",
    },
  ],
  playlists: [
    {
      id: "playlist-lobby",
      name: "Lobby Rotation",
      description: "Default photo and video loop for shared public displays.",
      assetIds: ["asset-welcome", "asset-events"],
      updatedAt: Date.now() - 3600000,
    },
  ],
  screens: [
    {
      id: "screen-lobby",
      name: "Lobby Player",
      location: "Main Location",
      playlistId: "playlist-lobby",
      status: "online",
      lastSeen: Date.now() - 14000,
      notes: "HDMI out to Just Add Power encoder.",
    },
  ],
  schedules: [
    {
      id: "schedule-default",
      name: "Business Hours",
      screenId: "screen-lobby",
      playlistId: "playlist-lobby",
      days: "Mon-Fri",
      start: "08:00",
      end: "18:00",
    },
  ],
};

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

async function readStoredState() {
  const { blobs } = await list({ prefix: STATE_PATH, limit: 1 });
  const stateBlob = blobs.find((blob) => blob.pathname === STATE_PATH);

  if (!stateBlob) {
    return defaultState;
  }

  const response = await fetch(`${stateBlob.url}?v=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to read saved SignalDeck state.");
  }

  return response.json();
}

export async function GET() {
  try {
    return json({
      storage: "vercel-blob",
      state: await readStoredState(),
    });
  } catch (error) {
    return json({ error: error.message || "Storage request failed" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const state = await request.json();
    await put(STATE_PATH, JSON.stringify(state, null, 2), {
      access: "public",
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
    return json({ ok: true, savedAt: Date.now() });
  } catch (error) {
    return json({ error: error.message || "Storage request failed" }, { status: 500 });
  }
}
