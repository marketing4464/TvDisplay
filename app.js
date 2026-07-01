const DB_NAME = "signaldeck-media";
const DB_VERSION = 1;
const STATE_KEY = "signaldeck-state-v1";
const CANONICAL_HOST = "tv-displayope.vercel.app";
const SUPABASE_URL = "https://hvwnnvpafepmoczlvaea.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_wHaZZ7sJDX80QKDl2p9C2w_yawu78Jp";
const SUPABASE_STORAGE_AUTH_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2d25udnBhZmVwbW9jemx2YWVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MTEyODAsImV4cCI6MjA5NzE4NzI4MH0.VgaZEPWMn6o4a0pbwYxo3_56M34eEnQvaywcGfGQRds";
const SUPABASE_PROJECT_REF = "hvwnnvpafepmoczlvaea";
const SUPABASE_CLIENT_URL = "https://esm.sh/@supabase/supabase-js@2.51.0?bundle";
const SUPABASE_BUCKET = "signaldeck-media";
const SUPABASE_STATE_TABLE = "signaldeck_state";
const SUPABASE_STATE_ID = "default";
const SCHEDULE_TIME_ZONE = "America/New_York";
const SLIDE_DURATION_SECONDS = 120;
const PLAYER_SYNC_INTERVAL_MS = 10000;
const PLAYER_HEARTBEAT_INTERVAL_MS = 60000;
const PLAYER_BLANK_RECOVERY_MS = 45000;
const MEDIA_READY_TIMEOUT_MS = 30000;
const LARGE_UPLOAD_THRESHOLD_BYTES = 6 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024;
const ALL_DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ALIASES = {
  sun: 0,
  sunday: 0,
  sundays: 0,
  mon: 1,
  monday: 1,
  mondays: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  tuesdays: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  wednesdays: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  thursdays: 4,
  fri: 5,
  friday: 5,
  fridays: 5,
  sat: 6,
  saturday: 6,
  saturdays: 6,
};

