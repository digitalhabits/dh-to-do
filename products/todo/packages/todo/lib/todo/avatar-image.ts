/**
 * A picture made small enough to be an avatar.
 *
 * An avatar is drawn at 20 to 28 pixels, so a photograph straight off a
 * phone is thousands of times more than it needs. The picture is cut to a
 * square from its middle and drawn at 256 pixels a side, which stays sharp
 * on a Retina screen at any size the app draws it.
 */

/** Pixels a side. */
export const AVATAR_SIZE = 256;

export async function squareAvatarFile(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const out = Math.min(AVATAR_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9)
    );
    if (!blob) return file;
    const base = (file.name || "avatar").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
