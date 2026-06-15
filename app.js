const DB_NAME = "signaldeck-media";
const DB_VERSION = 1;
const STATE_KEY = "signaldeck-state-v1";
const STATE_API = "/api/state";
const UPLOAD_API = "/api/upload";
const MEDIA_API = "/api/media";
const BLOB_CLIENT_URL = "https://esm.sh/@vercel/blob@2.4.0/client?bundle";
const SLIDE_DURATION_SECONDS = 120;

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
let currentObjectUrls = [];
let playerTimer = null;
let playerRefreshTimer = null;
let playerClockTimer = null;
let saveQueue = Promise.resolve();
let cloudStorageAvailable = false;
let blobUpload = null;
let syncStatus = {
  label: "Loading",
  detail: "Checking shared storage",
  mode: "warning",
};

const app = document.querySelector("#app");

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function loadState() {
  try {
    const response = await fetch(`${STATE_API}?v=${Date.now()}`, {
      cache: "no-store",
    });

    if (response.ok) {
      const payload = await response.json();
      cloudStorageAvailable = true;
      syncStatus = {
        label: "Cloud saved",
        detail: "Media and settings sync across computers",
        mode: "online",
      };
      return normalizeState(payload.state || payload);
    }
  } catch {
    // Fall through to the local browser cache when API routes are unavailable.
  }

  cloudStorageAvailable = false;
  syncStatus = {
    label: "Local only",
    detail: "Set up Vercel Blob to sync across computers",
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
      const response = await fetch(STATE_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: snapshot,
      });

      if (!response.ok) {
        throw new Error("Cloud save failed");
      }

      syncStatus = {
        label: "Cloud saved",
        detail: `Last saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
        mode: "online",
      };
    })
    .catch(() => {
      syncStatus = {
        label: "Save issue",
        detail: "Changes are saved locally; check Vercel Blob setup",
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

async function loadBlobUploader() {
  if (!blobUpload) {
    const module = await import(BLOB_CLIENT_URL);
    blobUpload = module.upload;
  }
  return blobUpload;
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
          Player devices can open a screen URL in fullscreen kiosk mode. Media, screens, playlists, and schedules sync through Vercel Blob when storage is connected.
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
}

function render() {
  clearTimeout(playerTimer);
  clearTimeout(playerRefreshTimer);
  clearInterval(playerClockTimer);
  clearObjectUrls();

  const playerMatch = window.location.hash.match(/^#\/player\/(.+)$/);
  if (playerMatch) {
    renderPlayer(playerMatch[1]);
    return;
  }

  if (activeView === "media") renderMedia();
  else if (activeView === "playlists") renderPlaylists();
  else if (activeView === "screens") renderScreens();
  else if (activeView === "schedule") renderSchedule();
  else renderOverview();
}

function renderOverview() {
  const activeScreens = state.screens.filter((screen) => screen.status === "online").length;
  const assignedScreens = state.screens.filter((screen) => screen.playlistId).length;
  const nextSchedule = state.schedules[0];

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
            <p>Simple daypart rules for the MVP</p>
          </div>
          <button class="btn small ghost" data-jump="schedule">Edit</button>
        </div>
        <div class="panel-body">
          ${
            nextSchedule
              ? `<div class="row">
                  <div>
                    <p class="row-title">${nextSchedule.name}</p>
                    <p class="row-meta">${nextSchedule.days}, ${nextSchedule.start} to ${nextSchedule.end}</p>
                    <p class="row-meta">${screenName(nextSchedule.screenId)} plays ${playlistName(nextSchedule.playlistId)}</p>
                  </div>
                  <span class="status online">Active</span>
                </div>`
              : `<div class="empty">No schedules yet.</div>`
          }
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
            <p class="row-meta">${screen.location || "No location"} · ${playlistName(screen.playlistId)}</p>
            <p class="row-meta">Last seen ${formatTime(screen.lastSeen)}</p>
          </div>
          <span class="status ${screen.status}">${screen.status}</span>
        </div>`,
    )
    .join("")}</div>`;
}

function bindJumps() {
  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.jump));
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
              <p class="row-meta">${cloudStorageAvailable ? "Saved to the shared Vercel media library." : "Saved in this browser until Vercel Blob is connected."}</p>
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
        const uploadToBlob = await loadBlobUploader();
        const pathname = `media/${Date.now()}-${id}-${sanitizeFilename(file.name) || "upload"}`;
        const blob = await uploadToBlob(pathname, file, {
          access: "public",
          handleUploadUrl: UPLOAD_API,
        });
        asset.url = blob.url;
        asset.pathname = blob.pathname;
      } else {
        await putBlob(id, file);
      }

      state.assets.unshift(asset);
    }

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

  if (asset?.url && cloudStorageAvailable) {
    await fetch(MEDIA_API, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: asset.url, pathname: asset.pathname }),
    });
  } else {
    await deleteBlob(assetId);
  }

  await saveState();
  render();
}

function renderPlaylists() {
  const selected = state.playlists[0];
  const body = `
    <div class="grid">
      <section class="panel span-5">
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
              <div class="check-list">
                ${state.assets
                  .map(
                    (asset) => `
                      <label class="check-item">
                        <input type="checkbox" name="assetIds" value="${asset.id}" />
                        <span>${asset.name}<br><small class="row-meta">${asset.type === "demo" ? "Generated slide" : asset.type}</small></span>
                        <span class="pill">${assetDurationLabel(asset)}</span>
                      </label>`,
                  )
                  .join("")}
              </div>
            </div>
            <div class="field full">
              <button class="btn primary" type="submit">Create playlist</button>
            </div>
          </form>
        </div>
      </section>
      <section class="panel span-7">
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
      <section class="panel span-12">
        <div class="panel-head">
          <div>
            <h3>Playlist Preview</h3>
            <p>${selected ? selected.name : "No playlist selected"}</p>
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
    saveState();
    renderPlaylists();
  });
  bindPlaylistDelete();
}