const demoState = {
  activeView: "overview",
  assets: [
    {
      id: "asset-welcome",
      name: "Welcome Loop",
      type: "demo",
      duration: SLIDE_DURATION_SECONDS,
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
      duration: SLIDE_DURATION_SECONDS,
      size: 0,
      createdAt: Date.now() - 7200000,
      color: "green",
      headline: "Today",
      subhead: "Photos, video, schedules, and shared playback",
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

let state = normalizeState(structuredClone(demoState));
let activeView = state.activeView || "overview";
let editingPlaylistId = null;
let currentObjectUrls = [];
let playerTimer = null;
let playerRefreshTimer = null;
let playerClockTimer = null;
let playerBlankRecoveryTimer = null;
let playerSession = null;
let activePlayerObjectUrl = null;
let saveQueue = Promise.resolve();
let cloudStorageAvailable = false;
let supabaseClient = null;
let syncStatus = {
  label: "Loading",
  detail: "Checking shared storage",
  mode: "warning",
};

const app = document.querySelector("#app");
const scheduleDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHEDULE_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function redirectToCanonicalHost() {
  if (!window.location.hostname.endsWith(".vercel.app")) return false;
  if (window.location.hostname === CANONICAL_HOST) return false;

  const canonicalUrl = new URL(window.location.href);
  canonicalUrl.hostname = CANONICAL_HOST;
  window.location.replace(canonicalUrl.toString());
  return true;
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function loadState() {
  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from(SUPABASE_STATE_TABLE)
      .select("state")
      .eq("id", SUPABASE_STATE_ID)
      .maybeSingle();

    if (error) {
      throw error;
    }

    cloudStorageAvailable = true;
    syncStatus = {
      label: "Supabase saved",
      detail: "Media and settings sync across computers",
      mode: "online",
    };
    return normalizeState(data?.state || structuredClone(demoState));
  } catch {
    // Fall through to the local browser cache when Supabase is unavailable.
  }

  cloudStorageAvailable = false;
  syncStatus = {
    label: "Local only",
    detail: "Check Supabase setup to sync across computers",
    mode: "warning",
  };

  try {
    const saved = localStorage.getItem(STATE_KEY);
    return normalizeState(saved ? JSON.parse(saved) : structuredClone(demoState));
  } catch {
    return normalizeState(structuredClone(demoState));
  }
}

function saveState() {
  state.activeView = activeView;
  localStorage.setItem(STATE_KEY, JSON.stringify(state));

  if (!cloudStorageAvailable) {
    return Promise.resolve();
  }

  const snapshot = JSON.stringify({
    ...state,
    activeView: "overview",
  });
  saveQueue = saveQueue
    .then(async () => {
      const supabase = await getSupabaseClient();
      const { error } = await supabase.from(SUPABASE_STATE_TABLE).upsert({
        id: SUPABASE_STATE_ID,
        state: JSON.parse(snapshot),
        updated_at: new Date().toISOString(),
      });

      if (error) {
        throw error;
      }

      syncStatus = {
        label: "Supabase saved",
        detail: `Last saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
        mode: "online",
      };
    })
    .catch(() => {
      syncStatus = {
        label: "Save issue",
        detail: "Changes are saved locally; check Supabase setup",
        mode: "warning",
      };
    });

  return saveQueue;
}

function normalizeState(nextState) {
  return {
    ...nextState,
    assets: (nextState.assets || []).map((asset) => {
      if (isVideoAsset(asset)) {
        return {
          ...asset,
          durationMode: "full-video",
        };
      }
      return {
        ...asset,
        durationMode: "fixed",
        duration: SLIDE_DURATION_SECONDS,
      };
    }),
  };
}

function isVideoAsset(asset) {
  return asset.type?.startsWith("video/");
}

function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getSupabaseClient() {
  if (!supabaseClient) {
    const { createClient } = await import(SUPABASE_CLIENT_URL);
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return supabaseClient;
}

async function uploadMediaFile(file, assetId) {
  const supabase = await getSupabaseClient();
  const path = `media/${Date.now()}-${assetId}-${sanitizeFilename(file.name) || "upload"}`;

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`"${file.name}" is larger than the 50 GB upload limit.`);
  }

  if (file.size > LARGE_UPLOAD_THRESHOLD_BYTES || file.type.startsWith("video/")) {
    await uploadLargeMediaFile(path, file);
    const { data: publicUrl } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
    return {
      path,
      url: publicUrl.publicUrl,
    };
  }

  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    throw error;
  }

  const { data: publicUrl } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(data.path);
  return {
    path: data.path,
    url: publicUrl.publicUrl,
  };
}

async function uploadLargeMediaFile(path, file) {
  const endpoint = `https://${SUPABASE_PROJECT_REF}.storage.supabase.co/storage/v1/upload/resumable`;
  const uploadUrl = await createResumableUpload(endpoint, path, file);
  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + LARGE_UPLOAD_THRESHOLD_BYTES);
    const response = await fetch(uploadUrl, {
      method: "PATCH",
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${SUPABASE_STORAGE_AUTH_KEY}`,
      },
      body: chunk,
    });

    if (!response.ok) {
      throw new Error(await formatUploadResponseError(response));
    }

    offset = Number(response.headers.get("Upload-Offset")) || offset + chunk.size;
  }
}

async function createResumableUpload(endpoint, path, file) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(file.size),
      "Upload-Metadata": uploadMetadataHeader({
        bucketName: SUPABASE_BUCKET,
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      }),
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${SUPABASE_STORAGE_AUTH_KEY}`,
      "x-upsert": "false",
    },
  });

  if (!response.ok) {
    throw new Error(await formatUploadResponseError(response));
  }

  const location = response.headers.get("Location");
  if (!location) {
    throw new Error("Supabase did not return a resumable upload URL.");
  }

  return new URL(location, endpoint).toString();
}

function uploadMetadataHeader(metadata) {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${btoa(String(value))}`)
    .join(",");
}

async function formatUploadResponseError(response) {
  const body = await response.text();
  if (response.status === 413) {
    return "Supabase rejected this video because it is larger than the project-wide Storage file size limit. Open Supabase Storage Settings and raise the Global file size limit to 50 GB or higher.";
  }
  if (body) return body;
  if (response.statusText) return response.statusText;
  return "Video upload failed. Try a smaller MP4 file or check Supabase storage.";
}

async function deleteMediaFile(path) {
  if (!path) return;
  const supabase = await getSupabaseClient();
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([path]);
  if (error) {
    throw error;
  }
}

function assetDuration(asset) {
  return asset.duration || SLIDE_DURATION_SECONDS;
}

function assetDurationLabel(asset) {
  if (isVideoAsset(asset)) {
    return "Full video";
  }
  return formatDuration(assetDuration(asset));
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!minutes) return `${seconds}s`;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

function readVideoDuration(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("video/")) {
      resolve(null);
      return;
    }

    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? Math.ceil(video.duration) : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

function formatBytes(bytes) {
  if (!bytes) return "Generated";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function formatTime(ts) {
  if (!ts) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ts);
}

function playerUrl(screenId) {
  const url = new URL(window.location.href);
  url.hash = `#/player/${screenId}`;
  return url.toString();
}

function setView(view) {
  activeView = view;
  saveState();
  render();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("blobs");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putBlob(id, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", "readwrite");
    tx.objectStore("blobs").put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", "readonly");
    const request = tx.objectStore("blobs").get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function deleteBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", "readwrite");
    tx.objectStore("blobs").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function clearObjectUrls() {
  currentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  currentObjectUrls = [];
  activePlayerObjectUrl = null;
}

function replaceActivePlayerObjectUrl(url) {
  if (activePlayerObjectUrl && activePlayerObjectUrl !== url) {
    URL.revokeObjectURL(activePlayerObjectUrl);
  }
  activePlayerObjectUrl = url && url.startsWith("blob:") ? url : null;
}

async function assetSrc(asset) {
  if (asset.type === "demo") return null;
  if (asset.url) return asset.url;
  const blob = await getBlob(asset.id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  currentObjectUrls.push(url);
  return url;
}

function shell(title, subtitle, body, actions = "") {
  const navItems = [
    ["overview", "O", "Overview"],
    ["media", "M", "Media"],
    ["playlists", "P", "Playlists"],
    ["screens", "S", "Screens"],
    ["schedule", "T", "Schedule"],
  ];

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">SD</div>
          <div>
            <h1>SignalDeck</h1>
            <p>Custom signage MVP</p>
          </div>
        </div>
        <nav class="nav">
          ${navItems
            .map(
              ([view, icon, label]) => `
                <button class="${activeView === view ? "active" : ""}" data-view="${view}">
                  <span class="nav-icon">${icon}</span>
                  <span>${label}</span>
                </button>`,
            )
            .join("")}
        </nav>
        <div class="sidebar-note">
          Player devices can open a screen URL in fullscreen kiosk mode. Media, screens, playlists, and schedules sync through Supabase when storage is connected.
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <h2>${title}</h2>
            <p>${subtitle}</p>
          </div>
          <div class="actions">
            <span class="sync-badge ${syncStatus.mode}">
              <strong>${syncStatus.label}</strong>
              <small>${syncStatus.detail}</small>
            </span>
            <button class="btn ghost" data-deploy-media>Deploy media updates</button>
            ${actions}
          </div>
        </header>
        <section class="content">${body}</section>
      </main>
    </div>
  `;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  bindDeployMediaActions();
}

function render() {
  clearTimeout(playerTimer);
  clearTimeout(playerRefreshTimer);
  clearTimeout(playerBlankRecoveryTimer);
  clearInterval(playerClockTimer);
  clearObjectUrls();

  const playerMatch = window.location.hash.match(/^#\/player\/(.+)$/);
  if (playerMatch) {
    renderPlayer(playerMatch[1]);
    return;
  }

  playerSession = null;
  if (activeView === "media") renderMedia();
  else if (activeView === "playlists") renderPlaylists();
  else if (activeView === "screens") renderScreens();
  else if (activeView === "schedule") renderSchedule();
  else renderOverview();
}

function renderOverview() {
  const activeScreens = state.screens.filter((screen) => screen.status === "online").length;
  const assignedScreens = state.screens.filter((screen) => screen.playlistId).length;
  const activeSchedules = state.schedules.filter((schedule) => scheduleMatches(schedule));

  const body = `
    <div class="metric-grid">
      <div class="metric"><span>Media assets</span><strong>${state.assets.length}</strong></div>
      <div class="metric"><span>Playlists</span><strong>${state.playlists.length}</strong></div>
      <div class="metric"><span>Assigned screens</span><strong>${assignedScreens}</strong></div>
      <div class="metric"><span>Online players</span><strong>${activeScreens}</strong></div>
    </div>
    <div class="grid">
      <section class="panel span-7">
        <div class="panel-head">
          <div>
            <h3>Screen Fleet</h3>
            <p>Player health and assigned playlists</p>
          </div>
          <button class="btn small ghost" data-jump="screens">Manage</button>
        </div>
        <div class="panel-body">
          ${screenRows(state.screens)}
        </div>
      </section>
      <section class="panel span-5">
        <div class="panel-head">
          <div>
            <h3>Current Schedule</h3>
            <p>Active daypart rules right now</p>
          </div>
          <button class="btn small ghost" data-jump="schedule">Edit</button>
        </div>
        <div class="panel-body">
          ${currentScheduleRows(activeSchedules)}
        </div>
      </section>
      <section class="panel span-12">
        <div class="panel-head">
          <div>
            <h3>Build Path</h3>
            <p>What this MVP already proves and what comes next</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="grid">
            <div class="span-4 row"><div><p class="row-title">1. Upload</p><p class="row-meta">Images and videos are saved to the shared media library until you delete them.</p></div></div>
            <div class="span-4 row"><div><p class="row-title">2. Assign</p><p class="row-meta">Build playlists and assign them to player screens.</p></div></div>
            <div class="span-4 row"><div><p class="row-title">3. Play</p><p class="row-meta">Open a screen player URL on the signage computer in kiosk mode.</p></div></div>
          </div>
        </div>
      </section>
    </div>
  `;

  shell(
    "Overview",
    "A shared signage dashboard for replacing the BrightSign workflow.",
    body,
    `<button class="btn primary" data-jump="media">Upload media</button>`,
  );
  bindJumps();
}

function screenRows(screens) {
  if (!screens.length) return `<div class="empty">No screens have been created.</div>`;
  return `<div class="list">${screens
    .map(
      (screen) => `
        <div class="row">
          <div>
            <p class="row-title">${screen.name}</p>
            <p class="row-meta">${screen.location || "No location"} · ${currentPlaybackLabel(screen)}</p>
            <p class="row-meta">Last seen ${formatTime(screen.lastSeen)}</p>
          </div>
          <span class="status ${screen.status}">${screen.status}</span>
        </div>`,
    )
    .join("")}</div>`;
}

function currentScheduleRows(activeSchedules) {
  if (!state.schedules.length) return `<div class="empty">No schedules yet.</div>`;
  if (!activeSchedules.length) return `<div class="empty">No schedule is active right now.</div>`;

  return `<div class="list">${activeSchedules
    .map(
      (schedule) => `
        <div class="row">
          <div>
            <p class="row-title">${schedule.name}</p>
            <p class="row-meta">${schedule.days}, ${schedule.start} to ${schedule.end}</p>
            <p class="row-meta">${screenName(schedule.screenId)} plays ${playlistName(schedule.playlistId)}</p>
          </div>
          <span class="status online">Active</span>
        </div>`,
    )
    .join("")}</div>`;
}

function bindJumps() {
  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.jump));
  });
}

function requestScreenRefresh(screen, now = Date.now()) {
  screen.refreshToken = `${now}-${uid("refresh")}`;
  screen.refreshRequestedAt = now;
}

function publishContentUpdate({ screenIds = [], playlistIds = [], allScreens = false } = {}) {
  const now = Date.now();
  const targetScreenIds = new Set(screenIds);
  const targetPlaylistIds = new Set(playlistIds);
  const hasExplicitTargets = allScreens || screenIds.length > 0 || playlistIds.length > 0;

  if (allScreens) {
    state.screens.forEach((screen) => targetScreenIds.add(screen.id));
  }

  if (targetPlaylistIds.size) {
    state.screens.forEach((screen) => {
      if (targetPlaylistIds.has(screen.playlistId)) targetScreenIds.add(screen.id);
    });
    state.schedules.forEach((schedule) => {
      if (targetPlaylistIds.has(schedule.playlistId)) targetScreenIds.add(schedule.screenId);
    });
  }

  state.contentToken = `${now}-${uid("content")}`;
  state.contentUpdatedAt = now;
  state.screens.forEach((screen) => {
    if (!hasExplicitTargets || allScreens || targetScreenIds.has(screen.id)) {
      screen.contentToken = state.contentToken;
      screen.contentUpdatedAt = now;
    }
  });
}

async function deployMediaUpdates(button = null) {
  const now = Date.now();
  state.deployToken = `${now}-${uid("deploy")}`;
  state.deployRequestedAt = now;
  publishContentUpdate({ allScreens: true });
  state.screens.forEach((screen) => requestScreenRefresh(screen, now));
  await saveState();

  if (button) {
    button.textContent = "Deploy sent";
    button.disabled = true;
    setTimeout(() => {
      button.textContent = "Deploy media updates";
      button.disabled = false;
    }, 1600);
  }
}

function bindDeployMediaActions() {
  document.querySelectorAll("[data-deploy-media]").forEach((button) => {
    button.addEventListener("click", () => deployMediaUpdates(button));
  });
}

async function renderMedia() {
  const body = `
    <div class="grid">
      <section class="panel span-4">
        <div class="panel-head">
          <div>
            <h3>Add Media</h3>
            <p>Photos play for 2 minutes; videos play full length</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="upload-zone">
            <div>
              <p class="row-title">Upload local files</p>
              <p class="row-meta">${cloudStorageAvailable ? "Saved to the shared Supabase media library." : "Saved in this browser until Supabase is connected."}</p>
              <input id="mediaUpload" type="file" accept="image/*,video/*" multiple />
            </div>
          </div>
          <form id="demoAssetForm" class="form-grid" style="margin-top: 14px;">
            <div class="field full">
              <label for="headline">Generated slide headline</label>
              <input id="headline" value="New Promotion" />
            </div>
            <div class="field full">
              <label for="subhead">Generated slide subhead</label>
              <input id="subhead" value="Ready to publish across every location" />
            </div>
            <div class="field">
              <label>Generated slide duration</label>
              <input value="${formatDuration(SLIDE_DURATION_SECONDS)}" disabled />
            </div>
            <div class="field">
              <label for="color">Style</label>
              <select id="color">
                <option value="blue">Blue</option>
                <option value="green">Green</option>
                <option value="gold">Gold</option>
              </select>
            </div>
            <div class="field full">
              <button class="btn primary" type="submit">Create generated slide</button>
            </div>
          </form>
        </div>
      </section>
      <section class="panel span-8">
        <div class="panel-head">
          <div>
            <h3>Media Library</h3>
            <p>${state.assets.length} asset${state.assets.length === 1 ? "" : "s"} available</p>
          </div>
        </div>
        <div class="panel-body">
          <div id="assetGrid" class="asset-grid"></div>
        </div>
      </section>
    </div>
  `;

  shell("Media", "Upload photos or videos for shared signage playback.", body);
  await hydrateAssetGrid();

  document.querySelector("#mediaUpload").addEventListener("change", handleUpload);
  document.querySelector("#demoAssetForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const asset = {
      id: uid("asset"),
      name: document.querySelector("#headline").value.trim() || "Generated Slide",
      type: "demo",
      duration: SLIDE_DURATION_SECONDS,
      size: 0,
      createdAt: Date.now(),
      color: document.querySelector("#color").value,
      headline: document.querySelector("#headline").value.trim() || "Generated Slide",
      subhead: document.querySelector("#subhead").value.trim() || "Ready for playback",
    };
    state.assets.unshift(asset);
    publishContentUpdate({ allScreens: true });
    saveState();
    renderMedia();
  });
}

async function hydrateAssetGrid() {
  const grid = document.querySelector("#assetGrid");
  if (!state.assets.length) {
    grid.innerHTML = `<div class="empty">Upload media or create a generated slide to begin.</div>`;
    return;
  }

  const cards = await Promise.all(
    state.assets.map(async (asset) => {
      const src = await assetSrc(asset);
      let thumb = `<div class="thumb demo">${asset.headline || "Slide"}</div>`;
      if (src && asset.type.startsWith("image/")) {
        thumb = `<div class="thumb"><img src="${src}" alt="${asset.name}" /></div>`;
      } else if (src && asset.type.startsWith("video/")) {
        thumb = `<div class="thumb"><video src="${src}" muted></video></div>`;
      }
      return `
        <article class="asset-card">
          ${thumb}
          <div class="body">
            <p class="row-title">${asset.name}</p>
            <p class="row-meta">${asset.type === "demo" ? "Generated slide" : asset.type} · ${formatBytes(asset.size)}</p>
            <div class="pill-row">
              <span class="pill">${assetDurationLabel(asset)}</span>
              <span class="pill">${formatTime(asset.createdAt)}</span>
            </div>
            <div class="pill-row">
              <button class="btn small danger" data-delete-asset="${asset.id}">Delete</button>
            </div>
          </div>
        </article>`;
    }),
  );
  grid.innerHTML = cards.join("");
  document.querySelectorAll("[data-delete-asset]").forEach((button) => {
    button.addEventListener("click", () => removeAsset(button.dataset.deleteAsset));
  });
}

async function handleUpload(event) {
  await requestPersistentStorage();
  const files = [...event.target.files];
  const uploadInput = event.target;
  uploadInput.disabled = true;

  try {
    for (const file of files) {
      const id = uid("asset");
      const isVideo = file.type.startsWith("video/");
      const videoDuration = await readVideoDuration(file);

      const asset = {
        id,
        name: file.name.replace(/\.[^.]+$/, ""),
        type: file.type || "application/octet-stream",
        durationMode: isVideo ? "full-video" : "fixed",
        duration: isVideo ? videoDuration : SLIDE_DURATION_SECONDS,
        size: file.size,
        createdAt: Date.now(),
      };

      if (cloudStorageAvailable) {
        const media = await uploadMediaFile(file, id);
        asset.url = media.url;
        asset.path = media.path;
      } else {
        await putBlob(id, file);
      }

      state.assets.unshift(asset);
    }

    publishContentUpdate({ allScreens: true });
    await saveState();
  } catch (error) {
    syncStatus = {
      label: "Upload failed",
      detail: error.message || "Try again after checking storage setup",
      mode: "warning",
    };
  } finally {
    uploadInput.disabled = false;
    uploadInput.value = "";
  }
  renderMedia();
}

async function removeAsset(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  state.assets = state.assets.filter((asset) => asset.id !== assetId);
  state.playlists = state.playlists.map((playlist) => ({
    ...playlist,
    assetIds: playlist.assetIds.filter((id) => id !== assetId),
  }));
  publishContentUpdate({ allScreens: true });

  if (asset?.url && cloudStorageAvailable) {
    await deleteMediaFile(asset.path || asset.pathname);
  } else {
    await deleteBlob(assetId);
  }

  await saveState();
  render();
}

function renderPlaylists() {
  const selected =
    state.playlists.find((playlist) => playlist.id === editingPlaylistId) || state.playlists[0] || null;
  editingPlaylistId = selected?.id || null;
  const body = `
    <div class="grid">
      <section class="panel span-4">
        <div class="panel-head">
          <div>
            <h3>Create Playlist</h3>
            <p>Choose the media that should loop together</p>
          </div>
        </div>
        <div class="panel-body">
          <form id="playlistForm" class="form-grid">
            <div class="field full">
              <label for="playlistName">Playlist name</label>
              <input id="playlistName" placeholder="Menu Board Morning Loop" required />
            </div>
            <div class="field full">
              <label for="playlistDescription">Description</label>
              <textarea id="playlistDescription" placeholder="Where this playlist should be used"></textarea>
            </div>
            <div class="field full">
              <label>Assets</label>
              ${assetCheckboxes()}
            </div>
            <div class="field full">
              <button class="btn primary" type="submit">Create playlist</button>
            </div>
          </form>
        </div>
      </section>
      <section class="panel span-8">
        <div class="panel-head">
          <div>
            <h3>Playlists</h3>
            <p>${state.playlists.length} playlist${state.playlists.length === 1 ? "" : "s"} configured</p>
          </div>
        </div>
        <div class="panel-body">
          ${playlistRows()}
        </div>
      </section>
      <section class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Edit Playlist</h3>
            <p>${selected ? escapeHtml(selected.name) : "No playlist selected"}</p>
          </div>
        </div>
        <div class="panel-body">
          ${selected ? playlistEditForm(selected) : `<div class="empty">Create a playlist to edit its media.</div>`}
        </div>
      </section>
      <section class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Playlist Preview</h3>
            <p>${selected ? escapeHtml(selected.name) : "No playlist selected"}</p>
          </div>
        </div>
        <div class="panel-body">
          ${selected ? playlistPreview(selected) : `<div class="empty">Create a playlist to preview it.</div>`}
        </div>
      </section>
    </div>
  `;

  shell("Playlists", "Assemble media into loops that can be assigned to screens.", body);
  document.querySelector("#playlistForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assetIds = form.getAll("assetIds");
    const playlist = {
      id: uid("playlist"),
      name: document.querySelector("#playlistName").value.trim(),
      description: document.querySelector("#playlistDescription").value.trim(),
      assetIds,
      updatedAt: Date.now(),
    };
    state.playlists.unshift(playlist);
    editingPlaylistId = playlist.id;
    saveState();
    renderPlaylists();
  });
  bindPlaylistActions();
}

function playlistRows() {
  if (!state.playlists.length) return `<div class="empty">No playlists yet.</div>`;
  return `<div class="list">${state.playlists
    .map(
      (playlist) => `
        <div class="row">
          <div>
            <p class="row-title">${escapeHtml(playlist.name)}</p>
            <p class="row-meta">${escapeHtml(playlist.description || "No description")} · ${playlist.assetIds.length} item${playlist.assetIds.length === 1 ? "" : "s"}</p>
            <p class="row-meta">Updated ${formatTime(playlist.updatedAt)}</p>
          </div>
          <div class="actions">
            <button class="btn small ghost" data-edit-playlist="${playlist.id}">Edit</button>
            <button class="btn small danger" data-delete-playlist="${playlist.id}">Delete</button>
          </div>
        </div>`,
    )
    .join("")}</div>`;
}

function playlistEditForm(playlist) {
  return `
    <form id="editPlaylistForm" class="form-grid">
      <input type="hidden" name="playlistId" value="${playlist.id}" />
      <div class="field full">
        <label for="editPlaylistName">Playlist name</label>
        <input id="editPlaylistName" name="name" value="${escapeHtml(playlist.name)}" required />
      </div>
      <div class="field full">
        <label for="editPlaylistDescription">Description</label>
        <textarea id="editPlaylistDescription" name="description">${escapeHtml(playlist.description || "")}</textarea>
      </div>
      <div class="field full">
        <label>Media in this playlist</label>
        ${assetCheckboxes(playlist.assetIds)}
      </div>
      <div class="field full">
        <button class="btn primary" type="submit">Save playlist</button>
      </div>
    </form>`;
}

function assetCheckboxes(selectedIds = []) {
  const selected = new Set(selectedIds);
  if (!state.assets.length) return `<div class="empty">Upload media before building a playlist.</div>`;

  return `<div class="check-list">${state.assets
    .map(
      (asset) => `
        <label class="check-item">
          <input type="checkbox" name="assetIds" value="${asset.id}" ${selected.has(asset.id) ? "checked" : ""} />
          <span>${escapeHtml(asset.name)}<br><small class="row-meta">${escapeHtml(asset.type === "demo" ? "Generated slide" : asset.type)}</small></span>
          <span class="pill">${assetDurationLabel(asset)}</span>
        </label>`,
    )
    .join("")}</div>`;
}

function playlistPreview(playlist) {
  const assets = playlist.assetIds.map((id) => findAsset(id)).filter(Boolean);
  if (!assets.length) return `<div class="empty">This playlist has no assets.</div>`;
  return `<div class="list">${assets
    .map(
      (asset, index) => `
        <div class="row">
          <div>
            <p class="row-title">${index + 1}. ${escapeHtml(asset.name)}</p>
            <p class="row-meta">${escapeHtml(asset.type === "demo" ? "Generated slide" : asset.type)} · ${assetDurationLabel(asset)}</p>
          </div>
          <span class="pill">${formatBytes(asset.size)}</span>
        </div>`,
    )
    .join("")}</div>`;
}

function bindPlaylistActions() {
  document.querySelectorAll("[data-edit-playlist]").forEach((button) => {
    button.addEventListener("click", () => {
      editingPlaylistId = button.dataset.editPlaylist;
      renderPlaylists();
    });
  });

  document.querySelectorAll("[data-delete-playlist]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deletePlaylist;
      state.playlists = state.playlists.filter((playlist) => playlist.id !== id);
      state.screens = state.screens.map((screen) =>
        screen.playlistId === id ? { ...screen, playlistId: "" } : screen,
      );
      state.schedules = state.schedules.filter((schedule) => schedule.playlistId !== id);
      if (editingPlaylistId === id) {
        editingPlaylistId = state.playlists[0]?.id || null;
      }
      publishContentUpdate({ allScreens: true });
      saveState();
      renderPlaylists();
    });
  });

  const editForm = document.querySelector("#editPlaylistForm");
  if (!editForm) return;

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = form.get("playlistId");
    const playlist = state.playlists.find((item) => item.id === id);
    if (!playlist) return;

    playlist.name = String(form.get("name") || "").trim() || "Untitled Playlist";
    playlist.description = String(form.get("description") || "").trim();
    playlist.assetIds = form.getAll("assetIds");
    playlist.updatedAt = Date.now();
    publishContentUpdate({ playlistIds: [id] });

    await saveState();
    renderPlaylists();
  });
}

function renderScreens() {
  const body = `
    <div class="grid">
      <section class="panel span-4">
        <div class="panel-head">
          <div>
            <h3>Add Screen</h3>
            <p>A screen is one player output/feed</p>
          </div>
        </div>
        <div class="panel-body">
          <form id="screenForm" class="form-grid">
            <div class="field full">
              <label for="screenName">Screen name</label>
              <input id="screenName" placeholder="Bar Left Feed" required />
            </div>
            <div class="field full">
              <label for="screenLocation">Location</label>
              <input id="screenLocation" placeholder="Downtown showroom" />
            </div>
            <div class="field full">
              <label for="screenPlaylist">Playlist</label>
              <select id="screenPlaylist">
                <option value="">Unassigned</option>
                ${state.playlists.map((playlist) => `<option value="${playlist.id}">${playlist.name}</option>`).join("")}
              </select>
            </div>
            <div class="field full">
              <label for="screenNotes">Notes</label>
              <textarea id="screenNotes" placeholder="Example: HDMI to J+P encoder input 3"></textarea>
            </div>
            <div class="field full">
              <button class="btn primary" type="submit">Create screen</button>
            </div>
          </form>
        </div>
      </section>
      <section class="panel span-8">
        <div class="panel-head">
          <div>
            <h3>Screens</h3>
            <p>Open a player link on the matching mini PC</p>
          </div>
        </div>
        <div class="panel-body">
          ${screenManagerRows()}
        </div>
      </section>
    </div>
  `;

  shell("Screens", "Manage player endpoints and copy fullscreen player URLs.", body);
  document.querySelector("#screenForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.screens.unshift({
      id: uid("screen"),
      name: document.querySelector("#screenName").value.trim(),
      location: document.querySelector("#screenLocation").value.trim(),
      playlistId: document.querySelector("#screenPlaylist").value,
      status: "offline",
      lastSeen: null,
      notes: document.querySelector("#screenNotes").value.trim(),
    });
    saveState();
    renderScreens();
  });
  bindScreenActions();
}

function screenManagerRows() {
  if (!state.screens.length) return `<div class="empty">No screens yet.</div>`;
  return `<div class="list">${state.screens
    .map(
      (screen) => `
        <div class="row">
          <div>
            <p class="row-title">${screen.name}</p>
            <p class="row-meta">${screen.location || "No location"} · ${playlistName(screen.playlistId)}</p>
            <p class="row-meta">${screen.notes || "No notes"}</p>
            <label class="inline-control">
              <span>Playlist</span>
              <select data-screen-playlist="${screen.id}">
                <option value="">Unassigned</option>
                ${state.playlists
                  .map(
                    (playlist) =>
                      `<option value="${playlist.id}" ${playlist.id === screen.playlistId ? "selected" : ""}>${playlist.name}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <a class="preview-link" href="${playerUrl(screen.id)}">${playerUrl(screen.id)}</a>
          </div>
          <div class="actions">
            <a class="btn small ghost" href="${playerUrl(screen.id)}">Open player</a>
            <button class="btn small ghost" data-refresh-screen="${screen.id}">Refresh player</button>
            <button class="btn small ghost" data-copy="${screen.id}">Copy URL</button>
            <button class="btn small danger" data-delete-screen="${screen.id}">Delete</button>
          </div>
        </div>`,
    )
    .join("")}</div>`;
}

function bindScreenActions() {
  document.querySelectorAll("[data-screen-playlist]").forEach((select) => {
    select.addEventListener("change", async () => {
      const screen = state.screens.find((item) => item.id === select.dataset.screenPlaylist);
      if (!screen) return;
      screen.playlistId = select.value;
      publishContentUpdate({ screenIds: [screen.id] });
      await saveState();
      renderScreens();
    });
  });
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(playerUrl(button.dataset.copy));
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy URL"), 1100);
    });
  });
  document.querySelectorAll("[data-refresh-screen]").forEach((button) => {
    button.addEventListener("click", async () => {
      const screen = state.screens.find((item) => item.id === button.dataset.refreshScreen);
      if (!screen) return;
      requestScreenRefresh(screen);
      publishContentUpdate({ screenIds: [screen.id] });
      await saveState();
      renderScreens();
    });
  });
  document.querySelectorAll("[data-delete-screen]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deleteScreen;
      state.screens = state.screens.filter((screen) => screen.id !== id);
      state.schedules = state.schedules.filter((schedule) => schedule.screenId !== id);
      saveState();
      renderScreens();
    });
  });
}

function renderSchedule() {
  const body = `
    <div class="grid">
      <section class="panel span-5">
        <div class="panel-head">
          <div>
            <h3>Add Schedule</h3>
            <p>Basic time windows for a screen</p>
          </div>
        </div>
        <div class="panel-body">
          <form id="scheduleForm" class="form-grid">
            <div class="field full">
              <label for="scheduleName">Schedule name</label>
              <input id="scheduleName" placeholder="Evening Promo" required />
            </div>
            <div class="field">
              <label for="scheduleScreen">Screen</label>
              <select id="scheduleScreen" required>
                ${state.screens.map((screen) => `<option value="${screen.id}">${screen.name}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="schedulePlaylist">Playlist</label>
              <select id="schedulePlaylist" required>
                ${state.playlists.map((playlist) => `<option value="${playlist.id}">${playlist.name}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="scheduleDays">Days</label>
              <input id="scheduleDays" value="Mon-Fri" />
            </div>
            <div class="field">
              <label for="scheduleStart">Start</label>
              <input id="scheduleStart" type="time" value="08:00" />
            </div>
            <div class="field">
              <label for="scheduleEnd">End</label>
              <input id="scheduleEnd" type="time" value="18:00" />
            </div>
            <div class="field full">
              <button class="btn primary" type="submit" ${!state.screens.length || !state.playlists.length ? "disabled" : ""}>Create schedule</button>
            </div>
          </form>
        </div>
      </section>
      <section class="panel span-7">
        <div class="panel-head">
          <div>
            <h3>Schedule Rules</h3>
            <p>The player uses active schedule rules first, then the assigned playlist</p>
          </div>
        </div>
        <div class="panel-body">
          ${scheduleRows()}
        </div>
      </section>
    </div>
  `;

  shell("Schedule", "Create simple daypart rules for content playback.", body);
  const form = document.querySelector("#scheduleForm");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const screenId = document.querySelector("#scheduleScreen").value;
    state.schedules.unshift({
      id: uid("schedule"),
      name: document.querySelector("#scheduleName").value.trim(),
      screenId,
      playlistId: document.querySelector("#schedulePlaylist").value,
      days: document.querySelector("#scheduleDays").value.trim(),
      start: document.querySelector("#scheduleStart").value,
      end: document.querySelector("#scheduleEnd").value,
    });
    publishContentUpdate({ screenIds: [screenId] });
    saveState();
    renderSchedule();
  });
  bindScheduleActions();
}

function scheduleRows() {
  if (!state.schedules.length) return `<div class="empty">No schedule rules yet.</div>`;
  return `<div class="list">${state.schedules
    .map(
      (schedule) => `
        <form class="schedule-rule" data-schedule-form="${schedule.id}">
          <div class="field">
            <label for="${schedule.id}-name">Name</label>
            <input id="${schedule.id}-name" name="name" value="${schedule.name}" required />
          </div>
          <div class="field">
            <label for="${schedule.id}-screen">Screen</label>
            <select id="${schedule.id}-screen" name="screenId" required>
              ${state.screens
                .map(
                  (screen) =>
                    `<option value="${screen.id}" ${screen.id === schedule.screenId ? "selected" : ""}>${screen.name}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="field">
            <label for="${schedule.id}-playlist">Playlist</label>
            <select id="${schedule.id}-playlist" name="playlistId" required>
              ${state.playlists
                .map(
                  (playlist) =>
                    `<option value="${playlist.id}" ${playlist.id === schedule.playlistId ? "selected" : ""}>${playlist.name}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="field">
            <label for="${schedule.id}-days">Days</label>
            <input id="${schedule.id}-days" name="days" value="${schedule.days}" />
          </div>
          <div class="field">
            <label for="${schedule.id}-start">Start</label>
            <input id="${schedule.id}-start" name="start" type="time" value="${schedule.start}" />
          </div>
          <div class="field">
            <label for="${schedule.id}-end">End</label>
            <input id="${schedule.id}-end" name="end" type="time" value="${schedule.end}" />
          </div>
          <div class="schedule-actions">
            <button class="btn small primary" type="submit">Save</button>
            <button class="btn small danger" type="button" data-delete-schedule="${schedule.id}">Delete</button>
          </div>
        </form>`,
    )
    .join("")}</div>`;
}

function bindScheduleActions() {
  document.querySelectorAll("[data-schedule-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const schedule = state.schedules.find((item) => item.id === form.dataset.scheduleForm);
      if (!schedule) return;
      const previousScreenId = schedule.screenId;
      const previousPlaylistId = schedule.playlistId;

      const formData = new FormData(form);
      schedule.name = String(formData.get("name") || "").trim();
      schedule.screenId = String(formData.get("screenId") || "");
      schedule.playlistId = String(formData.get("playlistId") || "");
      schedule.days = String(formData.get("days") || "").trim();
      schedule.start = String(formData.get("start") || "");
      schedule.end = String(formData.get("end") || "");
      publishContentUpdate({
        screenIds: [previousScreenId, schedule.screenId],
        playlistIds: [previousPlaylistId, schedule.playlistId],
      });

      await saveState();
      renderSchedule();
    });
  });

  document.querySelectorAll("[data-delete-schedule]").forEach((button) => {
    button.addEventListener("click", async () => {
      const schedule = state.schedules.find((item) => item.id === button.dataset.deleteSchedule);
      state.schedules = state.schedules.filter((schedule) => schedule.id !== button.dataset.deleteSchedule);
      if (schedule) {
        publishContentUpdate({ screenIds: [schedule.screenId], playlistIds: [schedule.playlistId] });
      }
      await saveState();
      renderSchedule();
    });
  });
}

async function renderPlayer(screenId) {
  clearObjectUrls();
  const screen = state.screens.find((item) => item.id === screenId);
  if (!screen) {
    app.innerHTML = `<div class="player-error"><div><h1>Screen not found</h1><p>Check the player URL in the dashboard.</p></div></div>`;
    return;
  }

  markScreenOnline(screenId);

  app.innerHTML = `
    <section class="player">
      <div id="playerStage" class="player-stage"></div>
    </section>
  `;

  showPlayerMessage(screen.name, "Loading playlist...", { loading: true });

  playerSession = {
    screenId,
    cursor: 0,
    currentAssetId: null,
    lastHeartbeatAt: Date.now(),
    playVersion: 0,
    playNext: null,
    refreshToken: screen.refreshToken || "",
    queueSignature: "",
  };

  const playNext = async () => {
    if (!playerSession || playerSession.screenId !== screenId) return;
    const playVersion = ++playerSession.playVersion;
    const isCurrentPlay = () => playerSession?.screenId === screenId && playerSession.playVersion === playVersion;
    const queue = playerQueueForScreen(screenId, state);
    if (!queue.assets.length) {
      showPlayerMessage(queue.screen?.name || "SignalDeck", "No playable playlist is assigned.");
      playerTimer = setTimeout(() => {
        if (isCurrentPlay()) playNext();
      }, PLAYER_SYNC_INTERVAL_MS);
      return;
    }

    if (playerSession.queueSignature !== queue.signature) {
      const currentIndex = queue.assets.findIndex((asset) => asset.id === playerSession.currentAssetId);
      playerSession.cursor = currentIndex >= 0 ? currentIndex + 1 : 0;
      playerSession.queueSignature = queue.signature;
    }

    const asset = queue.assets[playerSession.cursor % queue.assets.length];
    playerSession.currentAssetId = asset.id;
    playerSession.cursor += 1;
    await showAsset(
      asset,
      () => {
        if (isCurrentPlay()) playNext();
      },
      true,
      isCurrentPlay,
    );
  };
  playerSession.playNext = playNext;

  playNext();
  scheduleBlankRecoveryCheck(screenId);
  schedulePlayerRefresh(screenId);
}

function schedulePlayerRefresh(screenId) {
  if (!cloudStorageAvailable) return;
  playerRefreshTimer = setTimeout(async () => {
    const nextState = await loadState();
    state = nextState;
    activeView = state.activeView || activeView;

    const refreshedScreen = state.screens.find((screen) => screen.id === screenId);
    if (!refreshedScreen) {
      render();
      return;
    }

    const nextRefreshToken = refreshedScreen.refreshToken || "";
    if (nextRefreshToken && nextRefreshToken !== playerSession?.refreshToken) {
      window.location.reload();
      return;
    }

    const nextQueueSignature = playerPlaybackSignature(screenId, state);
    const shouldApplyContentUpdate =
      playerSession?.queueSignature && nextQueueSignature !== playerSession.queueSignature;
    const shouldSaveHeartbeat =
      playerSession && Date.now() - playerSession.lastHeartbeatAt >= PLAYER_HEARTBEAT_INTERVAL_MS;
    markScreenOnline(screenId, { persist: shouldSaveHeartbeat });
    if (shouldSaveHeartbeat && playerSession) {
      playerSession.lastHeartbeatAt = Date.now();
    }
    if (shouldApplyContentUpdate && playerSession) {
      clearTimeout(playerTimer);
      playerSession.cursor = 0;
      playerSession.currentAssetId = null;
      playerSession.playNext?.();
    }
    schedulePlayerRefresh(screenId);
  }, PLAYER_SYNC_INTERVAL_MS);
}

function scheduleBlankRecoveryCheck(screenId) {
  clearTimeout(playerBlankRecoveryTimer);
  playerBlankRecoveryTimer = setTimeout(() => {
    const stage = document.querySelector("#playerStage");
    const hasRenderedMedia = stage?.querySelector("img, video") || stage?.dataset.loading !== "true";
    if (!hasRenderedMedia && window.location.hash === `#/player/${screenId}`) {
      window.location.reload();
      return;
    }
    scheduleBlankRecoveryCheck(screenId);
  }, PLAYER_BLANK_RECOVERY_MS);
}

function markScreenOnline(screenId, { persist = true } = {}) {
  const screen = state.screens.find((item) => item.id === screenId);
  if (!screen) return;

  screen.status = "online";
  screen.lastSeen = Date.now();
  if (persist) saveState();
}

async function showAsset(asset, done, shouldRotate = true, isCurrent = () => true) {
  const stage = document.querySelector("#playerStage");
  if (!stage) return;

  if (asset.type === "demo") {
    if (!isCurrent()) return;
    replaceActivePlayerObjectUrl(null);
    stage.dataset.loading = "false";
    stage.innerHTML = `
      <div class="demo-slide">
        <div>
          <h1>${asset.headline || asset.name}</h1>
          <p>${asset.subhead || "Generated signage slide"}</p>
        </div>
      </div>`;
    if (shouldRotate) {
      playerTimer = setTimeout(done, assetDuration(asset) * 1000);
    }
    return;
  }

  const src = await assetSrc(asset);
  if (!src) {
    playerTimer = setTimeout(done, 1000);
    return;
  }

  if (asset.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = "auto";
    if (!shouldRotate) video.loop = true;

    let cleanupVideoWatchdogs = () => {};

    try {
      await waitForVideoReady(video);
      if (!isCurrent()) return;
      replaceActivePlayerObjectUrl(src);
      stage.dataset.loading = "false";
      stage.replaceChildren(video);

      if (shouldRotate) {
        let isFinished = false;
        const maxDurationSeconds = Math.max(assetDuration(asset), Math.ceil(video.duration || 0), 1);
        const maxTimer = setTimeout(finishVideo, (maxDurationSeconds + 5) * 1000);
        const progressTimer = setTimeout(() => {
          if (video.currentTime < 0.1 && !video.ended) finishVideo();
        }, 8000);

        cleanupVideoWatchdogs = () => {
          clearTimeout(maxTimer);
          clearTimeout(progressTimer);
        };

        function finishVideo() {
          if (isFinished) return;
          isFinished = true;
          cleanupVideoWatchdogs();
          done();
        }

        video.onended = finishVideo;
      }

      video.onerror = () => {
        cleanupVideoWatchdogs();
        if (shouldRotate) playerTimer = setTimeout(done, 1000);
      };
      await video.play();
    } catch {
      cleanupVideoWatchdogs();
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      if (shouldRotate) playerTimer = setTimeout(done, 1000);
    }
  } else {
    const image = new Image();
    image.alt = asset.name;
    image.src = src;

    try {
      await waitForImageReady(image);
      if (!isCurrent()) return;
      replaceActivePlayerObjectUrl(src);
      stage.dataset.loading = "false";
      stage.replaceChildren(image);
      if (shouldRotate) playerTimer = setTimeout(done, assetDuration(asset) * 1000);
    } catch {
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      if (shouldRotate) playerTimer = setTimeout(done, 1000);
    }
  }
}

function waitForImageReady(image) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Image took too long to load.")), MEDIA_READY_TIMEOUT_MS);
    image.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Image failed to load."));
    };
  });
}

