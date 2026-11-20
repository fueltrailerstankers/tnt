import { describe, expect, it } from 'vitest';
import { jpegName, keepCompressed, PHOTO_MIN_BYTES, PNG_MIN_BYTES, shouldCompress, targetSize } from '@/lib/files/photo-compress';

const MB = 1024 * 1024;

describe('shouldCompress', () => {
  it('shrinks camera photos above the small-file threshold', () => {
    expect(shouldCompress({ name: 'a.jpg', size: 3 * MB, type: 'image/jpeg' })).toBe(true);
    expect(shouldCompress({ name: 'a.heic', size: 3 * MB, type: 'image/heic' })).toBe(true);
    expect(shouldCompress({ name: 'a.webp', size: 3 * MB, type: 'image/webp' })).toBe(true);
    expect(shouldCompress({ name: 'a.JPG', size: 3 * MB, type: '' })).toBe(true);
  });

  it('leaves small photos, small PNGs, GIFs, PDFs and Office files alone', () => {
    expect(shouldCompress({ name: 'a.jpg', size: PHOTO_MIN_BYTES - 1, type: 'image/jpeg' })).toBe(false);
    expect(shouldCompress({ name: 'sig.png', size: 60 * 1024, type: 'image/png' })).toBe(false);
    expect(shouldCompress({ name: 'a.gif', size: 5 * MB, type: 'image/gif' })).toBe(false);
    expect(shouldCompress({ name: 'a.pdf', size: 5 * MB, type: 'application/pdf' })).toBe(false);
    expect(shouldCompress({ name: 'a.docx', size: 5 * MB, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe(false);
  });

  it('converts only large PNGs', () => {
    expect(shouldCompress({ name: 'a.png', size: PNG_MIN_BYTES, type: 'image/png' })).toBe(true);
    expect(shouldCompress({ name: 'a.png', size: PNG_MIN_BYTES - 1, type: 'image/png' })).toBe(false);
  });
});

describe('targetSize', () => {
  it('caps the long edge and keeps the aspect ratio', () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(targetSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
  });
  it('never upscales and rejects empty images', () => {
    expect(targetSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(targetSize(0, 800)).toEqual({ width: 0, height: 0 });
  });
});

describe('jpegName / keepCompressed', () => {
  it('renames to .jpg', () => {
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg');
    expect(jpegName('photo.jpeg')).toBe('photo.jpg');
    expect(jpegName('noext')).toBe('noext.jpg');
    expect(jpegName('.png')).toBe('photo.jpg');
  });
  it('keeps the re-encode only when at least 10% smaller', () => {
    expect(keepCompressed(1000, 900)).toBe(true);
    expect(keepCompressed(1000, 901)).toBe(false);
    expect(keepCompressed(1000, 0)).toBe(false);
  });
});
