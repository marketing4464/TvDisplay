import { del, get } from "@vercel/blob";

const MEDIA_PREFIX = "media/";
const STATE_PATH = "state/signaldeck-state.json";

function mediaPathname(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (!url.hostname.endsWith(".blob.vercel-storage.com")) return "";
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return String(value).replace(/^\//, "");
  }
}

async function isReferencedByCurrentState(target) {
  const response = await get(STATE_PATH, { access: "public", useCache: false });
  if (!response?.stream) {
    throw new Error("Unable to verify the current media library.");
  }

  const state = await new Response(response.stream).json();
  return (state.assets || []).some((asset) => {
    const assetTarget = mediaPathname(asset.pathname || asset.path || asset.url);
    return assetTarget === target;
  });
}

export async function DELETE(request) {
  try {
    const { url, pathname } = await request.json();
    const target = mediaPathname(pathname || url);

    if (!target.startsWith(MEDIA_PREFIX) || target.includes("..")) {
      return Response.json({ error: "Invalid media pathname" }, { status: 400 });
    }

    if (await isReferencedByCurrentState(target)) {
      return Response.json(
        { error: "This media is still referenced by the current SignalDeck library." },
        { status: 409 },
      );
    }

    await del(target);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message || "Delete failed" }, { status: 500 });
  }
}
