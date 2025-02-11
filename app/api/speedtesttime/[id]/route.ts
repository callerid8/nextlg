//const DOWNLOAD_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
const UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
const REQUEST_TIMEOUT = 30000; // 30 seconds

const HTTP_HEADERS = {
  JSON: { "Content-Type": "application/json" },
  BINARY: {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "no-store, private, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  },
} as const;

type Params = Promise<{ id: string }>;

function createChunk(idNumber: number, requestedSize: number): Uint8Array {
  const chunkSize = Math.min(
    Math.max(256 * 1024, requestedSize), // minimum 256KB
    8 * 1024 * 1024, // maximum 8MB
  );

  const result = new Uint8Array(chunkSize);
  const view = new DataView(result.buffer);

  // Generate deterministic pattern based on idNumber
  const pattern = (idNumber & 0xffff) | ((idNumber & 0xff) << 16);

  // Fill the buffer with the pattern
  for (let i = 0; i < chunkSize; i += 4) {
    view.setUint32(i, pattern + (i & 0xffff), true);
  }

  return result;
}

function createErrorResponse(error: unknown, status = 400): Response {
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: HTTP_HEADERS.JSON,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Params },
): Promise<Response> {
  const startTime = performance.now();
  const { id } = await params;
  const url = new URL(request.url);
  const requestedSize = parseInt(url.searchParams.get("size") || "1048576", 10);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const chunkId = parseInt(id.split("-")[1] || "0", 10);
          const chunk = createChunk(chunkId, requestedSize);
          controller.enqueue(chunk);
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        clearTimeout(timeoutId);
      },
    });

    return new Response(stream, {
      headers: {
        ...HTTP_HEADERS.BINARY,
        "X-Response-Time": `${(performance.now() - startTime).toFixed(2)}ms`,
        "X-Request-ID": id,
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return createErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    // Validate headers
    const { contentLength, chunkId } = validateHeaders(request.headers);

    if (!isFinite(contentLength) || contentLength > UPLOAD_CHUNK_SIZE * 2) {
      throw new Error("Invalid content length");
    }

    // Process the stream
    const reader = request.body?.getReader();
    if (!reader) throw new Error("No request body");

    try {
      while (!controller.signal.aborted) {
        const { done } = await reader.read();
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    clearTimeout(timeoutId);

    // Return success response
    return new Response(JSON.stringify({ chunkId }), {
      status: 200,
      headers: {
        ...HTTP_HEADERS.JSON,
        "Cache-Control": "no-store",
        "X-Response-Time": `${(performance.now() - startTime).toFixed(2)}ms`,
        "X-Request-ID": chunkId,
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return createErrorResponse(error);
  }
}

function validateHeaders(headers: Headers): {
  contentLength: number;
  chunkId: string;
} {
  const contentLength = headers.get("content-length");
  const chunkId = headers.get("x-chunk-id");

  if (!contentLength || !chunkId) {
    throw new Error("Missing required headers: content-length and x-chunk-id");
  }

  const size = parseInt(contentLength);
  if (!isFinite(size) || size <= 0 || size > UPLOAD_CHUNK_SIZE * 2) {
    throw new Error("Invalid content length");
  }

  return { contentLength: size, chunkId };
}
