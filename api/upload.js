import { handleUpload } from "@vercel/blob/client";

const allowedContentTypes = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "application/octet-stream",
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
];

export async function POST(request) {
  try {
    const body = await request.json();
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes,
        addRandomSuffix: true,
        tokenPayload: "{}",
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log("SignalDeck media upload completed", blob.pathname);
      },
    });

    return Response.json(jsonResponse);
  } catch (error) {
    return Response.json({ error: error.message || "Upload failed" }, { status: 400 });
  }
}