function playlistRows() {
  if (!state.playlists.length) return `<div class="empty">No playlists yet.</div>`;
  return `<div class="list">${state.playlists
    .map(
      (playlist) => `
        <div class="row">
          <div>
            <p class="row-title">${playlist.name}</p>
            <p class="row-meta">${playlist.description || "No description"} · ${playlist.assetIds.length} item${playlist.assetIds.length === 1 ? "" : "s"}</p>
            <p class="row-meta">Updated ${formatTime(playlist.updatedAt)}</p>
          </div>
          <button class="btn small danger" data-delete-playlist="${playlist.id}">Delete</button>
        </div>`,
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
            <p class="row-title">${index + 1}. ${asset.name}</p>
            <p class="row-meta">${asset.type === "demo" ? "Generated slide" : asset.type} · ${assetDurationLabel(asset)}</p>
          </div>
          <span class="pill">${formatBytes(asset.size)}</span>
        </div>`,
    )
    .join("")}</div>`;
}

function bindPlaylistDelete() {
  document.querySelectorAll("[data-delete-playlist]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deletePlaylist;
      state.playlists = state.playlists.filter((playlist) => playlist.id !== id);
      state.screens = state.screens.map((screen) =>
        screen.playlistId === id ? { ...screen, playlistId: "" } : screen,
      );
      state.schedules = state.schedules.filter((schedule) => schedule.playlistId !== id);
      saveState();
      renderPlaylists();
    });
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
            <p>The player currently uses assigned playlist first, then schedule rules</p>
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
    state.schedules.unshift({
      id: uid("schedule"),
      name: document.querySelector("#scheduleName").value.trim(),
      screenId: document.querySelector("#scheduleScreen").value,
      playlistId: document.querySelector("#schedulePlaylist").value,
      days: document.querySelector("#scheduleDays").value.trim(),
      start: document.querySelector("#scheduleStart").value,
      end: document.querySelector("#scheduleEnd").value,
    });
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

      const formData = new FormData(form);
      schedule.name = String(formData.get("name") || "").trim();
      schedule.screenId = String(formData.get("screenId") || "");
      schedule.playlistId = String(formData.get("playlistId") || "");
      schedule.days = String(formData.get("days") || "").trim();
      schedule.start = String(formData.get("start") || "");
      schedule.end = String(formData.get("end") || "");

      await saveState();
      renderSchedule();
    });
  });

  document.querySelectorAll("[data-delete-schedule]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.schedules = state.schedules.filter((schedule) => schedule.id !== button.dataset.deleteSchedule);
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

  screen.status = "online";
  screen.lastSeen = Date.now();
  saveState();

  const playlist = activePlaylistForScreen(screen);
  const assets = playlist ? playlist.assetIds.map((id) => findAsset(id)).filter(Boolean) : [];

  if (!playlist || !assets.length) {
    app.innerHTML = `<div class="player-error"><div><h1>${screen.name}</h1><p>No playable playlist is assigned.</p></div></div>`;
    return;
  }

  app.innerHTML = `
    <section class="player">
      <div id="playerStage" class="player-stage"></div>
      <div class="player-osd">
        <span>${screen.name} · ${playlist.name}</span>
        <span id="playerClock"></span>
      </div>
    </section>
  `;

  const clock = document.querySelector("#playerClock");
  playerClockTimer = setInterval(() => {
    clock.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, 1000);

  let index = 0;
  const playNext = async () => {
    const asset = assets[index % assets.length];
    index += 1;
    await showAsset(asset, playNext);
  };
  playNext();
  schedulePlayerRefresh(screenId);
}

function schedulePlayerRefresh(screenId) {
  if (!cloudStorageAvailable) return;
  playerRefreshTimer = setTimeout(async () => {
    const previous = JSON.stringify(state);
    const nextState = await loadState();
    const next = JSON.stringify(nextState);

    if (previous !== next) {
      state = nextState;
      activeView = state.activeView || activeView;
      render();
      return;
    }

    schedulePlayerRefresh(screenId);
  }, 60000);
}

async function showAsset(asset, done) {
  const stage = document.querySelector("#playerStage");
  if (!stage) return;

  if (asset.type === "demo") {
    stage.innerHTML = `
      <div class="demo-slide">
        <div>
          <h1>${asset.headline || asset.name}</h1>
          <p>${asset.subhead || "Generated signage slide"}</p>
        </div>
      </div>`;
    playerTimer = setTimeout(done, assetDuration(asset) * 1000);
    return;
  }

  const src = await assetSrc(asset);
  if (!src) {
    stage.innerHTML = `<div class="demo-slide"><div><h1>Missing Media</h1><p>${asset.name}</p></div></div>`;
    playerTimer = setTimeout(done, 5000);
    return;
  }

  if (asset.type.startsWith("video/")) {
    stage.innerHTML = `<video src="${src}" autoplay muted playsinline></video>`;
    const video = stage.querySelector("video");
    video.onended = done;
    video.onerror = () => {
      playerTimer = setTimeout(done, 5000);
    };
  } else {
    stage.innerHTML = `<img src="${src}" alt="${asset.name}" />`;
    playerTimer = setTimeout(done, assetDuration(asset) * 1000);
  }
}

function activePlaylistForScreen(screen) {
  const scheduled = state.schedules.find((schedule) => schedule.screenId === screen.id && scheduleMatches(schedule));
  if (scheduled) return state.playlists.find((playlist) => playlist.id === scheduled.playlistId);
  return state.playlists.find((playlist) => playlist.id === screen.playlistId);
}

function scheduleMatches(schedule) {
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return current >= schedule.start && current <= schedule.end;
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
  app.innerHTML = `<div class="player-error"><div><h1>SignalDeck</h1><p>Loading shared display data...</p></div></div>`;
  state = await loadState();
  activeView = state.activeView || "overview";
  render();
}

init();