function waitForVideoReady(video) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Video took too long to load.")), MEDIA_READY_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      video.onloadeddata = null;
      video.oncanplay = null;
      video.onerror = null;
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    video.onloadeddata = ready;
    video.oncanplay = ready;
    video.onerror = () => {
      cleanup();
      reject(new Error("Video failed to load."));
    };
    video.load();
  });
}

function showPlayerMessage(title, message, options = {}) {
  const stage = document.querySelector("#playerStage");
  if (!stage) return;
  stage.dataset.loading = options.loading ? "true" : "false";
  stage.innerHTML = `
    <div class="demo-slide">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </div>
    </div>`;
}

function activePlaylistForScreen(screen) {
  return activePlaylistForScreenInState(state, screen);
}

function activeScheduleForScreen(screen, date = new Date()) {
  return activeScheduleForScreenInState(state, screen, date);
}

function activePlaylistForScreenInState(snapshot, screen, date = new Date()) {
  const dailyPricingPlaylist = entertainmentPricingPlaylistForDate(snapshot, screen, date);
  if (dailyPricingPlaylist) return dailyPricingPlaylist;

  const scheduled = activeScheduleForScreenInState(snapshot, screen, date);
  if (scheduled) return snapshot.playlists.find((playlist) => playlist.id === scheduled.playlistId);
  return snapshot.playlists.find((playlist) => playlist.id === screen.playlistId);
}

