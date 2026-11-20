// QR codes for links staff hand to customers (public form links). Pure: options, file names and which values may be
// encoded. Always black on white with a quiet zone, whatever the theme, so phones scan them; the colours are fixed
// QR module colours, not UI colours. A QR is drawn in the browser from a link the page already shows: nothing is
// stored or logged. Role-link tokens are never encoded here unless the full link is on screen at creation time.

/** Fixed module colours (scannability), passed to the qrcode library. */
export const QR_DARK = '#000000';
export const QR_LIGHT = '#ffffff';

/** M: about 15% recovery, enough for print and screens without making short links dense. */
export const QR_ERROR_LEVEL = 'M' as const;
/** Quiet zone in modules (the spec minimum is 4). */
export const QR_MARGIN = 4;
/** PNG download edge in pixels (print friendly). */
export const QR_PNG_WIDTH = 1024;
/** Longest value we encode (a QR at level M holds ~2,300 bytes; links are far shorter). */
export const QR_MAX_LENGTH = 1024;

export interface QrOptions {
  errorCorrectionLevel: typeof QR_ERROR_LEVEL;
  margin: number;
  color: { dark: string; light: string };
  width?: number;
}

export function qrOptions(width?: number): QrOptions {
  return { errorCorrectionLevel: QR_ERROR_LEVEL, margin: QR_MARGIN, color: { dark: QR_DARK, light: QR_LIGHT }, ...(width ? { width } : {}) };
}

/** Only absolute http(s) links without credentials, within the length cap, are drawn. */
export function qrValue(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > QR_MAX_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  return s;
}

/** "qr-form-delivery-note" (download file stem): only [a-z0-9-] survive; never a token or personal data. */
export function qrFileStem(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return s ? `qr-${s}` : 'qr-code';
}
