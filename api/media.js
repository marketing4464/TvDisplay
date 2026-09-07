import { del } from "@vercel/blob";

const MEDIA_PREFIX = "media/";

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

export async function DELETE(request) {
  try {
    const { url, pathname } = await request.json();
    const target = mediaPathname(pathname || url);

    if (!target.startsWith(MEDIA_PREFIX) || target.includes("..")) {
      return Response.json({ error: "Invalid media pathname" }, { status: 400 });
    }

    await del(target);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message || "Delete failed" }, { status: 500 });
  }
}
