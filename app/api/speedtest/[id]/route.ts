const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
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

//type Params = Promise<{ id: string }>;

function createChunk(chunkSize: number): Uint8Array {
  if (chunkSize <= 0 || chunkSize % 4 !== 0) {
    throw new Error("Chunk size must be a positive multiple of 4");
  }

  const result = new Uint8Array(chunkSize);
  const maxCryptoSize = 65536; // Max size for crypto.getRandomValues

  for (let offset = 0; offset < chunkSize; offset += maxCryptoSize) {
    const length = Math.min(maxCryptoSize, chunkSize - offset);
    const tempBuffer = new Uint8Array(length);
    crypto.getRandomValues(tempBuffer);
    result.set(tempBuffer, offset);
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

export async function GET(): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const chunk = createChunk(CHUNK_SIZE);
    clearTimeout(timeoutId);

    return new Response(chunk, {
      headers: HTTP_HEADERS.BINARY,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return createErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    if (!request.body) throw new Error("Request body is missing");

    const reader = request.body.getReader();
    let bytesRead = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) bytesRead += value.length;
      if (bytesRead > CHUNK_SIZE * 2) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    clearTimeout(timeoutId);
    return new Response(
      JSON.stringify({ success: true, bytesReceived: bytesRead }),
      { headers: HTTP_HEADERS.JSON },
    );
  } catch (error) {
    clearTimeout(timeoutId);
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    ) {
      return createErrorResponse("Request timeout", 408);
    }
    return createErrorResponse(error, 500);
  }
}
