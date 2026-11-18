/**
 * Readies an image for the composer (browser only): photos and big
 * screenshots are scaled to at most MAX_SIDE pixels and re-encoded, so a
 * phone photo becomes a few hundred KB instead of several MB. GIFs are kept
 * as they are, to keep their animation.
 */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_SIDE = 1600;
/** Smaller than this and within MAX_SIDE: used as is. */
const KEEP_BYTES = 800 * 1024;
/** Matches MAX_IMAGE_BYTES in src/lib/inline-images.ts. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type PreparedImage = { src: string; name: string; bytes: number };

export async function prepareImage(
  file: File,
  /** Longest side in pixels; signatures use a smaller one than replies. */
  maxSide = MAX_SIDE,
): Promise<PreparedImage> {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error(`${file.name || "That file"} isn't a PNG, JPEG, GIF or WebP image.`);
  }
  const name = file.name || "image";

  if (file.type === "image/gif") {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${name} is larger than 5 MB.`);
    return { src: await dataUrl(file), name, bytes: file.size };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= KEEP_BYTES) {
    bitmap.close();
    return { src: await dataUrl(file), name, bytes: file.size };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // Screenshots (PNG) stay PNG so text stays sharp, unless that's still big;
  // everything else becomes JPEG. JPEG has no transparency, so paint white.
  let type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (type === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  };
  draw();
  let blob = await toBlob(canvas, type);
  if (type === "image/png" && blob.size > 2 * 1024 * 1024) {
    type = "image/jpeg";
    draw();
    blob = await toBlob(canvas, type);
  }
  bitmap.close();
  if (blob.size > MAX_IMAGE_BYTES) throw new Error(`${name} is still larger than 5 MB after resizing.`);

  const ext = type === "image/png" ? "png" : "jpg";
  return { src: await dataUrl(blob), name: name.replace(/\.[a-z0-9]{2,5}$/i, "") + "." + ext, bytes: blob.size };
}

function toBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image."))), type, 0.85),
  );
}

function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.readAsDataURL(blob);
  });
}

/** Image files from a paste or drop, if there are any. */
export function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}
