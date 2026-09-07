import { BlobPreconditionFailedError, put } from "@vercel/blob";

const STATE_PATH = "state/signaldeck-state.json";
const DEFAULT_BLOB_BASE_URL = "https://fkwkmsorbvyjzsu8.public.blob.vercel-storage.com";

function stateUrl() {
  const baseUrl = process.env.BLOB_BASE_URL || DEFAULT_BLOB_BASE_URL;
  return `${baseUrl.replace(/\/$/, "")}/${STATE_PATH}`;
}

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function normalizeEtag(value) {
  return String(value || "")
    .trim()
    .replace(/^W\//i, "")
    .replace(/^"|"$/g, "");
}

function publicEtag(value) {
  const etag = normalizeEtag(value);
  return etag ? `W/"${etag}"` : "";
}

function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SignalDeck state must be a JSON object.");
  }

  for (const key of ["assets", "playlists", "screens", "schedules"]) {
    if (!Array.isArray(value[key])) {
      throw new Error(`SignalDeck state is missing ${key}.`);
    }
  }

  return value;
}

export async function GET(request) {
  try {
    const currentVersion = normalizeEtag(request.headers.get("if-none-match"));
    const headers = currentVersion ? { "If-None-Match": publicEtag(currentVersion) } : undefined;
    const response = await fetch(stateUrl(), { headers });
    const responseVersion = normalizeEtag(response.headers.get("etag"));

    if (
      response.status === 304 ||
      (response.ok && currentVersion && responseVersion === currentVersion)
    ) {
      return new Response(null, {
        status: 304,
        headers: {
          "Cache-Control": "no-store",
          ETag: publicEtag(currentVersion),
        },
      });
    }

    if (!response.ok) {
      throw new Error(`Unable to read saved SignalDeck state (${response.status}).`);
    }

    const state = validateState(await response.json());
    return json({
      storage: "vercel-blob",
      version: responseVersion,
      state,
    });
  } catch (error) {
    return json({ error: error.message || "Storage request failed" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const state = validateState(await request.json());
    const currentVersion = normalizeEtag(request.headers.get("if-match"));
    const options = {
      access: "public",
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    };

    if (currentVersion) {
      options.ifMatch = currentVersion;
    }

    const blob = await put(STATE_PATH, JSON.stringify(state), options);
    return json({ ok: true, savedAt: Date.now(), version: normalizeEtag(blob.etag), url: blob.url });
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) {
      return json(
        { error: "SignalDeck changed on another computer. Reload before saving again." },
        { status: 409 },
      );
    }
    return json({ error: error.message || "Storage request failed" }, { status: 500 });
  }
}
