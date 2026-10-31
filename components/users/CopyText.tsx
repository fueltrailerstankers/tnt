'use client';

import { useRef, useState } from 'react';
import { buttonClass, inputClass } from '@/components/ui/styles';

/** A read-only value with a Copy button (clipboard, or selects the text when the clipboard is blocked). */
export function CopyText({ value, label }: { value: string; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      input.current?.select();
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} min-w-0 flex-1 basis-64 font-mono text-small`} />
      <button type="button" onClick={copy} className={buttonClass('secondary', 44)}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