function activeScheduleForScreenInState(snapshot, screen, date = new Date()) {
  return snapshot.schedules.find((schedule) => schedule.screenId === screen.id && scheduleMatches(schedule, date));
}

function entertainmentPricingPlaylistForDate(snapshot, screen, date) {
  if (!isEntertainmentPricingScreen(screen)) return null;

  const { dayIndex } = scheduleDateParts(date);
  const dayName = DAY_NAMES[dayIndex];
  if (!dayName) return null;

  return (
    snapshot.playlists.find((playlist) => playlist.name?.toLowerCase() === `${dayName.toLowerCase()} pricing`) ||
    null
  );
}

function isEntertainmentPricingScreen(screen) {
  return /entertainment pricing/i.test(`${screen?.name || ""} ${screen?.location || ""} ${screen?.notes || ""}`);
}

function playerQueueForScreen(screenId, snapshot, date = new Date()) {
  const screen = snapshot.screens.find((item) => item.id === screenId);
  if (!screen) {
    return {
      screen: null,
      playlist: null,
      assets: [],
      signature: JSON.stringify({ screenId, missing: true }),
    };
  }

  const playlist = activePlaylistForScreenInState(snapshot, screen, date);
  const assets = playlist ? playlist.assetIds.map((id) => snapshot.assets.find((asset) => asset.id === id)).filter(Boolean) : [];

  return {
    screen,
    playlist,
    assets,
    signature: playerPlaybackSignature(screenId, snapshot, date),
  };
}

