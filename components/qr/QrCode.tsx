'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { buttonClass } from '@/components/ui/styles';
import { QR_PNG_WIDTH, qrFileStem, qrOptions, qrValue } from '@/lib/ui/qr';

type Drawn = { state: 'pending' } | { state: 'ok'; svg: string } | { state: 'failed' };

function save(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * A QR code for a link, drawn in the browser (black on white with a quiet zone, whatever the theme), with Download
 * PNG and Download SVG. The value is never sent anywhere, stored or logged.
 */
export function QrCode({ value, label, size = 160 }: { value: string; label: string; size?: number }) {
  const text = qrValue(value);
  const [drawn, setDrawn] = useState<Drawn>({ state: 'pending' });
  const [error, setError] = useState('');
  const stem = qrFileStem(label);

  useEffect(() => {
    let live = true;
    if (!text) {
      setDrawn({ state: 'failed' });
      return;
    }
    setDrawn({ state: 'pending' });
    QRCode.toString(text, { ...qrOptions(), type: 'svg' })
      .then((svg) => { if (live) setDrawn({ state: 'ok', svg }); })
      .catch(() => { if (live) setDrawn({ state: 'failed' }); });
    return () => { live = false; };
  }, [text]);

  async function downloadPng() {
    if (!text) return;
    setError('');
    try {
      save(await QRCode.toDataURL(text, { ...qrOptions(QR_PNG_WIDTH), type: 'image/png' }), `${stem}.png`);
    } catch {
      setError('Could not make the PNG. Try Download SVG.');
    }
  }

  function downloadSvg() {
    if (drawn.state !== 'ok') return;
    const url = URL.createObjectURL(new Blob([drawn.svg], { type: 'image/svg+xml' }));
    save(url, `${stem}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
      <div
        data-testid="qr-code"
        style={{ width: size, height: size }}
        className="flex flex-none items-center justify-center overflow-hidden rounded-md border border-border"
      >
        {drawn.state === 'ok' ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL drawn in the browser; next/image adds nothing here
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`} alt={`QR code for ${label}`} width={size} height={size} className="block h-full w-full" />
        ) : drawn.state === 'pending' ? (
          <span className="text-small text-fg-muted">Drawing…</span>
        ) : (
          <span className="p-2 text-center text-small text-fg-muted">No QR code for this link.</span>
        )}
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto">
        <span className="text-small text-fg-muted">Print it or show it on a screen: phones open the link by scanning it.</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadPng} disabled={drawn.state !== 'ok'} className={buttonClass('secondary', 44, 'sm:h-9')}>
            <Icon name="download" size={15} />
            Download PNG
          </button>
          <button type="button" onClick={downloadSvg} disabled={drawn.state !== 'ok'} className={buttonClass('secondary', 44, 'sm:h-9')}>
            <Icon name="download" size={15} />
            Download SVG
          </button>
        </div>
        <p role="status" className="m-0 min-h-5 text-small text-status-red-fg">{error}</p>
      </div>
    </div>
  );
}

/** "QR code" button and its modal (the link in a read-only box under the code). */
export function QrCodeButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`QR code for ${label}`}
        className={className ?? buttonClass('secondary', 44, 'sm:h-9')}
      >
        <Icon name="qr" size={15} />
        QR code
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${label} · QR code`} size="sm">
        <QrCode value={value} label={label} />
        <input
          aria-label="Link in the QR code"
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 min-w-0 rounded-sm border border-border-strong bg-surface-2 px-2.5 font-mono text-base text-fg sm:h-[38px] sm:text-[12px]"
        />
      </Modal>
    </>
  );
}
