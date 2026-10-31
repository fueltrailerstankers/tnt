'use client';

import { useRef, useState } from 'react';
import { QrCode } from '@/components/qr/QrCode';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { buttonClass } from '@/components/ui/styles';

/** Forms index "Public link" button and its modal: its QR code (Download PNG/SVG), the link in a read-only box with Copy, and Open form. */
export function PublicLinkButton({ formLabel, url, path }: { formLabel: string; url: string; path: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const box = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('ok');
    } catch {
      // No clipboard permission: select the text so Ctrl+C / long-press copies it.
      box.current?.select();
      setCopied('failed');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setCopied('idle'); setOpen(true); }}
        aria-haspopup="dialog"
        aria-label={`Public link for ${formLabel}`}
        className={buttonClass('secondary', 44, 'flex-1 font-medium sm:h-9 sm:px-3.5 sm:text-body')}
      >
        <Icon name="external" size={15} />
        Public link
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${formLabel} · public link`}
        description="Customers open this without logging in. Turnstile protects the submit."
        size="sm"
      >
        <QrCode value={url} label={formLabel} size={140} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={box}
            aria-label="Public link"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-11 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface-2 px-2.5 font-mono text-base text-fg sm:h-[38px] sm:text-[12px]"
          />
          <button type="button" onClick={copy} className={buttonClass('primary', 44, 'sm:h-[38px]')}>
            <Icon name="copy" size={15} />
            Copy link
          </button>
        </div>
        <p role="status" className="m-0 min-h-5 text-small text-fg-muted">
          {copied === 'ok' ? 'Link copied.' : copied === 'failed' ? 'Copy is blocked here. The link is selected: copy it from the box.' : ''}
        </p>
        <div className="flex justify-end">
          <a href={path} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 44, 'sm:h-9')}>
            <Icon name="external" size={15} />
            Open form<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </Modal>
    </>
  );
}
