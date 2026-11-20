'use client';

import { jpegName, keepCompressed, PHOTO_MAX_EDGE, PHOTO_QUALITY, shouldCompress, targetSize } from '@/lib/files/photo-compress';

/**
 * Shrinks a photo in the browser (long edge 2000 px, JPEG 0.8) before it is uploaded.
 * EXIF orientation is applied while decoding; other metadata (GPS, camera) is dropped by the re-encode.
 * Any failure (format the browser cannot decode, e.g. HEIC outside Safari; no canvas) returns the original file,
 * so compression can never block an upload.
 */
export async function compressPhoto(file: File): Promise<File> {
  if (!shouldCompress({ name: file.name, size: file.size, type: file.type })) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const { width, height } = targetSize(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
      if (!width || !height) return file;
      const blob = await encode(bitmap, width, height);
      if (!blob || !keepCompressed(file.size, blob.size)) return file;
      return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

async function encode(bitmap: ImageBitmap, width: number, height: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    paint(ctx, bitmap, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: PHOTO_QUALITY });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint(ctx, bitmap, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
}

function paint(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, bitmap: ImageBitmap, width: number, height: number) {
  // JPEG has no transparency: put transparent PNG areas on white instead of black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
}
