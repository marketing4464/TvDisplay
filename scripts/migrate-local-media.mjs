import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadPresigned } from "@vercel/blob/client";

const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;

function readArgs(argv) {
  const options = { overrides: new Map() };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--state") options.statePath = value;
    else if (key === "--media-dir") options.mediaDir = value;
    else if (key === "--base-url") options.baseUrl = value?.replace(/\/$/, "");
    else if (key === "--output") options.outputPath = value;
    else if (key === "--override") {
      const separator = value?.indexOf("=") ?? -1;
      if (separator < 1) throw new Error("Overrides must use asset-id=/absolute/file/path.");
      options.overrides.set(value.slice(0, separator), value.slice(separator + 1));
    } else {
      throw new Error(`Unknown or incomplete argument: ${key}`);
    }
    index += 1;
  }

  for (const key of ["statePath", "mediaDir", "baseUrl", "outputPath"]) {
    if (!options[key]) throw new Error(`Missing --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return options;
}

function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function contentTypeFor(filePath, fallback) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".m4v": "video/x-m4v",
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webm": "video/webm",
    ".webp": "image/webp",
  };
  return types[extension] || fallback || "application/octet-stream";
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function originalMediaPath(asset, mediaDir) {
  const extension = path.extname(asset.path || asset.pathname || "");
  return path.join(mediaDir, `${asset.name}${extension}`);
}

async function loadWorkingState(options, sourceState) {
  try {
    const checkpointPayload = JSON.parse(await readFile(options.outputPath, "utf8"));
    const checkpoint = checkpointPayload.state || checkpointPayload;
    if (checkpoint.assets?.some((asset) => asset.url?.includes(".blob.vercel-storage.com"))) {
      return checkpoint;
    }
  } catch {
    // Start from the recovered state when no checkpoint exists yet.
  }
  return sourceState;
}

const options = readArgs(process.argv.slice(2));
const sourcePayload = JSON.parse(await readFile(options.statePath, "utf8"));
const state = await loadWorkingState(options, sourcePayload.state || sourcePayload);
const expectedStateVersion = sourcePayload.version || "";
const uploadedByHash = new Map();

for (const asset of state.assets) {
  const filePath = options.overrides.get(asset.id) || originalMediaPath(asset, options.mediaDir);
  const fileStats = await stat(filePath);
  const digest = await sha256(filePath);

  const existingBlobResponse = asset.url?.includes(".blob.vercel-storage.com")
    ? await fetch(asset.url, { method: "HEAD", cache: "no-store" }).catch(() => null)
    : null;
  if (existingBlobResponse?.ok) {
    uploadedByHash.set(digest, {
      pathname: asset.pathname || asset.path,
      url: asset.url,
      size: asset.size,
      type: asset.type,
    });
    console.log(`Already migrated: ${asset.name}`);
    continue;
  }

  let blob = uploadedByHash.get(digest);
  const type = contentTypeFor(filePath, asset.type);
  if (!blob) {
    const existingPathname = asset.pathname || asset.path;
    const pathname = existingPathname?.startsWith("media/")
      ? existingPathname
      : `media/${asset.id}-${sanitizeFilename(path.basename(filePath))}`;
    let lastProgress = -1;
    console.log(`Uploading: ${asset.name} (${(fileStats.size / 1024 / 1024).toFixed(1)} MB)`);
    blob = await uploadPresigned(pathname, await openAsBlob(filePath, { type }), {
      access: "public",
      contentType: type,
      handleUploadUrl: `${options.baseUrl}/api/upload`,
      multipart: fileStats.size > MULTIPART_THRESHOLD_BYTES,
      onUploadProgress: ({ percentage }) => {
        const progress = Math.floor(percentage / 10) * 10;
        if (progress !== lastProgress) {
          lastProgress = progress;
          console.log(`  ${progress}%`);
        }
      },
    });
    uploadedByHash.set(digest, { ...blob, size: fileStats.size, type });
  } else {
    console.log(`Reusing identical file: ${asset.name}`);
  }

  asset.url = blob.url;
  asset.pathname = blob.pathname;
  asset.path = blob.pathname;
  asset.size = fileStats.size;
  asset.type = type;
  await writeFile(options.outputPath, JSON.stringify(state, null, 2));
}

const now = Date.now();
state.activeView = "overview";
state.contentToken = `${now}-vercel-blob-migration`;
state.contentUpdatedAt = now;
state.deployToken = `${now}-vercel-blob-migration`;
state.deployRequestedAt = now;
state.screens = state.screens.map((screen) => ({
  ...screen,
  contentToken: state.contentToken,
  contentUpdatedAt: now,
}));

const response = await fetch(`${options.baseUrl}/api/state`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    ...(expectedStateVersion ? { "X-SignalDeck-Version": expectedStateVersion } : {}),
  },
  body: JSON.stringify(state),
});
if (!response.ok) {
  throw new Error(`State publish failed (${response.status}): ${await response.text()}`);
}

await writeFile(options.outputPath, JSON.stringify(state, null, 2));
console.log(`Published ${state.assets.length} assets, ${state.playlists.length} playlists, and ${state.screens.length} screens.`);