function playerPlaybackSignature(screenId, snapshot, date = new Date()) {
  const screen = snapshot.screens.find((item) => item.id === screenId);
  if (!screen) return JSON.stringify({ screenId, missing: true });

  const playlist = activePlaylistForScreenInState(snapshot, screen, date);
  if (!playlist) return JSON.stringify({ screenId, playlistId: null });

  const assets = playlist.assetIds
    .map((id) => snapshot.assets.find((asset) => asset.id === id))
    .filter(Boolean)
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      path: asset.path,
      url: asset.url,
      duration: assetDuration(asset),
      durationMode: asset.durationMode,
      headline: asset.headline,
      subhead: asset.subhead,
      color: asset.color,
    }));

  return JSON.stringify({
    screenId,
    playlistId: playlist.id,
    contentToken: screen.contentToken || snapshot.contentToken || "",
    assetIds: playlist.assetIds,
    assets,
  });
}

function scheduleMatches(schedule, date = new Date()) {
  return scheduleMatchesAt(schedule, date);
}

function scheduleMatchesAt(schedule, date) {
  const start = timeToMinutes(schedule.start);
  const end = timeToMinutes(schedule.end);
  const { dayIndex, minutes: current } = scheduleDateParts(date);

  if (start === null || end === null) return false;
  if (start === end) return scheduleRunsOnDay(schedule, dayIndex);

  if (end > start) {
    return current >= start && current < end && scheduleRunsOnDay(schedule, dayIndex);
  }

  if (current >= start) {
    return scheduleRunsOnDay(schedule, dayIndex);
  }

  if (current < end) {
    return scheduleRunsOnDay(schedule, previousDayIndex(dayIndex));
  }

  return false;
}

