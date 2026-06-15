import { del } from "@vercel/blob";

export async function DELETE(request) {
  try {
    const { url, pathname } = await request.json();
    const target = pathname || url;

    if (!target) {
      return Response.json({ error: "Missing media URL or pathname" }, { status: 400 });
    }

    await del(target);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message || "Delete failed" }, { status: 500 });
  }
}
