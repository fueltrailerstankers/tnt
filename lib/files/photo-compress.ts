/**
 * Pure rules for shrinking photos in the browser before upload (no DOM, unit tested).
 * Phone cameras produce 2-10 MB JPEGs; at 2000 px on the long edge and JPEG quality 0.8 a photo
 * stays sharp enough to read VIN plates and damage while landing around 200-500 KB.
 */
export const PHOTO_MAX_EDGE = 2000;
export const PHOTO_QUALITY = 0.8;
/** Files smaller than this are left alone (signatures, small scans, already-shrunk photos). */
export const PHOTO_MIN_BYTES = 400 * 1024;
/** PNGs are often screenshots or line art with transparency; only convert big ones (photos saved as PNG). */
export const PNG_MIN_BYTES = 1.5 * 1024 * 1024;

const PHOTO_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/webp', 'image/heic', 'image/heif']);
const PHOTO_NAME = /\.(jpe?g|webp|heic|heif)$/i;

export interface PhotoInfo {
  name: string;
  size: number;
  type: string;
}

/** Whether a picked file is a photo worth re-encoding. GIFs (animation), PDFs and Office files are never touched. */
export function shouldCompress(f: PhotoInfo): boolean {
  const type = f.type.toLowerCase();
  if (type === 'image/png' || (!type && /\.png$/i.test(f.name))) return f.size >= PNG_MIN_BYTES;
  const photo = PHOTO_TYPES.has(type) || (!type && PHOTO_NAME.test(f.name));
  return photo && f.size >= PHOTO_MIN_BYTES;
}

/** Output size keeping the aspect ratio, never upscaling. */
export function targetSize(width: number, height: number, maxEdge = PHOTO_MAX_EDGE): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** The compressed file is always a JPEG: swap the extension so the stored name matches its content. */
export function jpegName(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return `${base || 'photo'}.jpg`;
}

/** Keep the re-encoded file only when it is clearly smaller (at least 10%); otherwise upload the original. */
export function keepCompressed(originalBytes: number, compressedBytes: number): boolean {
  return compressedBytes > 0 && compressedBytes <= originalBytes * 0.9;
}
