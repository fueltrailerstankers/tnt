import { readFileSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { QR_DARK, QR_LIGHT, QR_MAX_LENGTH, qrFileStem, qrOptions, qrValue } from '@/lib/ui/qr';

describe('qrValue', () => {
  it('accepts absolute http(s) links', () => {
    expect(qrValue(' https://forms.example.invalid/f/delivery-note ')).toBe('https://forms.example.invalid/f/delivery-note');
    expect(qrValue('http://localhost:3000/f/rfi')).toBe('http://localhost:3000/f/rfi');
  });
  it('refuses other schemes, credentials, relative paths and overlong values', () => {
    expect(qrValue('javascript:alert(1)')).toBeNull();
    expect(qrValue('/f/rfi')).toBeNull();
    expect(qrValue('https://u:p@example.invalid/f/x')).toBeNull();
    expect(qrValue(`https://example.invalid/${'a'.repeat(QR_MAX_LENGTH)}`)).toBeNull();
    expect(qrValue('')).toBeNull();
  });
});

describe('qrFileStem', () => {
  it('keeps [a-z0-9-] only', () => {
    expect(qrFileStem('Delivery Note')).toBe('qr-delivery-note');
    expect(qrFileStem('../RFI "x"')).toBe('qr-rfi-x');
    expect(qrFileStem('***')).toBe('qr-code');
  });
});

describe('qrOptions', () => {
  it('is black on white with a 4-module quiet zone', async () => {
    expect(qrOptions()).toEqual({ errorCorrectionLevel: 'M', margin: 4, color: { dark: QR_DARK, light: QR_LIGHT } });
    expect(qrOptions(1024).width).toBe(1024);
    const svg = await QRCode.toString('https://forms.example.invalid/f/rfi', { ...qrOptions(), type: 'svg' });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('stroke="#000000"');
    // Modules only: the link itself is not written into the SVG as text.
    expect(svg).not.toContain('forms.example.invalid');
  });
});

describe('QR components', () => {
  it('use tokens only and never render the SVG as HTML', () => {
    const src = readFileSync(path.resolve(__dirname, '../../components/qr/QrCode.tsx'), 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toContain('dangerouslySetInnerHTML');
    expect(src).not.toMatch(/console\./);
  });
});
