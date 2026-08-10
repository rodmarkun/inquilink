import sharp from "sharp";

const MAX_DIMENSION = 12_000;
const MAX_PIXELS = 40_000_000;

export async function decodeAndNormalizeImage(body: Buffer, contentType: "image/jpeg" | "image/png"): Promise<Buffer> {
  try {
    const image = sharp(body, { failOn: "error", limitInputPixels: MAX_PIXELS, sequentialRead: true });
    const metadata = await image.metadata();
    const expectedFormat = contentType === "image/png" ? "png" : "jpeg";
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      throw new Error("INVALID_IMAGE_STRUCTURE");
    }
    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION || metadata.width * metadata.height > MAX_PIXELS) {
      throw new Error("INVALID_IMAGE_DIMENSIONS");
    }
    // A full decode and re-encode validates compressed pixel data and strips
    // ancillary payloads before the object becomes publicly readable.
    return contentType === "image/png"
      ? await image.rotate().png({ compressionLevel: 9 }).toBuffer()
      : await image.rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch (error) {
    if (error instanceof Error && ["INVALID_IMAGE_STRUCTURE", "INVALID_IMAGE_DIMENSIONS"].includes(error.message)) throw error;
    throw new Error("INVALID_IMAGE_STRUCTURE");
  }
}
