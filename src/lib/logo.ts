/**
 * Client-side logo resizing, shared by every place a company logo can be
 * changed (currently just the topbar's quick-change menu).
 *
 * There is no object storage configured for this app, so the logo is stored
 * directly on the Company row as a data URL — resizing first is what keeps
 * that column (and every page that loads it: topbar, document letterheads)
 * small.
 */

export const MAX_LOGO_DATA_URL_LENGTH = 300_000;
const LOGO_MAX_DIMENSION = 256;

export async function fileToLogoDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read that image."));
      img.src = objectUrl;
    });

    const scale = Math.min(1, LOGO_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process that image.");
    ctx.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