function scheduleDateParts(date) {
  const parts = Object.fromEntries(scheduleDateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  const dayIndex = dayIndexFromToken(parts.weekday);
  const hours = Number(parts.hour);
  const minutes = Number(parts.minute);
  return {
    dayIndex: dayIndex ?? date.getDay(),
    minutes: hours * 60 + minutes,
  };
}

function scheduleRunsOnDay(schedule, dayIndex) {
  return scheduleDayIndexes(schedule.days).includes(dayIndex);
}

function scheduleDayIndexes(days) {
  const text = String(days || "").trim().toLowerCase();
  if (!text || /\b(all|daily|every day|everyday)\b/.test(text)) return ALL_DAY_INDEXES;

  const indexes = new Set();
  if (/\bweekdays?\b/.test(text)) {
    [1, 2, 3, 4, 5].forEach((day) => indexes.add(day));
  }
  if (/\bweekends?\b/.test(text)) {
    [0, 6].forEach((day) => indexes.add(day));
  }

  const rangePattern = /([a-z]+)\s*(?:-|to|through|thru)\s*([a-z]+)/g;
  for (const match of text.matchAll(rangePattern)) {
    const start = dayIndexFromToken(match[1]);
    const end = dayIndexFromToken(match[2]);
    if (start !== null && end !== null) {
      addDayRange(indexes, start, end);
    }
  }

  text.split(/[^a-z]+/).forEach((token) => {
    const day = dayIndexFromToken(token);
    if (day !== null) indexes.add(day);
  });

  return indexes.size ? [...indexes] : ALL_DAY_INDEXES;
}

function addDayRange(indexes, start, end) {
  let day = start;
  indexes.add(day);
  while (day !== end) {
    day = (day + 1) % 7;
    indexes.add(day);
  }
}

function dayIndexFromToken(token) {
  const key = String(token || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return DAY_ALIASES[key] ?? null;
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function previousDayIndex(dayIndex) {
  return (dayIndex + 6) % 7;
}

function currentPlaybackLabel(screen) {
  const scheduled = activeScheduleForScreen(screen);
  if (scheduled) return `${playlistName(scheduled.playlistId)} via ${scheduled.name}`;
  return playlistName(screen.playlistId);
}

function findAsset(id) {
  return state.assets.find((asset) => asset.id === id);
}

function playlistName(id) {
  return state.playlists.find((playlist) => playlist.id === id)?.name || "No playlist assigned";
}

function screenName(id) {
  return state.screens.find((screen) => screen.id === id)?.name || "Unknown screen";
}

window.addEventListener("hashchange", render);

async function init() {
  if (redirectToCanonicalHost()) return;

  app.innerHTML = `<div class="player-error"><div><h1>SignalDeck</h1><p>Loading shared display data...</p></div></div>`;
  state = await loadState();
  activeView = state.activeView || "overview";
  render();
}

init();
