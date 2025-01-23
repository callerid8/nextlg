const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
const REQUEST_TIMEOUT = 30000; // 30 seconds
const MAX_CHUNK_CACHE_SIZE = 32; // Cache up to 32 chunks

// Cache frequently used chunks
const chunkCache = new Map<number, Uint8Array>();

const HTTP_HEADERS = {
  JSON: { "Content-Type": "application/json" },
  BINARY: {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "no-store, private, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  },
} as const;

// Add request tracking
const activeRequests = new Set<string>();

type Params = Promise<{ id: string }>;

function createChunk(idNumber: number, chunkSize: number): Uint8Array {
  // Check cache first
  const cacheKey = idNumber % MAX_CHUNK_CACHE_SIZE;
  if (chunkCache.has(cacheKey)) {
    return chunkCache.get(cacheKey)!;
  }

  const result = new Uint8Array(chunkSize);
  const view = new DataView(result.buffer);

  // Generate deterministic pattern based on idNumber
  const pattern = (idNumber & 0xffff) | ((idNumber & 0xff) << 16);

  // Fill the buffer with the pattern
  for (let i = 0; i < chunkSize; i += 4) {
    view.setUint32(i, pattern + (i & 0xffff), true);
  }

  // Cache the chunk if we haven't reached max size
  if (chunkCache.size < MAX_CHUNK_CACHE_SIZE) {
    chunkCache.set(cacheKey, result);
  }

  return result;
}

function createErrorResponse(error: unknown, status = 400): Response {
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";
  console.error(`Error: ${message}`);
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const { id } = await params;
  try {
    if (!id || activeRequests.has(id))
      throw new Error("Invalid or duplicate request");
    activeRequests.add(id);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const chunk = await new Promise<Uint8Array>((resolve) => {
            queueMicrotask(() =>
              resolve(
                createChunk(parseInt(id.split("-")[1] || "0", 10), CHUNK_SIZE),
              ),
            );
          });
          controller.enqueue(chunk);
        } catch (error) {
          controller.error(error);
        } finally {
          controller.close();
        }
      },
      cancel() {
        clearTimeout(timeoutId);
      },
    });

    const duration = performance.now() - startTime;
    return new Response(stream, {
      headers: {
        ...HTTP_HEADERS.BINARY,
        "X-Response-Time": `${duration.toFixed(2)}ms`,
        "X-Request-ID": id,
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return createErrorResponse(error);
  } finally {
    activeRequests.delete(id!);
  }
}

export async function POST(request: Request): Promise<Response> {
  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    if (!request.body) throw new Error("Request body is missing");

    const contentLength = request.headers.get("content-length");
    const chunkId = request.headers.get("x-chunk-id");

    if (!contentLength || !chunkId) {
      throw new Error("Missing required headers");
    }

    const size = parseInt(contentLength);
    if (size > CHUNK_SIZE * 2) {
      throw new Error("Request too large");
    }

    let bytesRead = 0;
    const reader = request.body.getReader();

    try {
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          bytesRead += value.length;
          if (bytesRead > size) {
            throw new Error("Upload size mismatch");
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const duration = performance.now() - startTime;
    return new Response(
      JSON.stringify({
        success: true,
        bytesReceived: bytesRead,
        duration: duration.toFixed(2),
      }),
      {
        headers: {
          ...HTTP_HEADERS.JSON,
          "X-Response-Time": `${duration.toFixed(2)}ms`,
        },
      },
    );
  } catch (error) {
    clearTimeout(timeoutId);
    return createErrorResponse(error);
  }
}
