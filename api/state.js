import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

const STATE_PATH = "state/signaldeck-state.json";
const VERSION_PATH = "state/signaldeck-version.json";
const DEFAULT_BLOB_BASE_URL = "https://fkwkmsorbvyjzsu8.public.blob.vercel-storage.com";

function blobUrl(pathname) {
  const baseUrl = process.env.BLOB_BASE_URL || DEFAULT_BLOB_BASE_URL;
  return `${baseUrl.replace(/\/$/, "")}/${pathname}`;
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
    const currentVersion = normalizeEtag(
      request.headers.get("x-signaldeck-version") || request.headers.get("if-none-match"),
    );
    const forceFull = request.headers.get("x-signaldeck-force-full") === "1";

    if (currentVersion && !forceFull) {
      const versionResponse = await fetch(blobUrl(VERSION_PATH), { cache: "no-store" });
      if (versionResponse.ok) {
        const marker = await versionResponse.json();
        if (normalizeEtag(marker.version) === currentVersion) {
          return new Response(null, {
            status: 304,
            headers: {
              "Cache-Control": "no-store",
              ETag: publicEtag(currentVersion),
              "X-SignalDeck-Version-Url": blobUrl(VERSION_PATH),
            },
          });
        }
      }
    }

    const response = await get(STATE_PATH, {
      access: "public",
      useCache: false,
      ...(currentVersion ? { ifNoneMatch: publicEtag(currentVersion) } : {}),
    });

    if (response?.statusCode === 304) {
      return new Response(null, {
        status: 304,
        headers: {
          "Cache-Control": "no-store",
          ETag: publicEtag(currentVersion),
          "X-SignalDeck-Version-Url": blobUrl(VERSION_PATH),
        },
      });
    }

    if (!response?.stream) {
      throw new Error("Unable to read saved SignalDeck state.");
    }

    const responseVersion = normalizeEtag(response.blob.etag);
    const state = validateState(await new Response(response.stream).json());
    return json({
      storage: "vercel-blob",
      version: responseVersion,
      versionUrl: blobUrl(VERSION_PATH),
      state,
    });
  } catch (error) {
    return json({ error: error.message || "Storage request failed" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const state = validateState(await request.json());
    const currentVersion = normalizeEtag(
      request.headers.get("x-signaldeck-version") || request.headers.get("if-match"),
    );
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
    const savedAt = Date.now();
    const version = normalizeEtag(blob.etag);
    const versionUrl = blobUrl(VERSION_PATH);

    try {
      await put(VERSION_PATH, JSON.stringify({ version, savedAt }), {
        access: "public",
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
    } catch (error) {
      console.error("SignalDeck state saved, but its version marker could not be updated", error);
    }

    return json({ ok: true, savedAt, version, versionUrl, url: blob.url });
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
