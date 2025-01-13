// app/api/download/[size]/route.ts
import { NextRequest, NextResponse } from "next/server";

type Params = Promise<{ size: string }>;

const getSizeInBytes = (size: string): number => {
  switch (size.toLowerCase()) {
    case "10mb":
      return 10 * 1024 * 1024;
    case "100mb":
      return 100 * 1024 * 1024;
    case "250mb":
      return 250 * 1024 * 1024;
    default:
      throw new Error("Invalid file size");
  }
};

const generateFile = (size: number): Buffer => {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buffer[i] = Math.floor(Math.random() * 256); // Fill with random data
  }
  return buffer;
};

export async function GET(
  request: NextRequest,
  segmentData: { params: Params }
) {
  const { size } = await segmentData.params;

  if (!size) {
    return new NextResponse(JSON.stringify({ error: "Invalid file size" }), {
      status: 400,
    });
  }

  try {
    const fileSizeInBytes = getSizeInBytes(size);
    const fileBuffer = generateFile(fileSizeInBytes);

    const response = new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename=${size}.bin`,
        "Content-Length": fileSizeInBytes.toString(),
      },
    });

    return response;
  } catch (error) {
    console.error("Failed to generate file:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
