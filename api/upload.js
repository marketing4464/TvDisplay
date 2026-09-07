import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned } from "@vercel/blob/client";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MEDIA_PREFIX = "media/";
const ALLOWED_CONTENT_TYPES = [
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

function assertMediaPath(pathname) {
  if (!pathname?.startsWith(MEDIA_PREFIX) || pathname.includes("..")) {
    throw new Error("Invalid SignalDeck media pathname.");
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (body.type === "blob.generate-presigned-url") {
      assertMediaPath(body.payload?.pathname);
    }

    const response = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        assertMediaPath(pathname);
        return {
          token: await issueSignedToken({
            pathname,
            operations: ["put"],
            allowedContentTypes: ALLOWED_CONTENT_TYPES,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
          }),
          urlOptions: {
            allowedContentTypes: ALLOWED_CONTENT_TYPES,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            addRandomSuffix: false,
            allowOverwrite: false,
            cacheControlMaxAge: 31536000,
          },
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("SignalDeck media upload completed", blob.pathname);
      },
    });

    return Response.json(response);
  } catch (error) {
    return Response.json({ error: error.message || "Upload failed" }, { status: 400 });
  }
}
