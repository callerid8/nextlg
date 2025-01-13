const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks

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

function createChunk(idNumber: number, chunkSize: number): Uint8Array {
  if (chunkSize <= 0 || chunkSize % 4 !== 0) {
    throw new Error("Chunk size must be a positive multiple of 4");
  }

  // Create a single pattern to reuse
  const pattern = new Uint32Array(1);
  const result = new Uint8Array(chunkSize);
  const view = new DataView(result.buffer);

  // Pre-calculate the first part of the pattern
  const basePattern = (idNumber & 0xffff) << 16;

  for (let i = 0; i < chunkSize; i += 4) {
    pattern[0] = basePattern | (i & 0xffff);
    view.setUint32(i, pattern[0], true);
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
  try {
    const { id } = await params;
    if (!id) throw new Error("ID is missing in request parameters");

    const idNumber = parseInt(id.split("-")[1] || "0", 10);
    //console.log("idNumber:", idNumber);
    if (isNaN(idNumber)) throw new Error(`Invalid ID number: ${id}`);

    const chunk = createChunk(idNumber, CHUNK_SIZE);
    return new Response(chunk, {
      headers: { ...HTTP_HEADERS.BINARY, ETag: id },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!request.body) throw new Error("Request body is missing");

    const reader = request.body.getReader();
    let bytesRead = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) bytesRead += value.length;
    }

    return new Response(
      JSON.stringify({ success: true, bytesReceived: bytesRead }),
      { headers: HTTP_HEADERS.JSON },
    );
  } catch (error) {
    return createErrorResponse(error, 500);
  }
}
