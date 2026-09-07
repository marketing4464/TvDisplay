import { list } from "@vercel/blob";

const DEFAULT_BASE_URL = "https://tv-displayope.vercel.app";

function readBaseUrl(argv) {
  const option = argv.find((value) => value.startsWith("--base-url="));
  return (option?.slice("--base-url=".length) || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function mediaPathname(asset) {
  if (asset.pathname || asset.path) return String(asset.pathname || asset.path).replace(/^\//, "");
  try {
    return decodeURIComponent(new URL(asset.url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit ? 2 : 0)} ${units[unit]}`;
}

async function listAllMedia() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: "media/", cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

const baseUrl = readBaseUrl(process.argv.slice(2));
const response = await fetch(`${baseUrl}/api/state`, { cache: "no-store" });
if (!response.ok) throw new Error(`Unable to load SignalDeck state (${response.status}).`);

const payload = await response.json();
const state = payload.state || payload;
const assetsByPath = new Map();
for (const asset of state.assets || []) {
  const pathname = mediaPathname(asset);
  if (!pathname) continue;
  if (!assetsByPath.has(pathname)) assetsByPath.set(pathname, []);
  assetsByPath.get(pathname).push(asset);
}

const referencedIds = new Set(
  (state.playlists || []).flatMap((playlist) => playlist.assetIds || []),
);
const unassigned = (state.assets || []).filter((asset) => !referencedIds.has(asset.id));
const duplicateReferences = [...assetsByPath.entries()].filter(([, assets]) => assets.length > 1);
const checks = await Promise.all(
  [...assetsByPath.entries()].map(async ([pathname, assets]) => {
    const url = assets[0].url;
    if (!url) return { pathname, assets, status: "local-only" };
    const result = await fetch(url, { method: "HEAD", cache: "no-store" }).catch(() => null);
    return { pathname, assets, status: result?.ok ? "ok" : `missing (${result?.status || "network"})` };
  }),
);
const missing = checks.filter((item) => item.status !== "ok" && item.status !== "local-only");
const referencedBytes = [...assetsByPath.values()].reduce(
  (total, assets) => total + Number(assets[0].size || 0),
  0,
);

console.log(`SignalDeck storage audit: ${baseUrl}`);
console.log(`Library records: ${(state.assets || []).length}`);
console.log(`Unique referenced media: ${assetsByPath.size} (${formatBytes(referencedBytes)})`);
console.log(`Duplicate references: ${duplicateReferences.length}`);
console.log(`Unassigned assets: ${unassigned.length}`);
console.log(`Missing referenced media: ${missing.length}`);

for (const [, assets] of duplicateReferences) {
  console.log(`  DUPLICATE REFERENCE: ${assets.map((asset) => asset.name).join(" | ")}`);
}
for (const asset of unassigned) {
  console.log(`  UNASSIGNED: ${asset.name} (${formatBytes(Number(asset.size || 0))})`);
}
for (const item of missing) {
  console.log(`  MISSING: ${item.assets.map((asset) => asset.name).join(" | ")} -> ${item.pathname}`);
}

if (
  process.env.BLOB_READ_WRITE_TOKEN ||
  (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)
) {
  try {
    const blobs = await listAllMedia();
    const referencedPaths = new Set(assetsByPath.keys());
    const orphans = blobs.filter((blob) => !referencedPaths.has(blob.pathname));
    const storedBytes = blobs.reduce((total, blob) => total + blob.size, 0);
    console.log(`Stored media objects: ${blobs.length} (${formatBytes(storedBytes)})`);
    console.log(`Orphaned media objects: ${orphans.length}`);
    for (const blob of orphans) {
      console.log(`  ORPHAN: ${blob.pathname} (${formatBytes(blob.size)})`);
    }
  } catch (error) {
    console.log(`Blob credentials could not list objects; orphan detection was skipped (${error.name}).`);
  }
} else {
  console.log("Blob token unavailable; orphan detection was skipped.");
}

if (missing.length) process.exitCode = 1;
